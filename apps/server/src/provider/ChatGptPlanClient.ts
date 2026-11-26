import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Sse from "effect/encoding/Sse";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

const RESOURCE = "https://api.openai.com/v1";

const ModelCatalog = Schema.Struct({
  models: Schema.Array(
    Schema.Struct({
      slug: Schema.String,
      display_name: Schema.String,
      visibility: Schema.String,
    }),
  ),
});

const ResponseEvent = Schema.Struct({
  type: Schema.String,
  delta: Schema.optional(Schema.String),
  response: Schema.optional(Schema.Unknown),
});
const decodeResponseEvent = Schema.decodeUnknownEffect(ResponseEvent);

export type ChatGptPlanModel = { readonly slug: string; readonly name: string };
export type ChatGptPlanResponseEvent = typeof ResponseEvent.Type;
export type ChatGptPlanInputContent =
  | { readonly type: "input_text"; readonly text: string }
  | { readonly type: "input_image"; readonly image_url: string }
  | { readonly type: "input_file"; readonly filename: string; readonly file_data: string };

export class ChatGptPlanRequestError extends Schema.TaggedError<ChatGptPlanRequestError>()(
  "ChatGptPlanRequestError",
  { status: Schema.NullOr(Schema.Number), cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return "ChatGPT could not complete the request. Check your connection and try again.";
  }
}

const decodeCatalog = Schema.decodeUnknownEffect(ModelCatalog);
export const listModels = Effect.fn("ChatGptPlanClient.listModels")(function* (
  accessToken: string,
) {
  const client = yield* HttpClient.HttpClient;
  const response = yield* client
    .get(`${RESOURCE}/models`, { headers: { authorization: `Bearer ${accessToken}` } })
    .pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.mapError((cause) => new ChatGptPlanRequestError({ status: null, cause })),
    );
  const catalog = yield* response.json.pipe(
    Effect.flatMap(decodeCatalog),
    Effect.mapError((cause) => new ChatGptPlanRequestError({ status: response.status, cause })),
  );
  return catalog.models
    .filter((model) => model.visibility === "list")
    .map(({ slug, display_name }) => ({ slug, name: display_name }) satisfies ChatGptPlanModel);
});

export const createResponseStream = Effect.fn("ChatGptPlanClient.createResponseStream")(
  function* (input: {
    readonly accessToken: string;
    readonly model: string;
    readonly instructions?: string;
    readonly messages: ReadonlyArray<{
      readonly role: "user" | "assistant";
      readonly content: string | ReadonlyArray<ChatGptPlanInputContent>;
    }>;
  }) {
    const client = yield* HttpClient.HttpClient;
    const request = yield* HttpClientRequest.post(`${RESOURCE}/responses`).pipe(
      HttpClientRequest.setHeader("authorization", `Bearer ${input.accessToken}`),
      HttpClientRequest.setHeader("accept", "text/event-stream"),
      HttpClientRequest.bodyJson({
        model: input.model,
        ...(input.instructions ? { instructions: input.instructions } : {}),
        input: input.messages.map(({ role, content }) => ({ role, content })),
        store: false,
        stream: true,
      }),
    );
    const response = yield* client
      .execute(request)
      .pipe(Effect.mapError((cause) => new ChatGptPlanRequestError({ status: null, cause })));
    if (response.status < 200 || response.status >= 300) {
      yield* response.stream.pipe(Stream.runDrain);
      return yield* new ChatGptPlanRequestError({ status: response.status });
    }
    return response.stream.pipe(
      Stream.decodeText,
      Stream.pipeThroughChannel(Sse.decode()),
      Stream.mapEffect((event) =>
        decodeResponseEvent(event.data).pipe(
          Effect.mapError(
            (cause) => new ChatGptPlanRequestError({ status: response.status, cause }),
          ),
        ),
      ),
    );
  },
);
