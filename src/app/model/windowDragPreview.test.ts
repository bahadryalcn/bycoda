// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { beginWindowTabDrag } from "./windowDragPreview";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
afterEach(() => {
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
    expect(vi.mocked(invoke).mock.calls.at(-1)![1]).toMatchObject({ pixelRatio: 2.5 });
    vi.stubGlobal("devicePixelRatio", 1.25);
    await vi.advanceTimersByTimeAsync(350);
    expect(vi.mocked(invoke).mock.calls.at(-1)![1]).toMatchObject({ pixelRatio: 2.5 });
    drag.move({ clientX: -200, clientY: 100 });
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
    expect((vi.mocked(invoke).mock.calls.at(-1)![1] as any).revision).toBeGreaterThan(
      (clear as any).revision,
    );
    next.finish();
  });
});
