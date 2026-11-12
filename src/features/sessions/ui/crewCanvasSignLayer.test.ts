// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { createCrewSignLayer } from "./crewCanvasSignLayer";
import { drawSign } from "./crewCodeArt";
vi.mock("./crewCodeArt", async (original) => ({
  ...(await original<object>()),
  drawSign: vi.fn(),
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("uses the exact mask grid, synchronous snapshots and caches only identical sign inputs", () => {
  const cached = { close: vi.fn() };
  const transferred = { close: vi.fn() };
  const context = { setTransform: vi.fn(), clearRect: vi.fn(), scale: vi.fn() };
  const transfer = vi.fn(() => cached);
  const construct = vi.fn();
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      width: number;
      height: number;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        construct(width, height);
      }
      getContext = vi.fn(() => context);
      transferToImageBitmap = transfer;
    },
  );
  vi.stubGlobal(
    "structuredClone",
    vi.fn(() => transferred),
  );
  const measure = vi.fn();
  const prepare = createCrewSignLayer(true, measure);
  const frame = { actions: [] as [], time: 240 };
  const first = prepare(frame);
  expect(construct).toHaveBeenCalledExactlyOnceWith(1520, 468);
  expect(context.scale).toHaveBeenCalledExactlyOnceWith(2, 1.2);
  expect(drawSign).toHaveBeenCalledExactlyOnceWith(context, 240);
  expect(first.frame.signLayer).toBe(transferred);
  expect(first.transfer).toEqual([transferred]);
  prepare({ ...frame, actions: ["idle"] });
  expect(drawSign).toHaveBeenCalledTimes(1);
  expect(transfer).toHaveBeenCalledTimes(1);
  prepare({ ...frame, time: 480 });
  expect(drawSign).toHaveBeenCalledTimes(2);
  expect(cached.close).toHaveBeenCalledTimes(1);
  first.release?.();
  expect(transferred.close).toHaveBeenCalledOnce();
  prepare.dispose();
  prepare.dispose();
  expect(cached.close).toHaveBeenCalledTimes(2);
  expect(measure).toHaveBeenCalledTimes(3);
});
it("missing logo keeps the original worker sign path without allocating a layer", () => {
  const frame = { actions: [] };
  const prepare = createCrewSignLayer(false);
  expect(prepare(frame)).toEqual({ frame, transfer: [] });
  prepare.dispose();
});
