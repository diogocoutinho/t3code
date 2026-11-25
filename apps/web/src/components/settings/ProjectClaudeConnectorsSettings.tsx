import {
  claudeAiConnectorChoices,
  withClaudeAiConnector,
} from "@t3tools/client-runtime/claudeAiConnectors";
import { useGT } from "gt-react";

import { useEnvironmentProviders } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function ProjectClaudeConnectorsSettings() {
  const gt = useGT();
  const { scope, target } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const providersByEnvironment = useEnvironmentProviders();
  if ((scope.kind !== "project" && scope.kind !== "checkout") || !target) return null;

  const choices = claudeAiConnectorChoices(
    providersByEnvironment.get(target.environmentId) ?? EMPTY_SERVER_PROVIDERS,
    settings,
  );
  if (choices === null) return null;

  return (
    <SettingsSection id="claude-ai-connectors" title={gt("claude.ai connectors")}>
      <SettingsRow
        serverScoped
        settingKeys={["claudeAiConnectorAllowlist"]}
        title={gt("Connectors in this project")}
        description={gt(
          "Each enabled connector adds its instructions and tool names to every message. Changes apply when a thread's Claude session next starts.",
        )}
      >
        {choices.known.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            {gt("No connectors found yet. They appear once Claude is signed in to claude.ai.")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {choices.known.map((name) => (
              <li key={name} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{name}</span>
                <Switch
                  aria-label={name}
                  checked={choices.allowed.has(name)}
                  onCheckedChange={(enabled) =>
                    updateSettings({
                      claudeAiConnectorAllowlist: withClaudeAiConnector(choices, name, enabled),
                    })
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </SettingsRow>
    </SettingsSection>
  );
}
