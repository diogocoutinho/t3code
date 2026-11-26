import {
  ProviderDriverKind,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  type ChatAttachment,
  type OrchestrationV2ProviderCapabilities,
  type OrchestrationV2ProviderSession,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2ProviderTurn,
  type ProviderInstanceId as ProviderInstanceIdType,
  ProviderSetupError,
  type ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as FileSystem from "effect/FileSystem";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/http/HttpClient";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as ProjectionStore from "../ProjectionStore.ts";
import { turnScopedSelectionTransition } from "@t3tools/provider-core/server/selectionTransition";
import { makeProviderTextDeltaCoalescer } from "./ProviderTextDeltaCoalescer.ts";
import {
  ChatGptPlanRequestError,
  createResponseStream,
  type ChatGptPlanInputContent,
} from "../../provider/ChatGptPlanClient.ts";

const DRIVER = ProviderDriverKind.make("chatgpt");

const ChatGptPlanProviderCapabilitiesV2 = {
  sessions: {
    supportsMultipleProviderThreadsPerSession: true,
    supportsModelSwitchInSession: true,
    supportsProviderSwitchingViaHandoff: true,
    supportsRuntimeModeSwitchInSession: false,
    pendingRequestsSurviveRestart: false,
  },
  threads: {
    canCreateEmptyThread: true,
    canReadThreadSnapshot: false,
    canRollbackThread: false,
    canForkThread: false,
    canForkFromTurn: false,
    canForkWhileSourceRunning: false,
    canForkFromSubagentThread: false,
    exposesNativeThreadId: false,
  },
  turns: {
    exposesNativeTurnId: false,
    emitsTurnStarted: true,
    emitsTurnCompleted: true,
    supportsInterrupt: true,
    supportsActiveSteering: false,
    supportsSteeringByInterruptRestart: false,
    supportsQueuedMessages: true,
    terminalStatusQuality: "strong",
  },
  streaming: {
    streamsAssistantText: true,
    streamsReasoning: false,
    streamsToolOutput: false,
    streamsPlanText: false,
    emitsMessageCompleted: true,
  },
  tools: {
    exposesToolItemIds: false,
    emitsToolStarted: false,
    emitsToolCompleted: false,
    emitsToolOutput: false,
    supportsMcpTools: false,
    supportsDynamicToolCallbacks: false,
  },
  approvals: {
    supportsCommandApproval: false,
    supportsFileReadApproval: false,
    supportsFileChangeApproval: false,
    supportsApplyPatchApproval: false,
    approvalsHaveNativeRequestIds: false,
    approvalCallbacksAreLiveOnly: false,
    approvalsCanOriginateFromSubagents: false,
  },
  planning: {
    emitsPlanUpdated: false,
    emitsTodoList: false,
    emitsProposedPlan: false,
    supportsStructuredQuestions: false,
    planDeltasHaveItemIds: false,
  },
  subagents: {
    supportsSubagents: false,
    exposesSubagentThreadIds: false,
    emitsSubagentLifecycle: false,
    canWaitForSubagents: false,
    canCloseSubagents: false,
    canForkSubagentThread: false,
  },
  context: {
    acceptsSystemContext: true,
    acceptsDeveloperContext: true,
    acceptsSyntheticUserContext: true,
    canGenerateSummaries: false,
    canConsumeHandoffSummaries: true,
    supportsDeltaHandoff: true,
    supportsFullThreadHandoff: true,
    maxRecommendedHandoffChars: null,
  },
  checkpointing: {
    appCanCheckpointFilesystem: false,
    supportsNestedCheckpointScopes: false,
    providerCanRollbackConversation: false,
    providerRollbackReturnsSnapshot: false,
    providerCanReadConversationSnapshot: false,
  },
  identity: {
    nativeThreadIds: "none",
    nativeTurnIds: "none",
    nativeItemIds: "none",
    nativeRequestIds: "none",
  },
  runtimePolicy: { enforcement: "client-boundary" },
} satisfies OrchestrationV2ProviderCapabilities;

const responseMessage = (input: {
  readonly id: ProviderAdapter.ProviderAdapterV2ThreadSnapshot["messages"][number]["id"];
  readonly threadId: ThreadId;
  readonly runId: ProviderAdapter.ProviderAdapterV2TurnInput["runId"];
  readonly nodeId: ProviderAdapter.ProviderAdapterV2TurnInput["rootNodeId"];
  readonly text: string;
  readonly streaming: boolean;
  readonly now: DateTime.Utc;
}) => ({
  createdBy: "agent" as const,
  creationSource: "provider" as const,
  id: input.id,
  threadId: input.threadId,
  runId: input.runId,
  nodeId: input.nodeId,
  role: "assistant" as const,
  text: input.text,
  attachments: [],
  streaming: input.streaming,
  createdAt: input.now,
  updatedAt: input.now,
});

const MAX_REQUEST_ATTACHMENT_BYTES = 50 * 1024 * 1024;

const toInputContent = Effect.fn("ChatGptPlanAdapterV2.toInputContent")(function* (input: {
  readonly text: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly totalBytes: { value: number };
  readonly fileSystem: FileSystem.FileSystem;
  readonly providerHost: ProviderHost.ProviderHost["Service"];
}): Effect.fn.Return<
  string | ReadonlyArray<ChatGptPlanInputContent>,
  ProviderAdapter.ProviderAdapterProtocolError
> {
  if (input.attachments.length === 0) return input.text;
  if (input.attachments.length > PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
    return yield* new ProviderAdapter.ProviderAdapterProtocolError({
      driver: DRIVER,
      detail: `ChatGPT supports up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} attachments per message.`,
    });
  }
  const content: Array<ChatGptPlanInputContent> = [];
  if (input.text.length > 0) content.push({ type: "input_text", text: input.text });
  for (const attachment of input.attachments) {
    if (attachment.type !== "image" && attachment.type !== "file") {
      return yield* new ProviderAdapter.ProviderAdapterProtocolError({
        driver: DRIVER,
        detail: `ChatGPT does not support the '${attachment.name}' attachment type.`,
      });
    }
    const attachmentPath = input.providerHost.resolveAttachmentPath(attachment);
    if (attachmentPath === null) {
      return yield* new ProviderAdapter.ProviderAdapterProtocolError({
        driver: DRIVER,
        detail: `Could not resolve the '${attachment.name}' attachment on this server.`,
        reason: "attachment_unreadable",
      });
    }
    const bytes = yield* input.fileSystem.readFile(attachmentPath).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapter.ProviderAdapterProtocolError({
            driver: DRIVER,
            detail: `Could not read the '${attachment.name}' attachment.`,
            reason: "attachment_unreadable",
            cause,
          }),
      ),
    );
    input.totalBytes.value += bytes.byteLength;
    if (input.totalBytes.value > MAX_REQUEST_ATTACHMENT_BYTES) {
      return yield* new ProviderAdapter.ProviderAdapterProtocolError({
        driver: DRIVER,
        detail:
          "ChatGPT attachments in the conversation must total no more than 50 MiB per request.",
      });
    }
    const dataUrl = `data:${attachment.mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
    if (attachment.type === "image") {
      const source = "source" in attachment ? attachment.source : undefined;
      if (source) {
        const sourceDescription = [source.appName, source.windowTitle, source.accessibleText]
          .filter((value): value is string => Boolean(value?.trim()))
          .join(" - ");
        if (sourceDescription) {
          content.push({ type: "input_text", text: `Screenshot context: ${sourceDescription}` });
        }
      }
      content.push({ type: "input_image", image_url: dataUrl });
    } else {
      content.push({ type: "input_file", filename: attachment.name, file_data: dataUrl });
    }
  }
  return content;
});

export const makeChatGptPlanAdapterV2 = Effect.fn("makeChatGptPlanAdapterV2")(function* (input: {
  readonly instanceId: ProviderInstanceIdType;
  readonly access: Effect.Effect<{ readonly accessToken: string }, ProviderSetupError>;
}) {
  const idAllocator = yield* IdAllocator.IdAllocatorV2;
  const projectionStore = yield* Effect.serviceOption(ProjectionStore.ProjectionStoreV2);
  const httpClient = yield* HttpClient.HttpClient;
  const fileSystem = yield* FileSystem.FileSystem;
  const providerHost = yield* ProviderHost.ProviderHost;

  return ProviderAdapter.ProviderAdapterV2.of({
    instanceId: input.instanceId,
    driver: DRIVER,
    getCapabilities: Effect.fn("ChatGptPlanAdapterV2.getCapabilities")(function () {
      return Effect.succeed(ChatGptPlanProviderCapabilitiesV2);
    }),
    planSelectionTransition: Effect.fn("ChatGptPlanAdapterV2.planSelectionTransition")(function () {
      return Effect.succeed(turnScopedSelectionTransition());
    }),
    openSession: Effect.fn("ChatGptPlanAdapterV2.openSession")(function* (openInput) {
      const sessionScope = yield* Scope.Scope;
      const now = yield* DateTime.now;
      const queue = yield* Effect.acquireRelease(
        Queue.unbounded<ProviderAdapter.ProviderAdapterV2Event>(),
        Queue.shutdown,
      );
      const currentThreads = yield* Ref.make(new Map<string, OrchestrationV2ProviderThread>());
      const turnsByThread = yield* Ref.make(
        new Map<string, ReadonlyArray<OrchestrationV2ProviderTurn>>(),
      );
      const messagesByThread = yield* Ref.make(
        new Map<
          string,
          ReadonlyArray<ProviderAdapter.ProviderAdapterV2ThreadSnapshot["messages"][number]>
        >(),
      );
      const historyByThread = yield* Ref.make(
        new Map<
          string,
          ReadonlyArray<{
            readonly role: "user" | "assistant";
            readonly content: string | ReadonlyArray<ChatGptPlanInputContent>;
          }>
        >(),
      );
      const activeFibers = yield* Ref.make(new Map<string, Fiber.Fiber<void, unknown>>());
      const session: OrchestrationV2ProviderSession = {
        id: openInput.providerSessionId,
        driver: DRIVER,
        providerInstanceId: input.instanceId,
        status: "ready",
        cwd: process.cwd(),
        model: openInput.modelSelection.model,
        capabilities: ChatGptPlanProviderCapabilitiesV2,
        createdAt: now,
        updatedAt: now,
        lastError: null,
      };

      const emit = (event: ProviderAdapter.ProviderAdapterV2Event) => Queue.offer(queue, event);
      const rememberThread = (thread: OrchestrationV2ProviderThread) =>
        Ref.update(currentThreads, (current) => new Map(current).set(thread.id, thread));
      const ensureThread = Effect.fn("ChatGptPlanAdapterV2.ensureThread")(function* (
        threadInput: ProviderAdapter.ProviderAdapterV2EnsureThreadInput,
      ) {
        if (threadInput.existingProviderThread) return threadInput.existingProviderThread;
        const nativeThreadId = String(threadInput.threadId);
        const thread: OrchestrationV2ProviderThread = {
          id: idAllocator.derive.providerThread({
            driver: DRIVER,
            nativeThreadId,
            providerInstanceId: input.instanceId,
          }),
          driver: DRIVER,
          providerInstanceId: input.instanceId,
          providerSessionId: openInput.providerSessionId,
          appThreadId: threadInput.threadId,
          ownerNodeId: null,
          nativeThreadRef: null,
          nativeConversationHeadRef: null,
          status: "idle",
          firstRunOrdinal: null,
          lastRunOrdinal: null,
          handoffIds: [],
          forkedFrom: null,
          createdAt: now,
          updatedAt: now,
        };
        yield* rememberThread(thread);
        yield* emit({ type: "provider_thread.updated", driver: DRIVER, providerThread: thread });
        return thread;
      });

      return {
        instanceId: input.instanceId,
        driver: DRIVER,
        providerSessionId: openInput.providerSessionId,
        providerSession: session,
        // The upstream Responses API call is stateless and the active stream is in memory.
        canResumeAfterRestart: false,
        events: Stream.fromQueue(queue),
        hasPendingBackgroundWork: Effect.succeed(false),
        ensureThread,
        resumeThread: Effect.fn("ChatGptPlanAdapterV2.resumeThread")(function* ({
          providerThread,
        }) {
          yield* rememberThread(providerThread);
          return providerThread;
        }),
        startTurn: Effect.fn("ChatGptPlanAdapterV2.startTurn")(function* (turnInput) {
          const providerThread = turnInput.providerThread;
          const providerTurnId = idAllocator.derive.providerTurn({
            driver: DRIVER,
            nativeTurnId: String(turnInput.runId),
          });
          const messageId = idAllocator.derive.messageFromProviderItem({
            driver: DRIVER,
            nativeItemId: `${turnInput.runId}:assistant`,
          });
          const turnItemId = idAllocator.derive.turnItemFromProviderItem({
            driver: DRIVER,
            nativeItemId: `${turnInput.runId}:assistant`,
          });
          const startedAt = yield* DateTime.now;
          const updatedThread = {
            ...providerThread,
            status: "active" as const,
            providerSessionId: openInput.providerSessionId,
            firstRunOrdinal: providerThread.firstRunOrdinal ?? turnInput.providerTurnOrdinal,
            lastRunOrdinal: turnInput.providerTurnOrdinal,
            updatedAt: startedAt,
          };
          yield* rememberThread(updatedThread);
          yield* emit({
            type: "provider_thread.updated",
            driver: DRIVER,
            providerThread: updatedThread,
          });

          const providerTurn: OrchestrationV2ProviderTurn = {
            id: providerTurnId,
            providerThreadId: providerThread.id,
            nodeId: turnInput.rootNodeId,
            runAttemptId: turnInput.attemptId,
            nativeTurnRef: null,
            ordinal: turnInput.providerTurnOrdinal,
            status: "running",
            startedAt,
            completedAt: null,
            model: turnInput.modelSelection.model,
          };
          yield* Ref.update(turnsByThread, (current) =>
            new Map(current).set(providerThread.id, [
              ...(current.get(providerThread.id) ?? []),
              providerTurn,
            ]),
          );
          yield* emit({ type: "provider_turn.updated", driver: DRIVER, providerTurn });

          const history = Option.isSome(projectionStore)
            ? yield* projectionStore.value.getTurnStartHistory(turnInput.threadId).pipe(
                Effect.mapError(
                  (cause) =>
                    new ProviderAdapter.ProviderAdapterTurnStartError({
                      driver: DRIVER,
                      threadId: turnInput.threadId,
                      providerThreadId: providerThread.id,
                      runId: turnInput.runId,
                      cause,
                    }),
                ),
              )
            : [];
          const totalAttachmentBytes = { value: 0 };
          const messages: Array<{
            role: "user" | "assistant";
            content: string | ReadonlyArray<ChatGptPlanInputContent>;
          }> = [];
          let currentMessageIncluded = false;
          if (Option.isSome(projectionStore)) {
            for (const item of history) {
              if (item.type === "user_message") {
                const content = yield* toInputContent({
                  text: item.text,
                  attachments: item.attachments,
                  totalBytes: totalAttachmentBytes,
                  fileSystem,
                  providerHost,
                });
                messages.push({ role: "user", content });
                currentMessageIncluded ||= item.messageId === turnInput.message.messageId;
              } else if (item.type === "assistant_message") {
                messages.push({ role: "assistant", content: item.text });
              }
            }
            if (!currentMessageIncluded) {
              messages.push({
                role: "user",
                content: yield* toInputContent({
                  text: turnInput.message.text,
                  attachments: turnInput.message.attachments,
                  totalBytes: totalAttachmentBytes,
                  fileSystem,
                  providerHost,
                }),
              });
            }
          } else {
            messages.push(...((yield* Ref.get(historyByThread)).get(turnInput.threadId) ?? []));
            const currentMessage = {
              role: "user" as const,
              content: yield* toInputContent({
                text: turnInput.message.text,
                attachments: turnInput.message.attachments,
                totalBytes: totalAttachmentBytes,
                fileSystem,
                providerHost,
              }),
            };
            messages.push(currentMessage);
            yield* Ref.update(historyByThread, (current) =>
              new Map(current).set(turnInput.threadId, messages),
            );
          }
          const instructions = turnInput.appContext
            ?.map(({ key, text }) => `${key}\n${text}`)
            .join("\n\n");
          const output = { text: "" };
          const responseState = { completed: false };
          const itemBase = {
            id: turnItemId,
            threadId: turnInput.threadId,
            runId: turnInput.runId,
            nodeId: turnInput.rootNodeId,
            providerThreadId: providerThread.id,
            providerTurnId,
            nativeItemRef: null,
            parentItemId: null,
            ordinal: 1,
            title: null,
            startedAt,
          };
          const emitText = Effect.fn("ChatGptPlanAdapterV2.emitText")(function* (
            text: string,
            complete: boolean,
          ) {
            const at = yield* DateTime.now;
            const message = responseMessage({
              id: messageId,
              threadId: turnInput.threadId,
              runId: turnInput.runId,
              nodeId: turnInput.rootNodeId,
              text,
              streaming: !complete,
              now: at,
            });
            yield* Ref.update(messagesByThread, (current) =>
              new Map(current).set(turnInput.threadId, [
                ...(current.get(turnInput.threadId) ?? []).filter(
                  (existing) => existing.id !== message.id,
                ),
                message,
              ]),
            );
            yield* emit({ type: "message.updated", driver: DRIVER, message });
            yield* emit({
              type: "turn_item.updated",
              driver: DRIVER,
              turnItem: {
                ...itemBase,
                type: "assistant_message",
                status: complete ? "completed" : "running",
                text,
                streaming: !complete,
                completedAt: complete ? at : null,
                updatedAt: at,
                messageId,
              },
            });
          });
          const textDeltas = yield* makeProviderTextDeltaCoalescer({
            flushIntervalMs: 40,
            emit: (update) => emitText(update.text, update.completed),
          }).pipe(Effect.provideService(Scope.Scope, sessionScope));
          const run = input.access.pipe(
            Effect.flatMap(({ accessToken }) =>
              createResponseStream({
                accessToken,
                model: turnInput.modelSelection.model,
                ...(instructions ? { instructions } : {}),
                messages,
              }),
            ),
            Effect.flatMap((stream) =>
              stream.pipe(
                Stream.runForEach((event) =>
                  Effect.gen(function* () {
                    if (event.type === "response.output_text.delta" && event.delta) {
                      output.text += event.delta;
                      yield* textDeltas.append({
                        turnId: String(providerTurnId),
                        itemId: String(turnItemId),
                        delta: event.delta,
                      });
                    } else if (event.type === "response.failed") {
                      return yield* new ChatGptPlanRequestError({ status: null });
                    } else if (event.type === "response.completed") {
                      responseState.completed = true;
                    }
                  }),
                ),
              ),
            ),
            Effect.flatMap(() =>
              responseState.completed
                ? textDeltas.complete({
                    turnId: String(providerTurnId),
                    itemId: String(turnItemId),
                    finalText: output.text,
                  })
                : Effect.fail(new ChatGptPlanRequestError({ status: null })),
            ),
            Effect.matchEffect({
              onFailure: Effect.fn("ChatGptPlanAdapterV2.onFailure")(function* (cause) {
                const endedAt = yield* DateTime.now;
                const failedTurn = {
                  ...providerTurn,
                  status: "failed" as const,
                  completedAt: endedAt,
                };
                yield* emit({
                  type: "provider_turn.updated",
                  driver: DRIVER,
                  providerTurn: failedTurn,
                });
                yield* emit({
                  type: "turn.terminal",
                  driver: DRIVER,
                  providerThreadId: providerThread.id,
                  providerTurnId,
                  runOrdinal: turnInput.providerTurnOrdinal,
                  failureItemOrdinal: 2,
                  status: "failed",
                  failure: {
                    class: "provider_error",
                    message:
                      "ChatGPT could not complete this response. Check the connection and try again.",
                    code: null,
                    retryable: true,
                  },
                  threadDisposition: "reusable",
                });
                yield* Effect.logDebug("ChatGPT plan response failed.", { cause });
              }),
              onSuccess: Effect.fn("ChatGptPlanAdapterV2.onSuccess")(function* () {
                const endedAt = yield* DateTime.now;
                if (Option.isNone(projectionStore)) {
                  yield* Ref.update(historyByThread, (current) => {
                    const previous = current.get(turnInput.threadId) ?? messages;
                    return new Map(current).set(turnInput.threadId, [
                      ...previous,
                      { role: "assistant", content: output.text },
                    ]);
                  });
                }
                const completedTurn = {
                  ...providerTurn,
                  status: "completed" as const,
                  completedAt: endedAt,
                };
                yield* emit({
                  type: "provider_turn.updated",
                  driver: DRIVER,
                  providerTurn: completedTurn,
                });
                const idleThread = {
                  ...updatedThread,
                  status: "idle" as const,
                  updatedAt: endedAt,
                };
                yield* rememberThread(idleThread);
                yield* emit({
                  type: "provider_thread.updated",
                  driver: DRIVER,
                  providerThread: idleThread,
                });
                yield* emit({
                  type: "turn.terminal",
                  driver: DRIVER,
                  providerThreadId: providerThread.id,
                  providerTurnId,
                  runOrdinal: turnInput.providerTurnOrdinal,
                  status: "completed",
                  failure: null,
                  threadDisposition: "reusable",
                });
              }),
            }),
            Effect.provideService(HttpClient.HttpClient, httpClient),
          );
          const fiber = yield* Effect.forkIn(run, sessionScope);
          yield* Ref.update(activeFibers, (current) =>
            new Map(current).set(providerThread.id, fiber),
          );
        }),
        steerTurn: (steerInput) =>
          Effect.fail(
            new ProviderAdapter.ProviderAdapterSteerRunUnsupportedError({
              driver: DRIVER,
              providerThreadId: steerInput.providerThread.id,
            }),
          ),
        interruptTurn: Effect.fn("ChatGptPlanAdapterV2.interruptTurn")(function* (interruptInput) {
          const fiber = (yield* Ref.get(activeFibers)).get(interruptInput.providerThread.id);
          if (fiber) yield* Fiber.interrupt(fiber);
        }),
        respondToRuntimeRequest: () => Effect.void,
        readThreadSnapshot: Effect.fn("ChatGptPlanAdapterV2.readThreadSnapshot")(function* ({
          providerThread,
        }) {
          return {
            providerThread,
            providerTurns: (yield* Ref.get(turnsByThread)).get(providerThread.id) ?? [],
            messages:
              providerThread.appThreadId === null
                ? []
                : ((yield* Ref.get(messagesByThread)).get(providerThread.appThreadId) ?? []),
            runtimeRequests: [],
          };
        }),
        rollbackThread: (rollbackInput) =>
          Effect.fail(
            new ProviderAdapter.ProviderAdapterRollbackThreadError({
              driver: DRIVER,
              providerThreadId: rollbackInput.providerThread.id,
              checkpointId: rollbackInput.target.checkpointId,
            }),
          ),
        forkThread: (forkInput) =>
          Effect.fail(
            new ProviderAdapter.ProviderAdapterForkThreadError({
              driver: DRIVER,
              providerThreadId: forkInput.sourceProviderThread.id,
            }),
          ),
      };
    }),
  });
});

export type ChatGptPlanAdapterV2DriverEnv =
  | IdAllocator.IdAllocatorV2
  | FileSystem.FileSystem
  | ProviderHost.ProviderHost
  | HttpClient.HttpClient;
