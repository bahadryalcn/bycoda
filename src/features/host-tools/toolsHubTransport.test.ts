// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ listen: vi.fn(), emit: vi.fn(), windows: ["tools-hub"] }));
vi.mock("../../platform/tauri/listenWindow", () => ({ listenWindowAsync: mocks.listen }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => mocks.windows.map((label) => ({ label })),
}));
vi.mock("@tauri-apps/api/event", () => ({ emitTo: mocks.emit }));
import { queryToolsPresentation, waitToolsAcknowledgement } from "./toolsHubTransport";
afterEach(() => {
  vi.useRealTimers();
  mocks.listen.mockReset();
  mocks.emit.mockReset();
  mocks.windows = ["tools-hub"];
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});
it("registers targeted acknowledgement before sending and ignores other transfer identities", async () => {
  let receive!: (event: { payload: unknown }) => void;
  const release = vi.fn();
  mocks.listen.mockImplementation(async (_event, handler) => {
    receive = handler;
    return release;
  });
  const send = vi.fn(async () => {});
  const result = waitToolsAcknowledgement("one", "mounted", send);
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
  receive({ payload: { kind: "mounted", requestId: "other", paneId: "pane" } });
  expect(release).not.toHaveBeenCalled();
  receive({ payload: { kind: "mounted", requestId: "one", paneId: "pane" } });
  await result;
  expect(release).toHaveBeenCalledOnce();
});
it("retains uncertain transfer and releases late listener without sending after timeout", async () => {
  vi.useFakeTimers();
  let registered!: (release: () => void) => void;
  mocks.listen.mockReturnValue(
    new Promise<() => void>((resolve) => {
      registered = resolve;
    }),
  );
  const send = vi.fn(async () => {});
  const result = expect(waitToolsAcknowledgement("one", "mounted", send)).rejects.toThrow(
    "Original workspace retained",
  );
  await vi.advanceTimersByTimeAsync(10000);
  await result;
  const release = vi.fn();
  registered(release);
  await Promise.resolve();
  await Promise.resolve();
  expect(release).toHaveBeenCalledOnce();
  expect(send).not.toHaveBeenCalled();
});

it("reads only matching versioned session presentation from targeted hub without focusing it", async () => {
  Object.assign(window, { __TAURI_INTERNALS__: {} });
  let receive!: (event: { payload: unknown }) => void;
  const release = vi.fn();
  mocks.listen.mockImplementation(async (_event, handler) => {
    receive = handler;
    return release;
  });
  const session = { cwd: "remote://mac/repo", sessionId: "host-one", title: "One" };
  mocks.emit.mockImplementation(async (destination, _event, message) => {
    expect(destination).toBe("tools-hub");
    expect(message).toMatchObject({ kind: "presentation-query", sourceWindow: "main", session });
    receive({
      payload: {
        kind: "presentation",
        requestId: message.requestId,
        presentation: {
          version: 1,
          revision: 1,
          hubWindow: "tools-hub",
          session: { ...session, sessionId: "other" },
          tab: "browser",
          machine: "project",
          mounted: true,
          visible: true,
        },
      },
    });
    receive({
      payload: {
        kind: "presentation",
        requestId: message.requestId,
        presentation: {
          version: 1,
          revision: 2,
          hubWindow: "tools-hub",
          session,
          tab: "logs",
          machine: "machine:mac",
          mounted: true,
          visible: false,
        },
      },
    });
  });
  expect(await queryToolsPresentation(session)).toMatchObject({
    tab: "logs",
    machine: "machine:mac",
    mounted: true,
    visible: false,
  });
  expect(release).toHaveBeenCalledOnce();
});
it("returns unknown when no hub exists rather than asserting source pane visibility", async () => {
  Object.assign(window, { __TAURI_INTERNALS__: {} });
  mocks.windows = [];
  expect(
    await queryToolsPresentation({ cwd: "/repo", sessionId: "one", title: "One" }),
  ).toBeUndefined();
  expect(mocks.emit).not.toHaveBeenCalled();
});

it("bounds missing presentation reply and releases query listener", async () => {
  vi.useFakeTimers();
  Object.assign(window, { __TAURI_INTERNALS__: {} });
  const release = vi.fn();
  mocks.listen.mockResolvedValue(release);
  mocks.emit.mockResolvedValue(undefined);
  const result = queryToolsPresentation({ cwd: "/repo", sessionId: "one", title: "One" });
  await vi.waitFor(() => expect(mocks.emit).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(1500);
  expect(await result).toBeUndefined();
  expect(release).toHaveBeenCalledOnce();
});
