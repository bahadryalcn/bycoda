import { afterEach, expect, it, vi } from "vitest";

const listen = vi.hoisted(() => vi.fn());
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/event", () => ({ listen }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

type Callback = (event: { payload: unknown }) => void;

afterEach(() => {
  listen.mockReset();
  invoke.mockReset();
  vi.resetModules();
});

function wireListeners() {
  const callbacks = new Map<string, Callback>();
  listen.mockImplementation((name: string, callback: Callback) => {
    callbacks.set(name, callback);
    return Promise.resolve(vi.fn());
  });
  return callbacks;
}

it("forgets an unmounted pty on exit so its stale replay never reaches a later view", async () => {
  const callbacks = wireListeners();
  const { subscribePty } = await import("./pty");
  subscribePty("gone", vi.fn(), vi.fn())();
  // Output arrives while no view is mounted and is buffered for replay.
  callbacks.get("pty-data")!({ payload: { id: "gone", data: btoa("stale") } });
  callbacks.get("pty-exit")!({ payload: { id: "gone", code: 0 } });

  const later = vi.fn();
  const stop = subscribePty("gone", later, vi.fn());

  expect(later).not.toHaveBeenCalled();
  stop();
});

it("keeps a mounted view's handlers through exit and still delivers its exit callback", async () => {
  const callbacks = wireListeners();
  const { subscribePty } = await import("./pty");
  const data = vi.fn();
  const exit = vi.fn();
  const stop = subscribePty("live", data, exit);

  callbacks.get("pty-exit")!({ payload: { id: "live", code: 3 } });
  callbacks.get("pty-data")!({ payload: { id: "live", data: btoa("tail") } });

  expect(exit).toHaveBeenCalledExactlyOnceWith(3);
  expect(data).toHaveBeenCalledExactlyOnceWith(new TextEncoder().encode("tail"));
  stop();
});
