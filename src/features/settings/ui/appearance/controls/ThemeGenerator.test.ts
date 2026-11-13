import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => path,
}));

const { chipImageAction } = await import("./ThemeGenerator");

describe("chipImageAction", () => {
  it("waits for a drawing in flight instead of starting another", () => {
    expect(chipImageAction({ status: "loading" })).toBe("wait");
  });

  it("reuses a finished image without drawing again", () => {
    const image = {
      id: "a",
      path: "/library/a.png",
      createdMs: 1,
      bytes: 1,
      source: "generated" as const,
      prompt: null,
    };
    expect(chipImageAction({ status: "done", image })).toBe("apply");
  });

  it("draws when the chip has no image or the last one failed", () => {
    expect(chipImageAction(undefined)).toBe("draw");
    expect(chipImageAction({ status: "error", detail: "failed" })).toBe("draw");
  });
});
