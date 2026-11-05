import { hostServerDispatchSource } from "../../scripts/checks/host-rpc-source-fixture.mjs";
import { expect, it } from "vitest";
import { conversationToolCatalog } from "../conversation/conversation-tools";
import { VOICE_CAPABILITY_COVERAGE } from "./voice-capability-coverage";
import { MANAGEMENT_CONVERSATION_TOOLS } from "../conversation/conversation-management-tools";
it("requires an explicit coverage or owner-boundary decision for every Host RPC family", () => {
  const source = hostServerDispatchSource();
  const families = [
    ...new Set(
      [...source.matchAll(/case "([A-Za-z][A-Za-z0-9-]*)\.[^"]+"/g)].map((match) => match[1]),
    ),
  ].sort();
  expect(Object.keys(VOICE_CAPABILITY_COVERAGE).sort()).toEqual(families);
  const actions = new Set(conversationToolCatalog().map((tool) => tool.action));
  console.info("Voice capability inventory", {
    managementActions: Object.keys(MANAGEMENT_CONVERSATION_TOOLS).length,
    conversationActions: actions.size,
    hostFamilies: families.length,
  });
  for (const entry of Object.values(VOICE_CAPABILITY_COVERAGE)) {
    expect(entry.remaining.length).toBeGreaterThan(10);
    for (const action of entry.tools) expect(actions.has(action), action).toBe(true);
  }
});
