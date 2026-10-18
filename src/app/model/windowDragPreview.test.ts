// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { beginWindowTabDrag } from "./windowDragPreview";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) =>
    window.setTimeout(() => callback(performance.now()), 16),
  );
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => window.clearTimeout(id));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("native drag preview source", () => {
  it("keeps a stationary point's ratio and captures a new ratio with the next pointer sample", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("devicePixelRatio", 2.5);
    const drag = beginWindowTabDrag("source");
    drag.move({ clientX: -100, clientY: 50 });
    await vi.advanceTimersByTimeAsync(16);
    expect(vi.mocked(invoke).mock.calls.at(-1)![1]).toMatchObject({ pixelRatio: 2.5 });
    vi.stubGlobal("devicePixelRatio", 1.25);
    await vi.advanceTimersByTimeAsync(350);
    expect(vi.mocked(invoke).mock.calls.at(-1)![1]).toMatchObject({ pixelRatio: 2.5 });
    drag.move({ clientX: -200, clientY: 100 });
    await vi.advanceTimersByTimeAsync(16);
    expect(vi.mocked(invoke).mock.calls.at(-1)![1]).toMatchObject({
      pixelRatio: 1.25,
      clientX: -200,
      clientY: 100,
    });
    drag.finish();
  });
  it("refreshes stationary hover and ends with a newer tombstone than in-flight moves", async () => {
    vi.useFakeTimers();
    const drag = beginWindowTabDrag("tab-a", ["session-a", "session-b"]);
    drag.move({ clientX: -200, clientY: 120 });
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(350);
    const hoverCalls = vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === "preview_window_tab_drag");
    expect(hoverCalls.length).toBeGreaterThanOrEqual(2);
    expect(hoverCalls[0][1]).toMatchObject({
      sourceId: "tab-a",
      sourceIds: ["session-a", "session-b"],
    });
    drag.finish();
    const [command, clear] = vi.mocked(invoke).mock.calls.at(-1)!;
    expect(command).toBe("clear_window_tab_drag");
    expect((clear as any).revision).toBeGreaterThan((hoverCalls.at(-1)![1] as any).revision);
    const count = vi.mocked(invoke).mock.calls.length;
    drag.move({ clientX: -100, clientY: 100 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.mocked(invoke).mock.calls).toHaveLength(count);
    const next = beginWindowTabDrag("session-b");
    next.move({ clientX: -20, clientY: 30 });
    await vi.advanceTimersByTimeAsync(16);
    expect((vi.mocked(invoke).mock.calls.at(-1)![1] as any).revision).toBeGreaterThan(
      (clear as any).revision,
    );
    next.finish();
  });

  it("bounds high-frequency pointer samples to one latest-point publication per frame", async () => {
    const drag = beginWindowTabDrag("source");
    for (let x = 0; x < 1000; x++) drag.move({ clientX: x, clientY: 20 });
    expect(invoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(16);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(vi.mocked(invoke).mock.calls[0][1]).toMatchObject({ clientX: 999 });
    drag.finish();
  });

  it("never resurrects a finished preview when an in-flight publication resolves", async () => {
    let resolve!: () => void;
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const drag = beginWindowTabDrag("source");
    drag.move({ clientX: 10, clientY: 20 });
    await vi.advanceTimersByTimeAsync(16);
    drag.move({ clientX: 30, clientY: 40 });
    await vi.advanceTimersByTimeAsync(16);
    drag.finish();
    resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
      "preview_window_tab_drag",
      "clear_window_tab_drag",
    ]);
  });

  it("cancels an unpublished frame when the gesture ends before the next paint", async () => {
    const drag = beginWindowTabDrag("source");
    drag.move({ clientX: 10, clientY: 20 });
    drag.finish();
    await vi.advanceTimersByTimeAsync(1000);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("clear_window_tab_drag", expect.any(Object));
  });
});
