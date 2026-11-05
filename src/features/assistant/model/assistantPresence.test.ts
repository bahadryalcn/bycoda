import { expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  invoke: vi.fn(),
  receive: undefined as undefined | ((event: { payload: unknown }) => void),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    listen: async (_event: string, receive: typeof api.receive) => {
      api.receive = receive;
      return () => {
        api.receive = undefined;
      };
    },
  }),
}));
import {
  canSetAssistantPresence,
  nativeAssistantPresencePort,
  type AssistantPresenceView,
} from "./assistantPresence";
const ready: AssistantPresenceView = {
  revision: 1,
  sourceToken: "captured",
  status: { state: "present", setupComplete: true, assistantName: "Arif" },
  pending: false,
  statusError: false,
  writeError: false,
  retry: null,
};
it("sends only exact captured native source and finite owner choice", async () => {
  api.invoke.mockResolvedValue(ready);
  await nativeAssistantPresencePort.set("captured", "away");
  expect(api.invoke).toHaveBeenCalledWith("assistant_presence_set", {
    sourceToken: "captured",
    state: "away",
  });
  const count = api.invoke.mock.calls.length;
  await expect(nativeAssistantPresencePort.set("captured", "idle" as "away")).rejects.toThrow();
  expect(api.invoke).toHaveBeenCalledTimes(count);
});
it("suppresses invalid native events including injected fields and retains unknown", async () => {
  const receive = vi.fn(),
    release = await nativeAssistantPresencePort.subscribe(receive);
  api.receive!({ payload: { ...ready, secret: "no" } });
  expect(receive).not.toHaveBeenCalled();
  const unknown = { ...ready, status: { ...ready.status!, state: "unknown" as const } };
  api.receive!({ payload: unknown });
  expect(receive).toHaveBeenCalledWith(unknown);
  release();
});
it("allows explicit manual state with fresh sensor-unknown proof, while denying missing/error/changed sources", () => {
  expect(canSetAssistantPresence(ready, "captured")).toBe(true);
  expect(
    canSetAssistantPresence(
      { ...ready, status: { ...ready.status!, state: "unknown" } },
      "captured",
    ),
  ).toBe(true);
  for (const view of [
    { ...ready, sourceToken: "other" },
    { ...ready, pending: true },
    { ...ready, statusError: true },
    { ...ready, writeError: true },
    { ...ready, status: null },
    { ...ready, status: { ...ready.status!, setupComplete: false } },
  ])
    expect(canSetAssistantPresence(view, "captured")).toBe(false);
});
