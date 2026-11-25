import {
  ClaudeSettings,
  type ProviderInstanceConfig,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const decodeClaudeSettings = Schema.decodeUnknownOption(ClaudeSettings);

export interface ClaudeAiConnectorChoices {
  /** Every connector the environment's enabled Claude instances report, sorted. */
  readonly known: ReadonlyArray<string>;
  readonly allowed: ReadonlySet<string>;
}

/** Null when the environment has no enabled Claude instance. */
export function claudeAiConnectorChoices(
  providers: ReadonlyArray<ServerProvider>,
  settings: {
    readonly providerInstances: Readonly<Record<ProviderInstanceId, ProviderInstanceConfig>>;
    readonly claudeAiConnectorAllowlist: ReadonlyArray<string> | null;
  },
): ClaudeAiConnectorChoices | null {
  const claude = providers.filter(
    (provider) => provider.driver === "claudeAgent" && provider.enabled,
  );
  const first = claude[0];
  if (first === undefined) return null;
  const known = [
    ...new Set(claude.flatMap((provider) => provider.claudeAiConnectors ?? [])),
  ].sort();
  if (settings.claudeAiConnectorAllowlist !== null) {
    return { known, allowed: new Set(settings.claudeAiConnectorAllowlist) };
  }
  // A project without its own list follows the first enabled Claude instance's default.
  const instanceDefault = Option.match(
    decodeClaudeSettings(settings.providerInstances[first.instanceId]?.config ?? {}),
    { onNone: () => "none" as const, onSome: (config) => config.claudeAiConnectors },
  );
  return { known, allowed: new Set(instanceDefault === "all" ? known : []) };
}

/** The explicit list a project stores after one connector is switched. */
export function withClaudeAiConnector(
  choices: ClaudeAiConnectorChoices,
  name: string,
  enabled: boolean,
): ReadonlyArray<string> {
  return choices.known.filter((candidate) =>
    candidate === name ? enabled : choices.allowed.has(candidate),
  );
}
