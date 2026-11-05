// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./assistantHostRead", () => ({
  captureAssistantHostRead: async (environmentId?: string) => ({
    environmentId: environmentId ?? "fixture-host",
    session: (sessionId: string) =>
      mock.request(
        "",
        "transport.ws.sessions.v2",
        "sessions.get",
        { sessionId, preview: true, summary: true },
        { kind: "local" },
      ),
  }),
}));
import { readAssistantSession, useAssistantSession } from "./assistantSessions";
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});
const record = (id: string, projectId = "project-one") => ({
  session: { id, title: id, context: { used: 42000, window: 1000000 } },
  projectId,
  status: "running",
  updatedAt: 123,
});

it("reads only the named local Host session and retains reported context/status", async () => {
  mock.request.mockResolvedValueOnce(record("session-one"));
  const result = await readAssistantSession("session-one", "project-one");
  expect(mock.request).toHaveBeenCalledExactlyOnceWith(
    "",
    "transport.ws.sessions.v2",
    "sessions.get",
    { sessionId: "session-one", preview: true, summary: true },
    { kind: "local" },
  );
  expect(result).toMatchObject({
    session: { context: { used: 42000, window: 1000000 } },
    status: "running",
    updatedAt: 123,
  });
});
it("rejects a missing/mismatched identity and a changed project", async () => {
  mock.request.mockResolvedValueOnce(record("other"));
  await expect(readAssistantSession("session-one", "project-one")).rejects.toThrow(
    "matching session",
  );
  mock.request.mockResolvedValueOnce(record("session-one", "other-project"));
  await expect(readAssistantSession("session-one", "project-one")).rejects.toThrow(
    "project no longer matches",
  );
});
it("accepts an actual secondary project only when it belongs to the saved participating set", async () => {
  mock.request.mockResolvedValue(record("secondary", "project-two"));
  expect((await readAssistantSession("secondary", ["project-one", "project-two"])).projectId).toBe(
    "project-two",
  );
  await expect(readAssistantSession("secondary", ["project-one"])).rejects.toThrow(
    "project no longer matches",
  );
});
it("does not refetch a stable row when the same participating array is recreated during render", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mock.request.mockResolvedValue(record("secondary", "project-two"));
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  function View() {
    const state = useAssistantSession("secondary", ["project-one", "project-two"]);
    return createElement("span", null, state.record?.session.id);
  }
  try {
    await act(async () => root.render(createElement(View)));
    await act(async () => root.render(createElement(View)));
    expect(mock.request).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    element.remove();
  }
});
it("removes an old Host's retained row while the same session ID is loading in a new captured environment", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let finish!: (value: unknown) => void;
  mock.request.mockResolvedValueOnce(record("same")).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  let state!: ReturnType<typeof useAssistantSession>;
  function View({ environmentId }: { environmentId: string }) {
    state = useAssistantSession("same", "project-one", environmentId);
    return createElement("span", null, state.record?.environmentId);
  }
  try {
    await act(async () => root.render(createElement(View, { environmentId: "original" })));
    expect(state.record?.environmentId).toBe("original");
    await act(async () => root.render(createElement(View, { environmentId: "replacement" })));
    expect(state.record).toBeNull();
    await act(async () => finish(record("same")));
    expect(state.record?.environmentId).toBe("replacement");
  } finally {
    await act(async () => root.unmount());
    element.remove();
  }
});
it("ignores a late old session read and retries the current read after an error", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let finish!: (value: unknown) => void;
  mock.request
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockRejectedValueOnce(new Error("Host offline"))
    .mockResolvedValueOnce(record("two"));
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  let state!: ReturnType<typeof useAssistantSession>;
  function View({ id }: { id: string }) {
    state = useAssistantSession(id, "project-one");
    return createElement("span", null, state.record?.session.id ?? state.error);
  }
  try {
    await act(async () => root.render(createElement(View, { id: "one" })));
    await act(async () => root.render(createElement(View, { id: "two" })));
    expect(state.error).toBe("Host offline");
    await act(async () => finish(record("one")));
    expect(state.record).toBeNull();
    await act(async () => state.refresh());
    expect(state.record?.session.id).toBe("two");
    expect(state.error).toBe("");
  } finally {
    await act(async () => root.unmount());
    element.remove();
  }
});
