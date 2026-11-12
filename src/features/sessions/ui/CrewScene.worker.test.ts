// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrewScene } from "./CrewScene";
import { EmptySession } from "./EmptySession";
import { CrewStageCard } from "../../settings/ui/appearance/controls/CrewStageCard";
import { setCanvasWorkerEnabled } from "../../../shared/lib/canvas-worker/host";
import { saveCrewGrowthEnabled, saveCrewTheme } from "../../settings/model/settings";
import type { CrewCanvasFrame } from "./crewCanvasHost";
import type { CanvasRequest } from "../../../shared/lib/canvas-worker/types";

const state = vi.hoisted(() => ({
  painters: [] as {
    canvas: HTMLCanvasElement;
    draw: ReturnType<typeof vi.fn> & { dispose: ReturnType<typeof vi.fn> };
  }[],
  enabled: true,
  focused: true,
  constructorFails: false,
}));
vi.mock("../../settings/model/decorativeMotion", async (original) => ({
  ...(await original<object>()),
  useDecorativeMotionEnabled: () => state.enabled,
  useWindowHasFocus: () => state.focused,
}));
vi.mock("./crewCodeArt", () => ({
  CODE_WIDTH: 1040,
  CODE_HEIGHT: 300,
  SIGN_TOP: 14,
  SIGN_HEIGHT: 58,
  CREW_TOP: 0,
  loadCrewSignLogo: () => Promise.resolve(),
  createCodeArtPainter: (canvas: HTMLCanvasElement) => {
    const draw = Object.assign(vi.fn(), { dispose: vi.fn() });
    state.painters.push({ canvas, draw });
    return draw;
  },
}));
vi.mock("./crewCanvasAssets", () => ({
  prepareClassicCrewAssets: async () => ({
    tiles: [],
    sign: null,
    signWidth: 0,
    signHeight: 0,
    palette: {},
    renderer: "auto",
  }),
}));
vi.mock("./crewThemes", () => {
  const rigged = {
    load: async () => {},
    createPainter: () => Object.assign(vi.fn(), { dispose: vi.fn() }),
    character: () => undefined,
  };
  return { riggedCrewTheme: (theme: string) => (theme === "classic" ? undefined : rigged) };
});

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: object }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn<(message: CanvasRequest<CrewCanvasFrame>) => void>();
  terminate = vi.fn();
  constructor() {
    if (state.constructorFails) throw new Error("CSP");
    FakeWorker.instances.push(this);
  }
  reply(type: string, body = {}) {
    this.onmessage?.({
      data: { version: 1, generation: this.postMessage.mock.calls[0][0].generation, type, ...body },
    });
  }
  frames() {
    return this.postMessage.mock.calls.flatMap(([message]) =>
      message.type === "draw" ? [message] : [],
    );
  }
}
let root: Root;
let container: HTMLDivElement;
const show = async (props: ComponentProps<typeof CrewScene> = {}) => {
  await act(async () => root.render(createElement(CrewScene, { workingCount: 3, ...props })));
};
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const start = () => {
  const worker = FakeWorker.instances.at(-1)!;
  act(() => {
    worker.reply("capabilities");
    worker.reply("ready");
    for (const frame of worker.frames()) worker.reply("drawn", { sequence: frame.sequence });
  });
  advance(100);
  act(() => {
    for (const frame of worker.frames()) worker.reply("drawn", { sequence: frame.sequence });
  });
  return worker;
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  localStorage.clear();
  state.painters.length = 0;
  state.enabled = state.focused = true;
  state.constructorFails = false;
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("OffscreenCanvas", class {});
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.stubGlobal("ResizeObserver", undefined);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(900);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(300);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", {
    configurable: true,
    value: vi.fn(() => ({})),
  });
  setCanvasWorkerEnabled("classic-crew", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  advance(100);
  expect(FakeWorker.instances.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(
    true,
  );
  expect(vi.getTimerCount()).toBe(0);
  container.remove();
  setCanvasWorkerEnabled("classic-crew", false);
  delete (HTMLCanvasElement.prototype as Partial<HTMLCanvasElement>).transferControlToOffscreen;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("retains worker, transferred canvas and last frame across repeated pauses", async () => {
  await show();
  const worker = start();
  const canvas = container.querySelector("canvas[style*=none]")?.nextElementSibling;
  expect(canvas).toBeTruthy();
  const creations = state.painters.length;
  const workers = FakeWorker.instances.length;
  const frames = worker.frames().length;
  for (let n = 0; n < 3; n++) {
    await show({ paused: true });
    expect(vi.getTimerCount()).toBe(0);
    advance(1_000);
    expect(worker.frames()).toHaveLength(frames + n);
    await show();
    act(() => {
      for (const frame of worker.frames()) worker.reply("drawn", { sequence: frame.sequence });
    });
  }
  expect(FakeWorker.instances).toHaveLength(workers);
  expect(state.painters).toHaveLength(creations);
  expect(worker.terminate).not.toHaveBeenCalled();
  expect(container.querySelector("canvas[style*=none]")?.nextElementSibling).toBe(canvas);
});

it.each(["constructor", "init-timeout", "paint-timeout", "crash"])(
  "real scene holds prepainted fallback after %s without retrying on pause",
  async (mode) => {
    state.constructorFails = mode === "constructor";
    await show({ paused: true });
    const worker = FakeWorker.instances.at(-1);
    const workers = FakeWorker.instances.length;
    if (mode === "paint-timeout" || mode === "crash") {
      act(() => {
        worker!.reply("capabilities");
        worker!.reply("ready");
        if (mode === "crash") {
          for (const frame of worker!.frames())
            worker!.reply("drawn", { sequence: frame.sequence });
          worker!.onerror?.();
        }
      });
    }
    advance(2_000);
    const fallback = state.painters.at(-1)!;
    expect(fallback.canvas).not.toBe(state.painters[0].canvas);
    expect(fallback.draw).toHaveBeenCalled();
    expect(fallback.canvas.isConnected).toBe(true);
    expect(fallback.canvas.style.display).toBe("");
    expect(container.querySelectorAll("canvas")).toHaveLength(2);
    await show();
    await show({ paused: true });
    advance(3_000);
    expect(state.painters.at(-1)).toBe(fallback);
    expect(FakeWorker.instances).toHaveLength(workers);
  },
);

it.each(["session", "theme", "growth", "switch", "unmount"])(
  "disposes worker and transferred canvas on %s change",
  async (mode) => {
    await show({ sessionId: "first" });
    const worker = start();
    const transferred = container.querySelectorAll("canvas")[1];
    if (mode === "session") await show({ sessionId: "second" });
    if (mode === "theme") await act(async () => saveCrewTheme("star-wars"));
    if (mode === "growth") await act(async () => saveCrewGrowthEnabled(false));
    if (mode === "switch") await act(async () => setCanvasWorkerEnabled("classic-crew", false));
    if (mode === "unmount") await act(async () => root.render(null));
    advance(100);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
    expect(transferred.isConnected).toBe(false);
    expect(container.querySelectorAll("canvas")).toHaveLength(mode === "unmount" ? 0 : 1);
  },
);

it("sends R4-A independent color levels and uncle ages through the real scene host", async () => {
  saveCrewGrowthEnabled(false);
  await show({
    paused: true,
    crew: [0, 0.25, 0.5, 0.75, 1, undefined].map((context) => ({
      role: "subagent",
      working: false,
      context,
    })),
  });
  const worker = start();
  const activity = worker.frames().at(-1)!.frame.activity!;
  expect(activity.map((seat) => seat.charge)).toEqual([0, 0.25, 0.5, 0.75, 1, undefined]);
  expect(activity.map((seat) => seat.age?.stage)).toEqual([3, 3, 3, 3, 3, 3]);
});

it("keeps the original main path when worker switch is off", async () => {
  setCanvasWorkerEnabled("classic-crew", false);
  await show();
  expect(FakeWorker.instances).toHaveLength(0);
  expect(state.painters.at(-1)?.draw).toHaveBeenCalled();
});

it.each([
  ["empty hero", "preference"],
  ["empty hero", "focus"],
  ["empty hero", "hidden"],
  ["Settings preview", "preference"],
  ["Settings preview", "focus"],
  ["Settings preview", "hidden"],
])("%s schedules no frame loop while stopped by %s", async (surface, gate) => {
  setCanvasWorkerEnabled("classic-crew", false);
  if (gate === "preference") state.enabled = false;
  if (gate === "focus") state.focused = false;
  if (gate === "hidden") vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  await act(async () =>
    root.render(
      surface === "empty hero"
        ? createElement(EmptySession, { cwd: "", composer: createElement("textarea") })
        : createElement(CrewStageCard),
    ),
  );
  expect(container.querySelector("canvas")).not.toBeNull();
  expect(container.querySelector(".crew-scene")?.getAttribute("data-motion")).toBe("still");
  expect(vi.getTimerCount()).toBe(0);
  const painter = state.painters.at(-1)!;
  const paints = painter.draw.mock.calls.length;
  advance(1_000);
  expect(painter.draw).toHaveBeenCalledTimes(paints);
});
