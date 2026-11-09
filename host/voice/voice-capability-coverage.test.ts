import { hostServerDispatchSource } from "../../scripts/checks/host-rpc-source-fixture.mjs";
import { expect, it } from "vitest";
import {
  voiceGlobalToolAllowed,
  voiceThreadToolAllowed,
} from "../../src/shared/model/voiceToolScope";
import { voiceToolCatalog } from "./voice-tools";
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
    const family = entry.family ?? "conversation";
    const catalog = new Set(
      voiceToolCatalog()
        .filter((tool) => tool.family === family)
        .map((tool) => tool.action),
    );
    for (const action of [...entry.tools, ...(entry.sessionOnly ?? [])])
      expect(catalog.has(action) || actions.has(action), action).toBe(true);
    // Listing a tool as covered is a claim that voice can reach it from some scope.
    for (const action of entry.tools)
      expect(
        voiceGlobalToolAllowed(family, action) || voiceThreadToolAllowed(family, action),
        `${action} is allowed by no voice scope; list it under sessionOnly or remove it`,
      ).toBe(true);
    for (const action of entry.sessionOnly ?? []) expect(entry.tools, action).not.toContain(action);
  }
});
