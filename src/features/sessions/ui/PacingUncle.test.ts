// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PacingUncle } from "./PacingUncle";

const state = vi.hoisted(() => ({ motion: true, paint: vi.fn() }));
vi.mock("../../settings/model/decorativeMotion", () => ({
  useDecorativeMotionEnabled: () => state.motion,
}));
vi.mock("./pacingUncleArt", () => ({ drawPacingUncle: state.paint }));
let root: Root;
let container: HTMLDivElement;
let raf: ReturnType<typeof vi.fn>;
let cancel: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.motion = true;
  state.paint.mockClear();
  raf = vi.fn(() => 42);
  cancel = vi.fn();
  vi.stubGlobal("requestAnimationFrame", raf);
  vi.stubGlobal("cancelAnimationFrame", cancel);
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.stubGlobal("ResizeObserver", undefined);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(180);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    setTransform: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
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
const render = (visible = true) => act(() => root.render(createElement(PacingUncle, { visible })));
describe("pacing uncle animation gate", () => {
  it("paints a still character when decorative motion is disabled", () => {
    state.motion = false;
    render();
    expect(state.paint).toHaveBeenCalled();
    expect(raf).not.toHaveBeenCalled();
  });
  it("cancels the loop when its session becomes hidden", () => {
    render();
    expect(raf).toHaveBeenCalledTimes(1);
    render(false);
    expect(cancel).toHaveBeenCalledWith(42);
    expect(raf).toHaveBeenCalledTimes(1);
    render(true);
    expect(raf).toHaveBeenCalledTimes(2);
  });
  it("suspends and resumes when the app's document visibility changes", () => {
    render();
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(cancel).toHaveBeenCalledWith(42);
    expect(raf).toHaveBeenCalledTimes(1);
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(raf).toHaveBeenCalledTimes(2);
  });
  it("keeps the walk position when the session is hidden and shown again", () => {
    render();
    raf.mock.calls[0][0](100);
    raf.mock.calls[1][0](150);
    render(false);
    expect(state.paint).toHaveBeenLastCalledWith(expect.anything(), 180, 32, 0.05);
    render(true);
    expect(state.paint).toHaveBeenLastCalledWith(expect.anything(), 180, 32, 0.05);
  });
});
