// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BootGate } from "./BootGate";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
let root: Root;
let container: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
let counter: number;
const mounted = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  frames = new Map();
  counter = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++counter, callback);
    return counter;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  invoke.mockReset();
  mounted.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function frame() {
  const callbacks = [...frames.values()];
  frames.clear();
  act(() => callbacks.forEach((callback) => callback(0)));
}
function render(transferred: boolean, strict = false) {
  const gate = createElement(BootGate, {
    transferred,
    onMounted: mounted,
    children: (ready: boolean) => createElement("output", null, ready ? "ready" : "locked"),
  });
  act(() => root.render(strict ? createElement(StrictMode, null, gate) : gate));
}

describe("transferred workspace boot ownership", () => {
  it("keeps interaction and queue dispatch locked until two paints and successful acknowledgement", async () => {
    let resolve!: () => void;
    invoke.mockReturnValue(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    render(true, true);
    expect(container.textContent).toBe("locked");
    frame();
    expect(invoke).not.toHaveBeenCalled();
    frame();
    expect(invoke).toHaveBeenCalledExactlyOnceWith("window_transfer_ready");
    expect(container.textContent).toBe("locked");
    await act(async () => resolve());
    expect(container.textContent).toBe("ready");
  });
  it("leaves a rejected destination locked for native teardown and source rollback", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    invoke.mockRejectedValue(new Error("Transfer was cancelled"));
    render(true);
    frame();
    frame();
    await act(async () => {});
    expect(container.textContent).toBe("locked");
  });
  it("cancels readiness when the destination unmounts before its second paint", () => {
    render(true);
    frame();
    act(() => root.render(null));
    frame();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("allows a normal boot without a transfer acknowledgement", () => {
    render(false);
    expect(container.textContent).toBe("ready");
    expect(invoke).not.toHaveBeenCalled();
  });
});
