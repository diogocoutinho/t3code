import { ProviderDriverKind, TextGenerationError, type ServerProvider } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Signature from "effect/crypto/Signature";
import { HttpClient } from "effect/http";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
} from "@t3tools/provider-core/server/driver";
import { makeManagedServerProvider } from "@t3tools/provider-core/server/managedProvider";
import { buildServerProvider } from "@t3tools/provider-core/server/snapshotProbe";
import { withInstanceIdentity } from "@t3tools/provider-core/server/instanceIdentity";
import {
  makeChatGptPlanAdapterV2,
  type ChatGptPlanAdapterV2DriverEnv,
} from "../../orchestration-v2/Adapters/ChatGptPlanAdapterV2.ts";
import { makeChatGptPlanAuth } from "../ChatGptPlanAuth.ts";
import { listModels } from "../ChatGptPlanClient.ts";
import { ProviderDriverError } from "../Errors.ts";
import * as ServerConfig from "../../config.ts";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";

const DRIVER = ProviderDriverKind.make("chatgpt");
const Config = Schema.Struct({});
type Config = typeof Config.Type;
const decodeConfig = Schema.decodeSync(Config);

const unsupportedTextGeneration = (operation: string) =>
  Effect.fail(
    new TextGenerationError({
      operation,
      detail: "ChatGPT plan connections currently support conversation chat only.",
    }),
  );

const textGeneration = {
  generateTranscriptionPostProcessing: () => unsupportedTextGeneration("transcription"),
  generateCommitMessage: () => unsupportedTextGeneration("commit-message"),
  generatePrContent: () => unsupportedTextGeneration("pull-request"),
  generateBranchName: () => unsupportedTextGeneration("branch-name"),
  generateThreadTitle: () => unsupportedTextGeneration("thread-title"),
  generateReviewGuide: () => unsupportedTextGeneration("review-guide"),
};

const snapshotFor = Effect.fn("ChatGptPlanDriver.snapshotFor")(function* (input: {
  readonly instanceId: Parameters<typeof makeChatGptPlanAuth>[0]["instanceId"];
  readonly displayName: string | undefined;
  readonly accentColor: string | undefined;
  readonly enabled: boolean;
  readonly auth: ReturnType<typeof makeChatGptPlanAuth> extends Effect.Effect<
    infer A,
    infer _E,
    infer _R
  >
    ? A
    : never;
}) {
  const httpClient = yield* HttpClient.HttpClient;
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const credentials = yield* input.auth.read.pipe(Effect.orElseSucceed(Option.none));
  const connected = Option.isSome(credentials);
  const models = connected
    ? yield* listModels(credentials.value.accessToken).pipe(
        Effect.provideService(HttpClient.HttpClient, httpClient),
        Effect.orElseSucceed(() => []),
      )
    : [];
  const provider: Omit<ServerProvider, "instanceId" | "driver"> = buildServerProvider({
    presentation: { displayName: input.displayName ?? "ChatGPT" },
    enabled: input.enabled,
    checkedAt,
    models: models.map(({ slug, name }) => ({
      slug,
      name,
      isCustom: false,
      capabilities: null,
    })),
    probe: {
      installed: true,
      version: null,
      status: connected ? "ready" : "warning",
      auth: connected
        ? {
            status: "authenticated",
            type: "oauth-personal",
            ...(Option.getOrUndefined(Option.map(credentials, (saved) => saved.email))
              ? { email: Option.getOrUndefined(Option.map(credentials, (saved) => saved.email))! }
              : {}),
            canLogout: true,
          }
        : { status: "unauthenticated", type: "oauth-personal", canLogout: true },
      ...(!connected ? { message: "Sign in with ChatGPT to start a conversation." } : {}),
    },
  });
  return provider;
});

export type ChatGptPlanDriverEnv =
  | HttpClient.HttpClient
  | Digest.Digest
  | SecureRandom.SecureRandom
  | Signature.Signature
  | ServerConfig.ServerConfig
  | ServerSecretStore.ServerSecretStore
  | ServerEnvironment.ServerEnvironmentIdentity
  | ChatGptPlanAdapterV2DriverEnv
  | ProviderHost.ProviderHost;

export const ChatGptPlanDriver: ProviderDriver<Config, ChatGptPlanDriverEnv> = {
  driverKind: DRIVER,
  metadata: { displayName: "ChatGPT", supportsMultipleInstances: true },
  configSchema: Config,
  defaultConfig: () => decodeConfig({}),
  create: Effect.fn("ChatGptPlanDriver.create")(function* ({
    instanceId,
    displayName,
    accentColor,
    enabled,
  }) {
    const httpClient = yield* HttpClient.HttpClient;
    const serverConfig = yield* ServerConfig.ServerConfig;
    let refreshSnapshot: Effect.Effect<void> = Effect.void;
    const auth = yield* makeChatGptPlanAuth({
      instanceId,
      defaultReturnUrl: new URL(
        "/welcome",
        serverConfig.devUrl ?? `http://localhost:${serverConfig.port}`,
      ).toString(),
      onCredentialsChanged: () => refreshSnapshot,
    });
    const orchestrationAdapter = yield* makeChatGptPlanAdapterV2({
      instanceId,
      access: auth.access,
    });
    const stampIdentity = withInstanceIdentity({
      instanceId,
      driverKind: DRIVER,
      displayName,
      accentColor,
      continuationGroupKey: `chatgpt:${instanceId}`,
    });
    const getSnapshot = () =>
      snapshotFor({ instanceId, displayName, accentColor, enabled, auth }).pipe(
        Effect.map(stampIdentity),
        Effect.map((provider) => ({
          ...provider,
          supportsTextGeneration: false,
          setup: { canAuthenticate: true, canInstall: false },
        })),
        Effect.provideService(HttpClient.HttpClient, httpClient),
      );
    const snapshot = yield* makeManagedServerProvider({
      resolveMaintenance: () =>
        Effect.succeed({ provider: DRIVER, packageName: null, update: null }),
      getSettings: Effect.succeed({ enabled }),
      streamSettings: Stream.empty,
      haveSettingsChanged: () => false,
      initialSnapshot: () => getSnapshot(),
      checkProvider: getSnapshot(),
      refreshOnInterval: false,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderDriverError({ driver: DRIVER, instanceId, detail: cause.message, cause }),
      ),
    );
    refreshSnapshot = snapshot.refresh.pipe(Effect.asVoid, Effect.ignore);
    const authController = {
      ...auth.controller,
      complete: (ownerSessionId: string, input: Parameters<typeof auth.controller.complete>[1]) =>
        auth.controller
          .complete(ownerSessionId, input)
          .pipe(
            Effect.tap((state) => (state.phase === "succeeded" ? refreshSnapshot : Effect.void)),
          ),
      logout: (stopSessions: Parameters<typeof auth.controller.logout>[0]) =>
        auth.controller.logout(stopSessions).pipe(Effect.tap(() => refreshSnapshot)),
      ...(auth.controller.removeMethod
        ? {
            removeMethod: (methodId: string) =>
              auth.controller.removeMethod!(methodId).pipe(Effect.tap(() => refreshSnapshot)),
          }
        : {}),
    };
    return {
      instanceId,
      driverKind: DRIVER,
      continuationIdentity: defaultProviderContinuationIdentity({ driverKind: DRIVER, instanceId }),
      displayName,
      accentColor,
      enabled,
      snapshot,
      orchestrationAdapter,
      textGeneration,
      auth: authController,
    };
  }),
};
