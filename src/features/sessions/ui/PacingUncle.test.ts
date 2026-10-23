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
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.motion = true;
  state.paint.mockClear();
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const render = (visible = true) => act(() => root.render(createElement(PacingUncle, { visible })));
describe("pacing uncle animation gate", () => {
  it("paints a still character when decorative motion is disabled", () => {
    state.motion = false;
    render();
    expect(state.paint).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels the loop when its session becomes hidden", () => {
    render();
    expect(vi.getTimerCount()).toBe(1);
    render(false);
    expect(vi.getTimerCount()).toBe(0);
    render(true);
    expect(vi.getTimerCount()).toBe(1);
  });
  it("suspends and resumes through the central motion gate", () => {
    render();
    state.motion = false;
    render();
    expect(vi.getTimerCount()).toBe(0);
    state.motion = true;
    render();
    expect(vi.getTimerCount()).toBe(1);
  });
  it("keeps the walk position when the session is hidden and shown again", () => {
    render();
    act(() => vi.advanceTimersByTime(150));
    const walked = state.paint.mock.lastCall?.[3] as number;
    expect(walked).toBeGreaterThan(0);
    render(false);
    expect(state.paint).toHaveBeenLastCalledWith(expect.anything(), 180, 32, walked, "classic");
    render(true);
    expect(state.paint).toHaveBeenLastCalledWith(expect.anything(), 180, 32, walked, "classic");
  });
});
