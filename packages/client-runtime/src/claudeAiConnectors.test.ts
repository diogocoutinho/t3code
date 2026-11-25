import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { assert, describe, it } from "vitest";

import { claudeAiConnectorChoices, withClaudeAiConnector } from "./claudeAiConnectors.ts";

const claudeId = ProviderInstanceId.make("claudeAgent");
const provider = {
  instanceId: claudeId,
  driver: ProviderDriverKind.make("claudeAgent"),
  enabled: true,
  claudeAiConnectors: ["claude.ai Notion", "claude.ai Gmail"],
} as ServerProvider;

describe("claudeAiConnectorChoices", () => {
  it("follows the Claude instance default until the project stores its own list", () => {
    const inherited = (claudeAiConnectors: string) =>
      claudeAiConnectorChoices([provider], {
        providerInstances: {
          [claudeId]: { driver: provider.driver, config: { claudeAiConnectors } },
        },
        claudeAiConnectorAllowlist: null,
      });
    assert.deepEqual([...inherited("all")!.allowed], ["claude.ai Gmail", "claude.ai Notion"]);
    assert.deepEqual([...inherited("none")!.allowed], []);

    const own = claudeAiConnectorChoices([provider], {
      providerInstances: {},
      claudeAiConnectorAllowlist: ["claude.ai Gmail"],
    })!;
    assert.deepEqual(own.known, ["claude.ai Gmail", "claude.ai Notion"]);
    assert.deepEqual(withClaudeAiConnector(own, "claude.ai Notion", true), [
      "claude.ai Gmail",
      "claude.ai Notion",
    ]);
    assert.deepEqual(withClaudeAiConnector(own, "claude.ai Gmail", false), []);
  });
});
