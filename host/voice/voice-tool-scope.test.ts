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
});

const OPENED_PROJECT_TOOLS = [
  "git.index",
  "git.fileDiff",
  "git.branches",
  "git.worktrees",
  "models.list",
  "usage.sessions.read",
  "skills.search",
  "skills.read",
  "logs.monitors.list",
  "tasks.delete",
  "tasks.transfer",
  "tasks.queue.pause",
  "tasks.review.recheck",
  "tasks.reorder",
  "crews.answer",
];
it("lists the newly opened reads and reviewed writes for a project thread and marks them for the global thread", () => {
  const project = ids(voiceToolsForScope({ projectId: "project", threadId: "thread" }));
  const global = voiceToolsForScope({ threadId: "thread" });
  for (const action of [...OPENED_PROJECT_TOOLS, "devices.list"]) {
    expect(project, action).toContain(`conversation:${action}`);
    expect(roomManagementToolAllowed("conversation", action, "project"), action).toBe(true);
  }
  for (const action of OPENED_PROJECT_TOOLS) {
    expect(
      global.find((tool) => tool.action === action),
      action,
    ).toMatchObject({
      requiresProject: true,
    });
    expect(roomManagementToolAllowed("conversation", action), action).toBe(false);
  }
  // The Host-wide device list needs no project.
  expect(global.find((tool) => tool.action === "devices.list")).not.toHaveProperty(
    "requiresProject",
  );
  expect(roomManagementToolAllowed("conversation", "devices.list")).toBe(true);
});

it("keeps desktop-relay, per-session and approval-bypass tools out of Room scopes", () => {
  const project = ids(voiceToolsForScope({ projectId: "project", threadId: "thread" }));
  const global = ids(voiceToolsForScope({ threadId: "thread" }));
  for (const action of [
    "machines.list",
    "resources.read",
    "pullRequests.watch",
    "pullRequests.unwatch",
    "pullRequests.watches",
    "browser.annotation.start",
    "ui.workspace.open",
    "ui.tools.open",
    "tasks.notes.resolve",
    "crews.respond",
  ]) {
    expect(project, action).not.toContain(`conversation:${action}`);
    expect(global, action).not.toContain(`conversation:${action}`);
  }
});

it("keeps focused-session tools except Room-only actions", () => {
  const listed = voiceToolsForScope({ projectId: "project", sessionId: "session" });
  for (const tool of listed)
    if (tool.family === "conversation")
      expect(isRoomOnlyConversationAction(tool.action)).toBe(false);
});

it("lists the folder file tools and commands.run for the global thread without a project", () => {
  const listed = voiceToolsForScope({ threadId: "thread" });
  for (const action of ["files.roots", "files.read", "files.write", "commands.run"])
    expect(
      listed.find((tool) => tool.action === action),
      action,
    ).toBeDefined();
  expect(listed.find((tool) => tool.action === "files.read")).not.toHaveProperty("requiresProject");
  expect(listed.find((tool) => tool.action === "commands.run")).not.toHaveProperty(
    "requiresProject",
  );
  const project = ids(voiceToolsForScope({ projectId: "project", threadId: "thread" }));
  expect(project).toContain("conversation:commands.run");
  expect(project).not.toContain("conversation:files.roots");
  for (const action of [
    "files.roots",
    "commands.run",
    "commands.run.status",
    "commands.run.cancel",
  ])
    expect(isRoomOnlyConversationAction(action), action).toBe(true);
  // The folder choice and the run-without-asking switch are not model tools.
  const all = voiceToolCatalog().map((tool) => tool.action);
  expect(all.filter((action) => action.startsWith("folders."))).toEqual([]);
});

it("keeps request ids stable for status and cancel and Host-assigned for runs", async () => {
  const { roomManagementInput } =
    await import("../assistant/management/assistant-management-dispatch");
  const input = { command: "node", requestId: "model" };
  expect(roomManagementInput("conversation", "commands.run", input, "room-1").requestId).toBe(
    "room-1",
  );
  expect(
    roomManagementInput("conversation", "commands.run.cancel", { requestId: "room-0" }, "room-9")
      .requestId,
  ).toBe("room-0");
  expect(
    roomManagementInput("conversation", "commands.run.status", { requestId: "room-0" }, "room-9")
      .requestId,
  ).toBe("room-0");
});
