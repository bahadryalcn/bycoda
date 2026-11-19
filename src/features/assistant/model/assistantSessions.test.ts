// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from "react";
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
function mountRoot() {
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  let mounted = true;
  return {
    render: (node: ReactElement) => act(async () => root.render(node)),
    unmount: async () => {
      if (!mounted) return;
      mounted = false;
      await act(async () => root.unmount());
      element.remove();
    },
  };
}
const tick = () => act(async () => void (await vi.advanceTimersByTimeAsync(15000)));

it("polls a session once for every row showing it and stops the timer when the rows leave", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  mock.request.mockResolvedValue(record("shared"));
  function Row() {
    return createElement(
      "span",
      null,
      useAssistantSession("shared", "project-one").record?.session.id,
    );
  }
  const view = mountRoot();
  try {
    await view.render(createElement("div", null, createElement(Row), createElement(Row)));
    expect(mock.request).toHaveBeenCalledTimes(1);
    await tick();
    expect(mock.request).toHaveBeenCalledTimes(2);
    await view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    await view.unmount();
  }
});
it("keeps loading false and the last good record during background refreshes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  mock.request
    .mockResolvedValueOnce(record("one"))
    .mockRejectedValueOnce(new Error("Host offline"))
    .mockResolvedValueOnce(record("one"))
    .mockResolvedValueOnce(record("one"));
  const rendered: boolean[] = [];
  let state!: ReturnType<typeof useAssistantSession>;
  function View() {
    state = useAssistantSession("one", "project-one");
    rendered.push(state.loading);
    return null;
  }
  const view = mountRoot();
  try {
    await view.render(createElement(View));
    expect(state.record?.session.id).toBe("one");
    rendered.length = 0;
    await tick();
    expect(state).toMatchObject({ loading: false, error: "Host offline" });
    expect(state.record?.session.id).toBe("one");
    await tick();
    expect(state).toMatchObject({ loading: false, error: "" });
    const before = rendered.length;
    await tick();
    expect(rendered).not.toContain(true);
    expect(rendered).toHaveLength(before);
  } finally {
    await view.unmount();
  }
});
it("refreshes at once when the document becomes visible again and skips hidden ticks", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  mock.request.mockResolvedValue(record("one"));
  function View() {
    useAssistantSession("one", "project-one");
    return null;
  }
  const view = mountRoot();
  const visibility = (value: DocumentVisibilityState) =>
    Object.defineProperty(document, "visibilityState", { configurable: true, value });
  try {
    await view.render(createElement(View));
    expect(mock.request).toHaveBeenCalledTimes(1);
    visibility("hidden");
    await tick();
    expect(mock.request).toHaveBeenCalledTimes(1);
    visibility("visible");
    await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
    expect(mock.request).toHaveBeenCalledTimes(2);
  } finally {
    Reflect.deleteProperty(document, "visibilityState");
    await view.unmount();
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
