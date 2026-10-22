import { describe, expect, it } from "vitest";
import {
  MAX_PROJECT_LOGO_LENGTH,
  parseProjectAppearance,
  projectIdentityColor,
} from "./projectAppearance";

describe("project appearance wire boundary", () => {
  it("normalizes the desktop HSL palette for native renderers", () => {
    expect(projectIdentityColor("hsl(0 100% 50%)")).toBe("#ff0000");
    expect(projectIdentityColor("hsl(120, 100%, 50%)")).toBe("#00ff00");
    expect(projectIdentityColor("hsl(240 100% 50%)")).toBe("#0000ff");
    expect(projectIdentityColor("hsl(211 92% 62%)")).toMatch(/^#[0-9a-f]{6}$/);
    expect(projectIdentityColor("hsl(120 101% 50%)")).toBeUndefined();
    expect(projectIdentityColor("url(file:///private)")).toBeUndefined();
  });
  it("accepts bounded PNG data and rejects filesystem URLs, SVG and oversized logos", () => {
    const logo = "data:image/png;base64,iVBORw0KGgoAAA==";
    expect(parseProjectAppearance({ color: "#aabbcc", logo })).toEqual({ color: "#aabbcc", logo });
    for (const logo of [
      "file:///secret.png",
      "https://external/image.png",
      "data:image/svg+xml,<svg/>",
      `data:image/png;base64,iVBORw0KGgo${"A".repeat(MAX_PROJECT_LOGO_LENGTH)}`,
    ]) {
      expect(parseProjectAppearance({ color: "#aabbcc", logo })).toEqual({ color: "#aabbcc" });
    }
    expect(
      parseProjectAppearance({
        icon: { path: '<image href="file:///private"/>', highlight: "#ffffff" },
      }),
    ).toBeUndefined();
  });
});
