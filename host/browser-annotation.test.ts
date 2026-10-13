// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { inspectBrowserElement } from "./browser-annotation";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
for (const [path, expected] of [
  ["/%61uth/private-123", "/auth/[redacted]"],
  ["/route/%ZZ", "/route/[redacted]"],
]) {
  it(`redacts decoded credential path ${path} together with query, fragment and URL user info`, () => {
    vi.stubGlobal("location", {
      href: `https://user:password@example.test${path}?token=fixture-secret#private-fragment`,
    });
    const button = document.createElement("button");
    button.style.display = "block";
    button.style.opacity = "1";
    document.body.append(button);
    vi.spyOn(button, "getClientRects").mockReturnValue([
      { x: 0, y: 0, width: 100, height: 50 },
    ] as unknown as DOMRectList);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(button);
    const result = inspectBrowserElement({ x: 10, y: 10, full: false });
    expect(result.pageUrl).toBe(`https://example.test${expected}`);
    expect(result.element?.tag).toBe("button");
  });
}
