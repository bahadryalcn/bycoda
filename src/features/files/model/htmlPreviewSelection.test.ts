// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { readHtmlPreviewSelection, withHtmlSelectionBridge } from "./htmlPreviewSelection";

describe("HTML preview selection bridge", () => {
  const frame = new DOMRect(100, 200, 400, 300);
  const message = {
    channel: "test",
    selection: { text: " Selected text ", x: 10, y: 20, width: 80, height: 15 },
  };
  it("maps iframe coordinates into the parent viewport", () => {
    const result = readHtmlPreviewSelection(message, "test", frame);
    expect(result?.text).toBe("Selected text");
    expect(result?.rect.x).toBe(110);
    expect(result?.rect.y).toBe(220);
  });
  it("rejects unrelated, empty, oversized and invalid selections", () => {
    expect(readHtmlPreviewSelection(message, "other", frame)).toBeNull();
    for (const selection of [
      null,
      {},
      { ...message.selection, text: " " },
      { ...message.selection, text: "x".repeat(100_001) },
      { ...message.selection, x: Infinity },
      { ...message.selection, y: 400 },
      { ...message.selection, width: -1 },
    ]) {
      expect(readHtmlPreviewSelection({ channel: "test", selection }, "test", frame)).toBeNull();
    }
  });
  it("preserves the doctype and source while adding a reporting-only script", () => {
    const html = "<!doctype html><html><body>Hello</body></html>";
    const bridged = withHtmlSelectionBridge(html, "test");
    expect(bridged.startsWith("<!doctype html><script>")).toBe(true);
    expect(bridged.endsWith("<html><body>Hello</body></html>")).toBe(true);
    expect(bridged).toContain("selectionchange");
    expect(bridged).not.toContain("bycoda:add-to-chat");
  });
});
