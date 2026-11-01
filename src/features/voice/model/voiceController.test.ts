import { beforeEach, expect, it, vi } from "vitest";
import type { Session } from "../../sessions/model/session";
import { createVoiceController, type VoiceControllerPorts } from "./voiceController";

const mock = vi.hoisted(() => ({
  call: vi.fn(),
  discover: vi.fn(),
  draft: vi.fn(),
  attachment: vi.fn(),
}));
vi.mock("./voiceToolClient", () => ({
  callVoiceTool: mock.call,
  discoverVoiceTools: mock.discover,
}));
vi.mock("./voiceDraftContext", () => ({
  readVoiceDraftContext: mock.draft,
  readVoiceDraftAttachment: mock.attachment,
}));

const a = { id: "a", title: "Alpha", cwd: "/a", blocks: [] } as unknown as Session;
const b = { id: "b", title: "Beta", cwd: "/b", blocks: [] } as unknown as Session;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  const state = {
    projects: [{ path: "/a" }, { path: "/b" }],
    sessions: [a, b],
    active: "a" as string | undefined,
    scope: "global" as "global" | "session",
  };
  const workspace = {
    tools: [
      { name: "workspace.sessions.create", description: "Create", parameters: { type: "object" } },
    ],
    execute: vi.fn(async () => ({ status: "accepted" })),
  };
  const source = vi.fn(async () => "manager");
  const image = vi.fn(() => ({ accepted: true }));
  const ports: VoiceControllerPorts = {
    getScope: () => state.scope,
    getProjects: () => state.projects,
    getSessions: () => state.sessions,
    getProjectPath: () => "/a",
    getTargetId: () => state.active,
    workspace,
    ensureToolSession: source,
    image,
  };
  const controller = createVoiceController(() => ports);
  controller.captureTurn();
  return { controller, ports, state, workspace, source, image };
}
beforeEach(() => {
  vi.resetAllMocks();
  mock.discover.mockResolvedValue({ tools: [], total: 0, nextOffset: null, categories: [] });
  mock.call.mockResolvedValue({ status: "queued" });
  mock.draft.mockImplementation((sessionId: string) => ({
    sessionId,
    unsent: true,
    text: "not sent",
    attachments: [],
  }));
});

it("captures a stable target for context, draft and catalog while the active tab changes", async () => {
  const { controller, state } = setup();
  state.active = "b";
  expect(controller.context()).toMatchObject({
    sessionId: "a",
    projectPath: "/a",
    composer: { text: "not sent", unsent: true },
  });
  await controller.execute("composer_context", {});
  await controller.execute("app_tools_list", { query: "notes" });
  expect(mock.draft).toHaveBeenLastCalledWith("a");
  expect(mock.discover).toHaveBeenCalledWith({ cwd: "/a", sessionId: "a" }, { query: "notes" });
});

it("keeps a turn captured without a session independent of later tab selection", () => {
  const { controller, state } = setup();
  state.active = undefined;
  controller.captureTurn();
  state.active = "b";
  expect(controller.context()).not.toHaveProperty("session");
  expect(controller.context().sessionId).toBeUndefined();
});

it("discovers workspace tools before a project or session needs to exist", async () => {
  const { controller, state } = setup();
  state.projects = [];
  state.sessions = [];
  expect(await controller.execute("app_tools_list", { family: "workspace" })).toMatchObject({
    total: 1,
    tools: [{ family: "workspace", action: "workspace.sessions.create" }],
  });
  expect(mock.discover).not.toHaveBeenCalled();
});

it("uses an independent management session and preserves queued receipts", async () => {
  const { controller, source } = setup();
  const args = {
    family: "conversation",
    action: "notes.create",
    input: { id: "n", body: "Draft note" },
    requestId: "one",
  };
  expect(await controller.execute("app_tool_call", args)).toEqual({ status: "queued" });
  expect(source).toHaveBeenCalledExactlyOnceWith("/a");
  expect(mock.call).toHaveBeenCalledWith(
    { cwd: "/a", sessionId: "manager" },
    { family: "conversation", action: "notes.create", input: args.input, requestId: "one" },
  );
});

it("retains the selected session for focused terminal and working-copy authority", async () => {
  const { controller, source } = setup();
  await controller.execute("app_tool_call", {
    family: "conversation",
    action: "terminals.create",
    input: {},
    requestId: "terminal",
  });
  expect(source).not.toHaveBeenCalled();
  expect(mock.call).toHaveBeenCalledWith(
    { cwd: "/a", sessionId: "a" },
    { family: "conversation", action: "terminals.create", input: {}, requestId: "terminal" },
  );
});

it("deduplicates the exact operation and refuses a reused ID with changed contents", async () => {
  const { controller } = setup();
  const args = {
    family: "conversation",
    action: "notes.create",
    input: { id: "n" },
    requestId: "one",
  };
  await Promise.all([
    controller.execute("app_tool_call", args),
    controller.execute("app_tool_call", args),
  ]);
  expect(mock.call).toHaveBeenCalledOnce();
  await expect(
    controller.execute("app_tool_call", { ...args, input: { id: "different" } }),
  ).rejects.toThrow("another operation");
});

it("retains uncertain failures so a same-ID retry cannot repeat a possible effect", async () => {
  const { controller } = setup();
  mock.call.mockRejectedValue(new Error("Connection ended after dispatch"));
  const args = {
    family: "social",
    action: "messages.send",
    input: { draftId: "d" },
    requestId: "one",
  };
  await expect(controller.execute("app_tool_call", args)).rejects.toThrow("after dispatch");
  await expect(controller.execute("app_tool_call", args)).rejects.toThrow("after dispatch");
  expect(mock.call).toHaveBeenCalledOnce();
});

it("permits an explicit different visible project without inheriting the old session", async () => {
  const { controller } = setup();
  await controller.execute("app_tools_list", { projectPath: "/b", family: "social" });
  expect(mock.discover).toHaveBeenCalledWith(
    { cwd: "/b", sessionId: undefined },
    { family: "social" },
  );
  await expect(
    controller.execute("composer_context", { projectPath: "/b", sessionId: "a" }),
  ).rejects.toThrow("do not match");
});

it("refuses hidden projects and cross-session access in session scope", async () => {
  const { controller, state } = setup();
  await expect(controller.execute("app_tools_list", { projectPath: "/hidden" })).rejects.toThrow(
    "hidden, locked",
  );
  state.scope = "session";
  await expect(controller.execute("composer_context", { sessionId: "b" })).rejects.toThrow(
    "Global voice scope",
  );
  await expect(
    controller.execute("app_tool_call", {
      family: "workspace",
      action: "workspace.sessions.create",
      input: { projectPath: "/a" },
      requestId: "create",
    }),
  ).rejects.toThrow("Global voice scope");
});

it("rechecks access after management-source creation before any Host effect", async () => {
  const { controller, source, state } = setup();
  const waiting = deferred<string>();
  source.mockReturnValueOnce(waiting.promise);
  const result = controller.execute("app_tool_call", {
    family: "conversation",
    action: "notes.create",
    input: { id: "n" },
    requestId: "one",
  });
  state.projects = [{ path: "/b" }];
  waiting.resolve("manager");
  await expect(result).rejects.toThrow("hidden, locked");
  expect(mock.call).not.toHaveBeenCalled();
});

it("cancels before dispatch when authorization changes during source preparation", async () => {
  const { controller, source } = setup();
  const waiting = deferred<string>();
  source.mockReturnValueOnce(waiting.promise);
  let active = true;
  const result = controller.execute(
    "app_tool_call",
    { family: "conversation", action: "notes.create", input: { id: "n" }, requestId: "one" },
    () => active,
  );
  active = false;
  waiting.resolve("manager");
  await expect(result).rejects.toThrow("no longer active");
  expect(mock.call).not.toHaveBeenCalled();
});

it("supplies actual image content separately and never returns base64 as inspected text", async () => {
  const { controller, image, workspace } = setup();
  mock.attachment.mockResolvedValue({
    sessionId: "a",
    attachmentId: "picture",
    name: "p.png",
    kind: "image",
    dataUrl: "data:image/png;base64,AA==",
  });
  const result = await controller.execute("composer_attachment", { attachmentId: "picture" });
  expect(image).toHaveBeenCalledExactlyOnceWith("data:image/png;base64,AA==");
  expect(result).toMatchObject({ kind: "image", imageProvided: true });
  expect(result).not.toHaveProperty("dataUrl");
  expect(workspace.execute).not.toHaveBeenCalled();
  expect(mock.call).not.toHaveBeenCalled();
});

it("does not inject a late attachment into a replacement voice connection", async () => {
  const { controller, image } = setup();
  const waiting = deferred<unknown>();
  mock.attachment.mockReturnValueOnce(waiting.promise);
  let active = true;
  const result = controller.execute(
    "composer_attachment",
    { attachmentId: "picture" },
    () => active,
  );
  active = false;
  waiting.resolve({
    sessionId: "a",
    attachmentId: "picture",
    name: "p.png",
    kind: "image",
    dataUrl: "data:image/png;base64,AA==",
  });
  await expect(result).rejects.toThrow("no longer active");
  expect(image).not.toHaveBeenCalled();
});

it("honestly reports unsupported vision without inventing inspected image contents", async () => {
  const { controller, image } = setup();
  image.mockReturnValueOnce({ accepted: false });
  mock.attachment.mockResolvedValue({
    sessionId: "a",
    attachmentId: "picture",
    name: "p.png",
    kind: "image",
    dataUrl: "data:image/png;base64,AA==",
  });
  expect(
    await controller.execute("composer_attachment", { attachmentId: "picture" }),
  ).toMatchObject({ imageProvided: false, error: "This voice provider cannot inspect images." });
});
