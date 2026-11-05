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

it("reports bounded semantic role, disabled state and layout without claiming clickability", () => {
  const button = document.createElement("button");
  button.disabled = true;
  button.style.display = "flex";
  document.body.append(button);
  vi.spyOn(button, "getClientRects").mockReturnValue([
    { x: 0, y: 0, width: 100, height: 50 },
  ] as unknown as DOMRectList);
  vi.spyOn(document, "elementFromPoint").mockReturnValue(button);
  const result = inspectBrowserElement({ x: 10, y: 10, full: false });
  expect(result.element).toMatchObject({
    inspectionVersion: 1,
    role: "button",
    interaction: { disabled: true, focusable: false },
    layout: { display: "flex" },
  });
  expect(result.element).not.toHaveProperty("clickable");
});

it("returns bounded flex child geometry and marks transformed layouts unsupported", () => {
  const container = document.createElement("div");
  const child = document.createElement("button");
  container.style.display = "flex";
  container.append(child);
  document.body.append(container);
  const bounds = { x: 4, y: 5, width: 20, height: 10 };
  vi.spyOn(container, "getClientRects").mockReturnValue([bounds] as unknown as DOMRectList);
  vi.spyOn(child, "getClientRects").mockReturnValue([bounds] as unknown as DOMRectList);
  vi.spyOn(child, "getBoundingClientRect").mockReturnValue(bounds as DOMRect);
  vi.spyOn(document, "elementFromPoint").mockReturnValue(container);
  const result = inspectBrowserElement({ x: 10, y: 10, full: true });
  expect(result.element?.layout).toMatchObject({ display: "flex", childBounds: [bounds] });
  child.style.transform = "rotate(5deg)";
  expect(inspectBrowserElement({ x: 10, y: 10, full: true }).element?.layout).toMatchObject({
    limitation: expect.stringContaining("transformed"),
  });
});

it("distinguishes semantic disabled from keyboard focus under native disabled and inert", () => {
  const button = document.createElement("button");
  button.setAttribute("aria-disabled", "true");
  document.body.append(button);
  vi.spyOn(button, "getClientRects").mockReturnValue([
    { x: 0, y: 0, width: 100, height: 50 },
  ] as unknown as DOMRectList);
  vi.spyOn(document, "elementFromPoint").mockReturnValue(button);
  expect(inspectBrowserElement({ x: 1, y: 1, full: false }).element?.interaction).toEqual({
    disabled: true,
    focusable: true,
  });
  button.disabled = true;
  expect(inspectBrowserElement({ x: 1, y: 1, full: false }).element?.interaction).toEqual({
    disabled: true,
    focusable: false,
  });
  button.disabled = false;
  button.removeAttribute("aria-disabled");
  button.parentElement!.setAttribute("inert", "");
  expect(inspectBrowserElement({ x: 1, y: 1, full: false }).element?.interaction).toEqual({
    disabled: false,
    focusable: false,
  });
  button.parentElement!.removeAttribute("inert");
});
