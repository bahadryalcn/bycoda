// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AgentMarkdown } from "./AgentMarkdown";
import { parseStreamingMarkdown } from "./streamingMarkdown";

class ControlledWorker {
  static current: ControlledWorker;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  request?: { text: string; sequence: number };
  constructor() {
    ControlledWorker.current = this;
  }
  postMessage(request: { text: string; sequence: number }) {
    this.request = request;
  }
  terminate() {}
  complete() {
    const request = this.request!;
    act(() =>
      this.onmessage!({
        data: { sequence: request.sequence, blocks: parseStreamingMarkdown(request.text) },
      } as MessageEvent),
    );
  }
}
function fixture() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Worker", ControlledWorker);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  return {
    container,
    render: (text: string) => act(() => root.render(createElement(AgentMarkdown, { text }))),
    close() {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    },
  };
}
it.each([32 * 1024 + 1, 128 * 1024])(
  "formats %i characters without requiring a worker",
  (length) => {
    const f = fixture();
    const text = "**Formatted**\n\n".padEnd(length, "x");
    try {
      vi.stubGlobal("Worker", undefined);
      f.render(text);
      expect(f.container.querySelector('[data-streamdown="strong"]')?.textContent).toBe(
        "Formatted",
      );
      expect(f.container.textContent).not.toContain("Formatted preview unavailable");
      expect(f.container.textContent).not.toContain("Rendering Markdown");
    } finally {
      f.close();
    }
  },
);
it("uses explicit pending first paint instead of raw large Markdown", async () => {
  const f = fixture();
  const text = "**Formatted beginning**\n\n".padEnd(128 * 1024 + 1, "x");
  try {
    f.render(text);
    expect(f.container.textContent).toContain("Rendering Markdown");
    expect(f.container.textContent).not.toContain("**Formatted beginning**");
    await act(async () => ControlledWorker.current.complete());
    expect(f.container.querySelector('[data-streamdown="strong"]')?.textContent).toBe(
      "Formatted beginning",
    );
    expect(f.container.querySelector('[aria-busy="true"]')).toBeNull();
  } finally {
    f.close();
  }
});
it("retains formatted nodes and selection when growth crosses worker threshold", () => {
  const f = fixture();
  const prefix = "Completed **selectable** paragraph.\n\nTail";
  try {
    f.render(prefix);
    const paragraph = f.container.querySelector("p")!;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    f.render(prefix + " grows.".repeat(20000));
    expect(f.container.querySelector("p")).toBe(paragraph);
    expect(document.getSelection()!.toString()).toBe("Completed selectable paragraph.");
    expect(f.container.textContent).toContain("Rendering Markdown");
    ControlledWorker.current.complete();
    expect(f.container.querySelector("p")).toBe(paragraph);
    expect(document.getSelection()!.toString()).toBe("Completed selectable paragraph.");
  } finally {
    f.close();
  }
});
it("exposes complete inert source after failure instead of blocking synchronous parse", () => {
  const f = fixture();
  const text = "<script>unsafe()</script>\n\n" + "source ".repeat(20000);
  try {
    f.render(text);
    act(() => ControlledWorker.current.onerror!({} as ErrorEvent));
    expect(f.container.textContent).toContain("Formatted preview unavailable. Showing source.");
    expect(f.container.textContent).toContain(text);
    expect(f.container.querySelector("script")).toBeNull();
    expect(f.container.querySelector('[aria-busy="true"]')).toBeNull();
  } finally {
    f.close();
  }
});
it("labels source fallback when workers are unavailable", () => {
  const f = fixture();
  const text = "**Complete source**\n\n" + "source ".repeat(20000);
  try {
    vi.stubGlobal("Worker", undefined);
    f.render(text);
    expect(f.container.textContent).toContain("Formatted preview unavailable. Showing source.");
    expect(f.container.textContent).toContain(text);
    expect(f.container.textContent).not.toContain("Rendering Markdown");
  } finally {
    f.close();
  }
});
