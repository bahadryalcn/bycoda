// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildLocalSessionLink } from "../../../features/sessions/model/localSessionReference";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  toast: vi.fn(),
  release: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../../platform/tauri/listenWindow", () => ({ listenWindowAsync: mocks.listen }));
vi.mock("../../../shared/ui/ToastRegion", () => ({ toast: { show: mocks.toast } }));
vi.mock("../../../shared/i18n", () => ({ t: (value: string) => value }));
import { useSessionLinkActivation } from "./useSessionLinkActivation";

let root: Root;
let host: HTMLDivElement;
let signal: () => void;
const open = vi.fn();
const reference = {
  locator: { kind: "host" as const, environmentId: "env", sessionId: "session" },
};
function Harness() {
  useSessionLinkActivation({ open, resolve: vi.fn() });
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  mocks.listen.mockImplementation(async (_event, callback) => {
    signal = callback;
    return mocks.release;
  });
  mocks.invoke.mockResolvedValue([]);
  open.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

describe("OS session link activation", () => {
  it("subscribes before draining cold links and routes later warm handoffs", async () => {
    mocks.invoke.mockResolvedValueOnce([buildLocalSessionLink(reference), "https://evil.test"]);
    await act(async () => root.render(createElement(Harness)));
    expect(mocks.listen.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.invoke.mock.invocationCallOrder[0],
    );
    expect(open).toHaveBeenCalledExactlyOnceWith(reference);
    mocks.invoke.mockResolvedValueOnce(["bycoda://session/v1/host/env/session?turn=turn"]);
    await act(async () => signal());
    expect(open).toHaveBeenLastCalledWith({ ...reference, turnId: "turn" });
  });

  it("keeps the exact failed target for retry through the current workspace authority", async () => {
    mocks.invoke.mockResolvedValueOnce([buildLocalSessionLink(reference)]);
    open.mockRejectedValueOnce(new Error("locked"));
    await act(async () => root.render(createElement(Harness)));
    const options = mocks.toast.mock.calls[0][0];
    expect(options).toMatchObject({ tone: "danger", message: "locked" });
    await act(async () => options.action.onClick());
    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenLastCalledWith(reference);
  });

  it("drains a warm signal arriving during the initial read without overlapping reads", async () => {
    let finish!: (links: string[]) => void;
    mocks.invoke.mockReturnValueOnce(
      new Promise<string[]>((resolve) => {
        finish = resolve;
      }),
    );
    await act(async () => root.render(createElement(Harness)));
    await act(async () => signal());
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    mocks.invoke.mockResolvedValueOnce([buildLocalSessionLink(reference)]);
    await act(async () => finish([]));
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledExactlyOnceWith(reference);
  });
});
