import { expect, it } from "vitest";
import { voiceGlobalToolAllowed } from "../../src/shared/model/voiceToolScope";
import { roomManagementToolAllowed } from "../assistant/management/assistant-management-dispatch";
import { isRoomOnlyConversationAction } from "../conversation/conversation-tools";
import { voiceToolsForScope } from "./voice-tool-scope";
import { voiceToolCatalog } from "./voice-tools";

const ids = (tools: { family: string; action: string }[]) =>
  tools.map((tool) => `${tool.family}:${tool.action}`);

it("lists only tools the global thread may call, marking project tools", () => {
  const listed = voiceToolsForScope({ threadId: "thread" });
  expect(ids(listed)).not.toContain("conversation:tasks.delete");
  expect(ids(listed)).not.toContain("conversation:skills.search");
  expect(listed.length).toBeGreaterThan(0);
  const projectTools = new Set(ids(voiceToolsForScope({ projectId: "project", threadId: "t" })));
  for (const tool of listed)
    if ("requiresProject" in tool)
      expect(projectTools.has(`${tool.family}:${tool.action}`)).toBe(true);
    else expect(voiceGlobalToolAllowed(tool.family, tool.action)).toBe(true);
  expect(listed.find((tool) => tool.action === "tasks.create")).toMatchObject({
    requiresProject: true,
  });
  expect(listed.length).toBeLessThan(voiceToolCatalog().length);
});

it("lists exactly the Room-callable tools for a project thread", () => {
  const scope = { projectId: "project", threadId: "thread" };
  const listed = voiceToolsForScope(scope);
  const expected = voiceToolCatalog().filter((tool) =>
    tool.family === "conversation" && tool.action === "desktop.status"
      ? true
      : roomManagementToolAllowed(tool.family, tool.action, "project"),
  );
  expect(ids(listed)).toEqual(ids(expected));
  expect(ids(listed)).not.toContain("conversation:tasks.delete");
});

it("keeps focused-session tools except Room-only actions", () => {
  const listed = voiceToolsForScope({ projectId: "project", sessionId: "session" });
  for (const tool of listed)
    if (tool.family === "conversation")
      expect(isRoomOnlyConversationAction(tool.action)).toBe(false);
});
