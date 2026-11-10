import { describe, expect, it, vi } from "vitest";
import { applyBrowserInput, browserKeyAllowed } from "./browser-input";

const viewport = { width: 1280, height: 720 };
function fakePage() {
  return {
    mouse: {
      click: vi.fn(async () => {}),
      wheel: vi.fn(async () => {}),
      move: vi.fn(async () => {}),
      down: vi.fn(async () => {}),
      up: vi.fn(async () => {}),
    },
    keyboard: { type: vi.fn(async () => {}), press: vi.fn(async () => {}) },
  };
}

describe("applyBrowserInput", () => {
  it("presses named keys and shortcuts with modifiers", async () => {
    const page = fakePage();
    await applyBrowserInput(page, { kind: "key", key: "Z", modifiers: ["Control"] }, viewport);
    await applyBrowserInput(page, { kind: "key", key: "Tab", modifiers: ["Shift"] }, viewport);
    await applyBrowserInput(page, { kind: "key", key: "F5" }, viewport);
    expect(page.keyboard.press.mock.calls).toEqual([["Control+Z"], ["Shift+Tab"], ["F5"]]);
  });

  it("rejects keys and modifiers outside the allow-list", async () => {
    const page = fakePage();
    for (const key of ["a", "Control+A", "MediaPlayPause", "", 5])
      await expect(applyBrowserInput(page, { kind: "key", key }, viewport)).rejects.toThrow(
        "Unsupported browser key",
      );
    await expect(
      applyBrowserInput(page, { kind: "key", key: "A", modifiers: ["Hyper"] }, viewport),
    ).rejects.toThrow("Unsupported browser key modifiers");
    expect(page.keyboard.press).not.toHaveBeenCalled();
    expect(browserKeyAllowed("Space")).toBe(true);
  });

  it("keeps pointer, scroll and text bounds", async () => {
    const page = fakePage();
    await applyBrowserInput(
      page,
      { kind: "pointer", action: "down", x: 10, y: 20, button: "right" },
      viewport,
    );
    expect(page.mouse.move).toHaveBeenCalledWith(10, 20);
    expect(page.mouse.down).toHaveBeenCalledWith({ button: "right" });
    await expect(
      applyBrowserInput(page, { kind: "click", x: 1280, y: 0 }, viewport),
    ).rejects.toThrow("Invalid click position");
    await expect(applyBrowserInput(page, { kind: "scroll", y: 2001 }, viewport)).rejects.toThrow(
      "Invalid scroll distance",
    );
    await expect(applyBrowserInput(page, { kind: "text", text: "a\0" }, viewport)).rejects.toThrow(
      "Invalid browser text",
    );
    await expect(applyBrowserInput(page, { kind: "drag" }, viewport)).rejects.toThrow(
      "Unsupported browser input",
    );
  });
});

describe("pointer cursor", () => {
  it("reports the page cursor keyword and never a page-supplied value", async () => {
    const page = { ...fakePage(), evaluate: vi.fn(async () => "pointer" as unknown) };
    const move = { kind: "pointer", action: "move", x: 5, y: 5 };
    expect(await applyBrowserInput(page as never, move, viewport)).toBe("pointer");
    page.evaluate.mockResolvedValueOnce("url(https://example.test/c.png)");
    expect(await applyBrowserInput(page as never, move, viewport)).toBe("default");
    page.evaluate.mockRejectedValueOnce(new Error("Execution context was destroyed"));
    expect(await applyBrowserInput(page as never, move, viewport)).toBeUndefined();
    expect(await applyBrowserInput(page as never, { kind: "scroll", y: 10 }, viewport)).toBe(
      undefined,
    );
  });
});
