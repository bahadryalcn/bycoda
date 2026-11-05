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

it("keeps the inactive pane mounted but inert and non-painting despite descendant overrides", async () => {
  const { MarkdownViewShell } = await import("./MarkdownModeToggle");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const ruler = (id: string) =>
    createElement("div", {
      "data-testid": id,
      style: { visibility: "visible", pointerEvents: "auto" },
    });
  const render = (mode: MarkdownViewMode) =>
    root.render(
      createElement(MarkdownViewShell, {
        mode,
        onModeChange: () => undefined,
        preview: ruler("preview-ruler"),
        source: ruler("source-ruler"),
      }),
    );
  const pane = (name: string) =>
    container.querySelector<HTMLElement>(`[data-markdown-view-pane="${name}"]`)!;
  try {
    await act(async () => render("preview"));
    expect(pane("source").hasAttribute("inert")).toBe(true);
    expect(pane("source").getAttribute("aria-hidden")).toBe("true");
    expect(pane("source").style.opacity).toBe("0");
    expect(pane("source").contains(container.querySelector('[data-testid="source-ruler"]'))).toBe(
      true,
    );
    expect(pane("preview").hasAttribute("inert")).toBe(false);
    expect(pane("preview").hasAttribute("aria-hidden")).toBe(false);
    await act(async () => render("source"));
    expect(pane("preview").hasAttribute("inert")).toBe(true);
    expect(pane("source").hasAttribute("inert")).toBe(false);
    expect(container.querySelector('[data-testid="preview-ruler"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("zooms the preview by Ctrl+wheel and toolbar while retaining mounted document state", async () => {
  const { MarkdownViewShell } = await import("./MarkdownModeToggle");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = (mode: MarkdownViewMode, zoomable = true) =>
    root.render(
      createElement(MarkdownViewShell, {
        mode,
        zoomable,
        onModeChange: () => undefined,
        preview: createElement("div", { className: "markdown-preview" }, "Document content"),
        source: createElement("textarea", { defaultValue: "Original source" }),
      }),
    );
  const button = (label: string) =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  const wheel = async (target: HTMLElement, deltaY: number, ctrlKey = true) => {
    const event = new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true });
    Object.defineProperty(event, "ctrlKey", { value: ctrlKey });
    await act(async () => target.dispatchEvent(event));
    return event;
  };
  try {
    await act(async () => render("preview"));
    const preview = container.querySelector<HTMLElement>(".markdown-preview")!;
    const source = container.querySelector<HTMLTextAreaElement>("textarea")!;
    source.value = "Retained draft";
    source.setSelectionRange(2, 7);
    preview.scrollTop = 120;
    expect(button("Reset zoom").textContent).toBe("100%");
    expect((await wheel(preview, -100, false)).defaultPrevented).toBe(false);
    expect((await wheel(preview, 0)).defaultPrevented).toBe(false);
    expect(button("Reset zoom").textContent).toBe("100%");
    expect((await wheel(preview, -100)).defaultPrevented).toBe(true);
    expect(button("Reset zoom").textContent).toBe("110%");
    await act(async () => button("Zoom in").click());
    expect(button("Reset zoom").textContent).toBe("120%");
    await act(async () => button("Zoom out").click());
    expect(button("Reset zoom").textContent).toBe("110%");
    for (let step = 0; step < 15; step++) {
      expect((await wheel(preview, -100)).defaultPrevented).toBe(true);
    }
    expect(button("Reset zoom").textContent).toBe("200%");
    expect(button("Zoom in").disabled).toBe(true);
    for (let step = 0; step < 20; step++) {
      expect((await wheel(preview, 100)).defaultPrevented).toBe(true);
    }
    expect(button("Reset zoom").textContent).toBe("50%");
    expect(button("Zoom out").disabled).toBe(true);
    await act(async () => button("Reset zoom").click());
    expect(button("Reset zoom").textContent).toBe("100%");

    await wheel(preview, -100);
    await act(async () => render("source"));
    expect(button("Reset zoom")).toBeNull();
    expect((await wheel(source, -100)).defaultPrevented).toBe(false);
    expect(container.querySelector("textarea")).toBe(source);
    expect(source.value).toBe("Retained draft");
    expect(source.selectionStart).toBe(2);
    expect(source.selectionEnd).toBe(7);
    await act(async () => render("preview"));
    expect(container.querySelector(".markdown-preview")).toBe(preview);
    expect(preview.scrollTop).toBe(120);
    expect(button("Reset zoom").textContent).toBe("110%");

    await act(async () => render("preview", false));
    expect(button("Reset zoom")).toBeNull();
    expect(button("Zoom in")).toBeNull();
    expect(button("Zoom out")).toBeNull();
    expect((await wheel(preview, -100)).defaultPrevented).toBe(false);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
