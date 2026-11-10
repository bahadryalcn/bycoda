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
it("discovers and reads global Room tools without projects or a coding session", async () => {
  const f = setup();
  f.state.active = undefined;
  f.state.projects = [];
  f.state.sessions = [];
  f.ports.getProjectPath = () => "";
  f.ports.getThreadId = () => "room";
  const receipt = { id: "context", environmentId: "host", receive: vi.fn() };
  f.ports.causalContext = async () => receipt;
  f.controller.captureTurn();
  await f.controller.execute("app_tools_list", {});
  expect(mock.discover).toHaveBeenCalledWith(
    { cwd: "", threadId: "room", environmentId: "host" },
    {},
  );
  await f.controller.execute("app_tool_call", {
    family: "conversation",
    action: "preferences.read",
    input: {},
    requestId: "global-read",
  });
  expect(mock.call).toHaveBeenCalledWith(
    { cwd: "", threadId: "room", environmentId: "host", causalContext: receipt },
    expect.objectContaining({ action: "preferences.read" }),
  );
  expect(f.source).not.toHaveBeenCalled();
});
it("keeps explicit project and composer targets gated when global management has no project", async () => {
  const f = setup();
  f.state.active = undefined;
  f.state.projects = [];
  f.ports.getProjectPath = () => "";
  f.ports.getThreadId = () => "room";
  f.controller.captureTurn();
  await expect(
    f.controller.execute("app_tool_call", {
      family: "conversation",
      action: "preferences.read",
      input: {},
      projectPath: "/locked",
      requestId: "targeted",
    }),
  ).rejects.toThrow("hidden, locked");
  await expect(f.controller.execute("composer_context", {})).rejects.toThrow("hidden, locked");
  expect(mock.call).not.toHaveBeenCalled();
});
it("keeps global management available when an unrelated captured coding tab is private", async () => {
  const f = setup();
  f.state.projects = [];
  f.ports.getThreadId = () => "room";
  f.controller.captureTurn();
  await f.controller.execute("app_tool_call", {
    family: "conversation",
    action: "preferences.read",
    input: {},
    requestId: "global-private-tab",
  });
  expect(mock.call).toHaveBeenCalledWith(
    { cwd: "", threadId: "room" },
    expect.objectContaining({ action: "preferences.read" }),
  );
  await expect(f.controller.execute("composer_context", {})).rejects.toThrow("hidden, locked");
});
it("reports a not-ready conversation before dispatch instead of claiming a failed result", async () => {
  const f = setup();
  f.ports.getThreadId = () => "thread";
  f.ports.causalContext = async () => undefined;
  f.controller.captureTurn();
  await expect(
    f.controller.execute("app_tool_call", {
      family: "conversation",
      action: "desktop.launch",
      input: { app: "Chrome" },
      requestId: "not-dispatched",
    }),
  ).rejects.toThrow("No operation was dispatched");
  expect(mock.call).not.toHaveBeenCalled();
  expect(f.source).not.toHaveBeenCalled();
});
it("dispatches without a receipt when the directory can never certify provenance", async () => {
  // A visible remote project leaves the local directory incomplete for the whole
  // generation; Host tools still run, and their output stays uncertified.
  const f = setup();
  f.ports.causalContext = async () => undefined;
  f.ports.causalContextUncertified = async () => true;
  await f.controller.execute("app_tool_call", {
    family: "conversation",
    action: "notes.list",
    input: {},
    requestId: "uncertified-read",
  });
  expect(mock.call).toHaveBeenCalledTimes(1);
  expect(mock.call.mock.calls[0][0]).not.toHaveProperty("causalContext");
});
it("invalidates before renderer data or image disclosure and captures causal context only for actual Host calls", async () => {
  const f = setup(),
    invalidate = vi.fn(async () => {}),
    receipt = { id: "context", receive: vi.fn() };
  f.ports.invalidateCausalContext = invalidate;
  f.ports.causalContext = async () => receipt;
  mock.draft.mockImplementation(() => {
    expect(invalidate).toHaveBeenCalledTimes(1);
    return { unsent: true, text: "draft" };
  });
  await f.controller.execute("composer_context", {});
  await f.controller.execute("app_tool_call", {
    family: "conversation",
    action: "notes.list",
    input: {},
    requestId: "captured-read",
  });
  expect(mock.call.mock.calls[0][0]).toMatchObject({ causalContext: receipt });
  f.workspace.execute.mockImplementation(async () => {
    expect(invalidate).toHaveBeenCalledTimes(2);
    return { status: "accepted" };
  });
  await f.controller.execute("app_tool_call", {
    family: "workspace",
    action: "workspace.projects.list",
    input: {},
    requestId: "workspace",
  });
  expect(invalidate).toHaveBeenCalledTimes(2);
});
it("uses a captured thread for project notes without creating a management session", async () => {
  const { controller, ports, state, source } = setup();
  ports.getThreadId = () => "thread-a";
  controller.captureTurn();
  state.active = "b";
  await controller.execute("app_tool_call", {
    family: "conversation",
    action: "notes.create",
    input: { id: "one", body: "Owner note" },
    requestId: "thread-note",
  });
  expect(mock.call).toHaveBeenCalledWith(
    { cwd: "/a", threadId: "thread-a" },
    expect.objectContaining({ action: "notes.create" }),
  );
  expect(source).not.toHaveBeenCalled();
});
it("keeps remote tools bound to their real captured session without requiring or forwarding a local thread", async () => {
  const { controller, ports, state } = setup();
  const remote = { ...a, id: "remote-session", cwd: "remote://paired/repo" };
  state.projects.push({ path: remote.cwd });
  state.sessions.push(remote);
  state.active = remote.id;
  ports.getThreadId = () => undefined;
  controller.captureTurn();
  await controller.execute("app_tool_call", {
    family: "conversation",
    action: "notes.create",
    input: { id: "remote-note" },
    requestId: "remote-op",
  });
  expect(mock.call).toHaveBeenCalledWith(
    { cwd: remote.cwd, sessionId: remote.id },
    expect.objectContaining({ action: "notes.create" }),
  );
});
it("does not replace a captured missing thread with a later selected thread", async () => {
  const { controller, ports } = setup();
  let thread: string | undefined;
  ports.getThreadId = () => thread;
  controller.captureTurn();
  thread = "later-thread";
  await expect(
    controller.execute("app_tool_call", {
      family: "conversation",
      action: "notes.read",
      input: { id: "one" },
      requestId: "missing-thread",
    }),
  ).rejects.toThrow("verified assistant conversation");
  expect(mock.call).not.toHaveBeenCalled();
});
it("awaits the captured canonical thread lookup without following a later turn", async () => {
  const { controller, ports } = setup();
  const pending = deferred<string>();
  ports.getThreadId = () => pending.promise;
  controller.captureTurn();
  const result = controller.execute("app_tool_call", {
    family: "conversation",
    action: "notes.read",
    input: { id: "one" },
    requestId: "pending-thread",
  });
  ports.getThreadId = () => "later-thread";
  pending.resolve("captured-thread");
  await result;
  expect(mock.call).toHaveBeenCalledWith(
    { cwd: "/a", threadId: "captured-thread" },
    expect.objectContaining({ action: "notes.read" }),
  );
});
it("project scope permits explicit focus within the same project while rejecting another project", async () => {
  const { controller, ports, state } = setup();
  state.sessions.push({ ...b, id: "same-project", cwd: "/a" });
  ports.getScope = () => "project";
  controller.captureTurn();
  await controller.execute("app_tools_list", { sessionId: "same-project" });
  expect(mock.discover).toHaveBeenCalledWith({ cwd: "/a", sessionId: "same-project" }, {});
  await expect(controller.execute("composer_context", { sessionId: "b" })).rejects.toThrow(
    "another project",
  );
});
it("does not let a later Global selection broaden a captured Project turn", async () => {
  const { controller, ports } = setup();
  let scope: "project" | "global" = "project";
  ports.getScope = () => scope;
  controller.captureTurn();
  scope = "global";
  await expect(controller.execute("composer_context", { sessionId: "b" })).rejects.toThrow(
    "another project",
  );
  expect(mock.call).not.toHaveBeenCalled();
});
it("routes Room file reads to the captured project without creating a coding session", async () => {
  const { controller, ports, state, source } = setup();
  ports.getThreadId = () => "thread-a";
  state.active = undefined;
  controller.captureTurn();
  state.active = "b";
  await controller.execute("app_tool_call", {
    family: "conversation",
    action: "files.read",
    input: { path: "README.md" },
    requestId: "thread-file",
  });
  expect(source).not.toHaveBeenCalled();
  expect(mock.call).toHaveBeenCalledWith(
    { cwd: "/a", threadId: "thread-a" },
    expect.objectContaining({
      action: "files.read",
      input: { path: "README.md" },
      requestId: "thread-file",
    }),
  );
  mock.call.mockClear();
  await controller.execute("app_tool_call", {
    family: "conversation",
    action: "files.read",
    input: { root: "folder-1", path: "notes.md" },
    requestId: "folder-file",
  });
  expect(mock.call).toHaveBeenCalledWith(
    expect.objectContaining({ cwd: "", threadId: "thread-a" }),
    expect.objectContaining({
      action: "files.read",
      input: { root: "folder-1", path: "notes.md" },
    }),
  );
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

it("retains global workspace discovery when no project/session or Host catalog is available", async () => {
  const f = setup();
  f.state.projects = [];
  f.state.sessions = [];
  f.state.active = undefined;
  expect(await f.controller.execute("app_tools_list", {})).toMatchObject({
    tools: [],
    workspaceTools: [{ action: "workspace.sessions.create" }],
    hostToolsError: expect.any(String),
  });
  expect(mock.discover).not.toHaveBeenCalled();
});

it.each(["desktop.launch", "desktop.clipboard", "desktop.act", "desktop.click"])(
  "uses a verified assistant thread for %s without creating a coding session",
  async (action) => {
    const f = setup();
    f.state.active = undefined;
    f.ports.getThreadId = () => "thread";
    f.controller.captureTurn();
    mock.call.mockResolvedValue({ operation: { state: "unknown", retry: "unsafe" } });
    const args = {
      family: "conversation",
      action,
      input: { requestId: "native-one" },
      requestId: "same-owner-request",
    };
    expect(await f.controller.execute("app_tool_call", args)).toEqual({
      operation: { state: "unknown", retry: "unsafe" },
    });
    await f.controller.execute("app_tool_call", args);
    expect(mock.call).toHaveBeenCalledExactlyOnceWith(
      { cwd: "/a", threadId: "thread" },
      expect.objectContaining({ action, requestId: "same-owner-request" }),
    );
    expect(f.source).not.toHaveBeenCalled();
  },
);

it("prefers the actual captured session for global desktop input and never follows a later tab", async () => {
  const f = setup();
  f.ports.getThreadId = () => "thread";
  f.controller.captureTurn();
  f.state.active = "b";
  await f.controller.execute("app_tool_call", {
    family: "conversation",
    action: "desktop.launch",
    input: { app: "Chrome" },
    requestId: "launch-original",
  });
  expect(mock.call.mock.calls[0][0]).toEqual({ cwd: "/a", sessionId: "a", threadId: "thread" });
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

it("routes Room terminal creation to its original project and thread", async () => {
  const { controller, ports, state, source } = setup();
  ports.getThreadId = () => "thread-a";
  controller.captureTurn();
  state.active = "b";
  await controller.execute("app_tool_call", {
    family: "conversation",
    action: "terminals.create",
    input: {},
    requestId: "terminal",
  });
  expect(source).not.toHaveBeenCalled();
  expect(mock.call).toHaveBeenCalledWith(
    { cwd: "/a", threadId: "thread-a" },
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

it("keeps tools available after more than 256 acknowledged operations", async () => {
  const { controller, workspace } = setup();
  for (let index = 0; index < 300; index++) {
    await controller.execute("app_tool_call", {
      family: "workspace",
      action: "workspace.sessions.create",
      input: {},
      requestId: `job-${index}`,
    });
  }
  await controller.execute("app_tool_call", {
    family: "workspace",
    action: "workspace.sessions.create",
    input: {},
    requestId: "job-299",
  });
  expect(workspace.execute).toHaveBeenCalledTimes(300);
});

it("never evicts an uncertain call while rotating successful history", async () => {
  const { controller, workspace } = setup();
  const uncertain = {
    family: "social",
    action: "messages.send",
    input: {},
    requestId: "uncertain",
  };
  mock.call.mockRejectedValue(new Error("Unknown outcome"));
  await expect(controller.execute("app_tool_call", uncertain)).rejects.toThrow("Unknown outcome");
  for (let index = 0; index < 300; index++) {
    await controller.execute("app_tool_call", {
      family: "workspace",
      action: "workspace.sessions.create",
      input: {},
      requestId: `job-${index}`,
    });
  }
  await expect(controller.execute("app_tool_call", uncertain)).rejects.toThrow("Unknown outcome");
  expect(mock.call).toHaveBeenCalledOnce();
  expect(workspace.execute).toHaveBeenCalledTimes(300);
});

it("retains in-flight requests at capacity without dispatching extra effects", async () => {
  const { controller, workspace } = setup();
  const pending = deferred<{ status: string }>();
  workspace.execute.mockReturnValue(pending.promise);
  const calls = Array.from({ length: 256 }, (_, index) =>
    controller.execute("app_tool_call", {
      family: "workspace",
      action: "workspace.sessions.create",
      input: {},
      requestId: `pending-${index}`,
    }),
  );
  await expect(
    controller.execute("app_tool_call", {
      family: "workspace",
      action: "workspace.sessions.create",
      input: {},
      requestId: "extra",
    }),
  ).rejects.toThrow("awaiting confirmation");
  expect(workspace.execute).toHaveBeenCalledTimes(256);
  pending.resolve({ status: "accepted" });
  await Promise.all(calls);
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
  // Hidden projects get no Host tools, but desktop workspace actions stay listed.
  const hidden = (await controller.execute("app_tools_list", { projectPath: "/hidden" })) as {
    tools: unknown[];
    hostToolsError: string;
    workspaceTools: unknown[];
  };
  expect(hidden.tools).toEqual([]);
  expect(hidden.hostToolsError).toMatch("hidden, locked");
  expect(hidden.workspaceTools.length).toBeGreaterThan(0);
  expect(mock.discover).not.toHaveBeenCalledWith(
    expect.objectContaining({ cwd: "/hidden" }),
    expect.anything(),
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

it("passes an exact social account target without inheriting the focused project", async () => {
  const f = setup();
  f.ports.getThreadId = () => "room";
  f.controller.captureTurn();
  await f.controller.execute("app_tool_call", {
    family: "social",
    action: "thread.read",
    accountId: "account-a",
    input: { id: "thread" },
    requestId: "read",
  });
  expect(mock.call).toHaveBeenCalledWith(
    expect.objectContaining({ cwd: "", threadId: "room" }),
    expect.objectContaining({ accountId: "account-a" }),
  );
  await expect(
    f.controller.execute("app_tool_call", {
      family: "social",
      action: "thread.read",
      accountId: "account-a",
      projectPath: "/a",
      input: { id: "thread" },
      requestId: "other",
    }),
  ).rejects.toThrow("Global voice scope");
});
it("passes a request ID only to workspace actions whose schema accepts it", async () => {
  const { controller, workspace } = setup();
  workspace.tools.push({
    name: "workspace.sessions.list",
    description: "List",
    parameters: { type: "object", properties: { projectPath: {} } },
  });
  workspace.tools[0].parameters = { type: "object", properties: { requestId: {} } };
  const call = (action: string, requestId: string) =>
    controller.execute("app_tool_call", {
      family: "workspace",
      action,
      input: { projectPath: "/a" },
      requestId,
    });
  await call("workspace.sessions.list", "running-sessions");
  await call("workspace.sessions.create", "create-session");
  expect(workspace.execute.mock.calls).toEqual([
    ["workspace.sessions.list", { projectPath: "/a" }],
    ["workspace.sessions.create", { projectPath: "/a", requestId: "create-session" }],
  ]);
});
