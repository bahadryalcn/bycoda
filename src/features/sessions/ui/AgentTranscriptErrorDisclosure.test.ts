// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { AgentTranscript } from "./AgentTranscript";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // Reduced motion: a closing row unmounts its body at once instead of waiting for the collapse.
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("tool error disclosure", () => {
  it("opens a failed command's output by itself and lets the reader close it", () => {
    const blocks: Block[] = [
      { id: "user", role: "user", text: "Start the app" },
      {
        id: "command",
        role: "tool",
        text: "Run npm run dev",
        tool: {
          kind: "shell",
          status: "failed",
          detail:
            "\u001b[?9001h\u001b]0;pwsh.exe\u0007\r\nError: listen EPERM\n    at Server.setupListenHandle",
        },
      },
    ];

    act(() => root.render(createElement(AgentTranscript, { blocks, busy: true })));

    // A failed command opens its output by itself; terminal control sequences stay stripped.
    const trigger = container.querySelector<HTMLElement>(
      'summary[aria-label^="Hide error details for"]',
    );
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Error: listen EPERM");
    expect(container.textContent).toContain("Server.setupListenHandle");
    expect(container.textContent).not.toContain("pwsh.exe");
    expect(container.textContent).not.toContain("");

    // The reader's toggle wins over the automatic opening.
    act(() => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("Server.setupListenHandle");
    act(() => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("Bycoda CLI disclosure", () => {
  it("keeps a successful result compact and makes it inspectable on click", () => {
    const command = "/repo/target/debug/Bycoda.app/Contents/MacOS/bycoda app notes.list";
    const blocks: Block[] = [
      { id: "user", role: "user", text: "/bycoda list notes" },
      {
        id: "notes",
        role: "tool",
        text: command,
        tool: {
          kind: "shell",
          status: "completed",
          detail: '{"ok":true,"result":{"notes":[{"title":"Ideas"}]}}',
        },
      },
    ];
    act(() => root.render(createElement(AgentTranscript, { blocks, busy: true })));

    const row = container.querySelector<HTMLElement>('[data-bycoda-tool-call="notes.list"]');
    const trigger = row?.querySelector<HTMLElement>(
      'summary[aria-label="Show output for bycoda: List notes"]',
    );
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(row?.querySelector("pre")).toBeNull();
    expect(row?.textContent).toContain("Ranbycoda app notes.list");
    expect(
      row?.querySelector(
        'img[src="/brand/bycoda/mark-black.svg"], img[src="/brand/bycoda/mark-white.svg"]',
      ),
    ).not.toBeNull();
    expect(container.textContent).not.toContain("Contents/MacOS/bycoda");
    expect(container.textContent).not.toContain('"title":"Ideas"');
    act(() => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    // A small payload has no expand-all control; open its collapsed branches row by row.
    for (let pass = 0; pass < 4; pass += 1) {
      const next = row?.querySelector<HTMLElement>('[role="treeitem"][aria-expanded="false"]');
      if (!next) break;
      act(() => next.click());
    }
    expect(row?.textContent).toContain("Ideas");
  });

  it("shows a failed call's error and opens its output when clicked", () => {
    const blocks: Block[] = [
      { id: "user", role: "user", text: "/bycoda list notes" },
      {
        id: "notes",
        role: "tool",
        text: "bycoda app notes.list",
        tool: { kind: "shell", status: "failed", detail: "Connection refused" },
      },
    ];
    act(() => root.render(createElement(AgentTranscript, { blocks, busy: true })));

    const trigger = container.querySelector<HTMLElement>(
      'summary[aria-label="Show error details for bycoda: List notes"]',
    );
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    const count = () => (container.textContent ?? "").split("Connection refused").length - 1;
    expect(count()).toBe(1);

    act(() => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(count()).toBe(2);
  });
});

describe("tool output inspection", () => {
  it("shows a later failure first while preserving earlier useful output", () => {
    const blocks: Block[] = [
      { id: "user", role: "user", text: "Run checks" },
      {
        id: "tool",
        role: "tool",
        text: "Run pnpm test",
        tool: {
          kind: "shell",
          status: "failed",
          output: "Compilation succeeded",
          detail: "Tests failed: assertion mismatch",
        },
      },
    ];
    act(() => root.render(createElement(AgentTranscript, { blocks, busy: true })));
    // The failed row is already open.
    const sections = Array.from(container.querySelectorAll("[data-tool-inspection] section"));
    expect(sections[0].querySelector("h4")?.textContent).toBe("Error");
    expect(sections[0].textContent).toContain("Tests failed: assertion mismatch");
    expect(sections[1].querySelector("h4")?.textContent).toBe("Output");
    expect(sections[1].textContent).toContain("Compilation succeeded");
  });

  it("reveals a successful top-level command result only when requested", () => {
    const blocks: Block[] = [
      { id: "user", role: "user", text: "Inspect the app" },
      {
        id: "tool",
        role: "tool",
        text: "Run pnpm build",
        tool: {
          kind: "shell",
          status: "completed",
          detail: "Build succeeded: output-marker",
        },
      },
    ];
    act(() => root.render(createElement(AgentTranscript, { blocks, busy: true })));
    expect(container.querySelector("[data-tool-inspection]")).toBeNull();
    const trigger = container.querySelector<HTMLElement>('summary[aria-label^="Show output for"]');
    expect(trigger).not.toBeNull();
    act(() => trigger?.click());
    expect(container.querySelector("[data-tool-inspection]")?.textContent).toContain(
      "output-marker",
    );
    expect(container.querySelector("[data-tool-inspection] pre")?.getAttribute("data-face")).toBe(
      "mono",
    );
    act(() => trigger?.click());
    expect(container.querySelector("[data-tool-inspection]")).toBeNull();
  });

  it("opens retained code beyond the small preview without reading the current file", () => {
    const onOpenFile = vi.fn();
    const blocks: Block[] = [
      { id: "user", role: "user", text: "Write the app" },
      {
        id: "tool",
        role: "tool",
        text: "Write src/App.tsx",
        tool: {
          kind: "write",
          status: "completed",
          preview: {
            kind: "write",
            path: "src/App.tsx",
            contentOnly: true,
            lines: [{ kind: "context", text: "short preview" }],
            inspection: {
              kind: "content",
              text: "full code\nlast-line-marker",
              truncated: true,
            },
          },
        },
      },
    ];
    act(() => root.render(createElement(AgentTranscript, { blocks, busy: true, onOpenFile })));
    expect(container.textContent).not.toContain("last-line-marker");
    const trigger = container.querySelector<HTMLElement>('summary[aria-label^="Show changes for"]');
    act(() => trigger?.click());
    expect(container.querySelector("[data-tool-inspection]")?.textContent).toContain(
      "last-line-marker",
    );
    expect(container.textContent).toContain("Content shortened");
    expect(onOpenFile).not.toHaveBeenCalled();
  });
});
