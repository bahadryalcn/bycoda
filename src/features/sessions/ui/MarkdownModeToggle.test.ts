// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { setMarkdownViewMode, useMarkdownMode, type MarkdownViewMode } from "./MarkdownModeToggle";

it("honors a preview request made before the viewer mounts", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  const path = "/preview-request-test/page.html";
  let mode: MarkdownViewMode | undefined;
  function Probe() {
    [mode] = useMarkdownMode(path, "source");
    return null;
  }
  try {
    setMarkdownViewMode(path, "source");
    setMarkdownViewMode(path, "preview");
    act(() => root.render(createElement(Probe)));
    expect(mode).toBe("preview");
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("remembers review and normal view modes independently with their own defaults", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const values = new Map<string, [MarkdownViewMode, (mode: MarkdownViewMode) => void]>();
  function Probe({ id, fallback }: { id: string; fallback: MarkdownViewMode }) {
    values.set(id, useMarkdownMode(id, fallback));
    return null;
  }
  const normal = "/view-mode-test/readme.md";
  const review = `review:${normal}`;
  const render = () =>
    root.render(
      createElement(
        "div",
        null,
        createElement(Probe, { id: normal, fallback: "preview" }),
        createElement(Probe, { id: review, fallback: "source" }),
      ),
    );
  try {
    await act(async () => render());
    expect(values.get(normal)?.[0]).toBe("preview");
    expect(values.get(review)?.[0]).toBe("source");
    await act(async () => values.get(review)![1]("preview"));
    await act(async () => values.get(normal)![1]("source"));
    await act(async () => root.render(null));
    await act(async () => render());
    expect(values.get(normal)?.[0]).toBe("source");
    expect(values.get(review)?.[0]).toBe("preview");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
