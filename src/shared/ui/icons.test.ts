// @vitest-environment happy-dom
import { act, createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Search, Settings } from "./icons";

it("forwards SVG refs and consumer sizing/stroke without losing the accessible title", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const ref = createRef<SVGSVGElement>();
  try {
    act(() =>
      root.render(
        createElement(Search, {
          ref,
          title: "Search projects",
          size: 32,
          strokeWidth: 2,
          className: "custom",
        }),
      ),
    );
    const svg = host.querySelector("svg")!;
    expect(ref.current).toBe(svg);
    expect(svg.getAttribute("width")).toBe("32");
    expect(svg.getAttribute("stroke-width")).toBe("2");
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.querySelector("title")?.textContent).toBe("Search projects");
    expect(svg.getAttribute("aria-labelledby")).toBe(svg.querySelector("title")?.id);
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
it("hides decorative glyphs while allowing explicit accessible labels", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    act(() => root.render(createElement(Settings)));
    expect(host.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    act(() => root.render(createElement(Settings, { "aria-label": "Settings" })));
    expect(host.querySelector("svg")?.getAttribute("aria-hidden")).toBeNull();
    expect(host.querySelector("svg")?.getAttribute("aria-label")).toBe("Settings");
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
