// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { resolveTerminalCanvas, terminalRenderingPolicy } from "./terminalRenderingPolicy";

afterEach(() => vi.restoreAllMocks());

const colors = {
  fallbackCanvas: "rgb(240, 240, 240)",
  foreground: "rgb(20, 20, 20)",
  cursor: "rgb(10, 30, 60)",
  selectionBackground: "rgb(30, 60, 90)",
  selectionForeground: "rgb(250, 250, 250)",
};

it("preserves a transparent canvas with the actual reference RGB for correction", () => {
  const policy = terminalRenderingPolicy({ ...colors, canvas: { resolved: true, color: "rgb(40, 50, 60)" } });
  expect(policy.background).toBe("rgba(40, 50, 60, 0)");
  expect(policy.minimumContrastRatio).toBe(7);
  expect(policy.cursorAccent).toBe("rgb(40, 50, 60)");
});

it("declines correction against an unknown glass/image backdrop", () => {
  const policy = terminalRenderingPolicy({ ...colors, canvas: { resolved: false } });
  expect(policy.background).toBe("rgba(240, 240, 240, 0)");
  expect(policy.minimumContrastRatio).toBe(1);
  expect(policy.canvasResolved).toBe(false);
});

it("retains the semantic selection contrast pair after focus leaves", () => {
  const policy = terminalRenderingPolicy({ ...colors, canvas: { resolved: false } });
  expect(policy.selectionInactiveBackground).toBe(colors.selectionBackground);
  expect(policy.selectionForeground).toBe(colors.selectionForeground);
});

function layers(childStyle: Partial<CSSStyleDeclaration>, parentStyle: Partial<CSSStyleDeclaration>) {
  const parent = document.createElement("div");
  const child = parent.appendChild(document.createElement("div"));
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => ({
    backgroundColor: "rgba(0, 0, 0, 0)", backgroundImage: "none", opacity: "1", filter: "none", backdropFilter: "none", mixBlendMode: "normal",
    ...(element === child ? childStyle : parentStyle),
  }) as CSSStyleDeclaration);
  return child;
}

it("composites translucent CSS paint onto its actual opaque ancestor", () => {
  const child = layers({ backgroundColor: "rgba(100, 0, 0, 0.5)" }, { backgroundColor: "rgb(0, 100, 200)" });
  expect(resolveTerminalCanvas(child, (color) => color)).toEqual({ resolved: true, color: "rgba(50, 50, 100, 1)" });
});

it("rejects ancestor opacity even behind an opaque child paint", () => {
  const child = layers({ backgroundColor: "rgb(0, 100, 200)" }, { opacity: "0.5" });
  expect(resolveTerminalCanvas(child, (color) => color)).toEqual({ resolved: false });
});

it("ignores a background image hidden behind an opaque child paint", () => {
  const child = layers({ backgroundColor: "rgb(0, 100, 200)" }, { backgroundImage: "url(fixture.png)" });
  expect(resolveTerminalCanvas(child, (color) => color).resolved).toBe(true);
});
