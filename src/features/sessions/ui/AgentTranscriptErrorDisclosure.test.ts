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
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
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
  it("keeps grouped error output collapsed until its failed row is clicked", () => {
    const blocks: Block[] = [
      { id: "user", role: "user", text: "Start the app" },
      {
        id: "command",
        role: "tool",
        text: "Run npm run dev",
        tool: {
          kind: "shell",
          status: "failed",
          detail: "Error: listen EPERM\n    at Server.setupListenHandle",
        },
      },
    ];

    act(() => root.render(createElement(AgentTranscript, { blocks, busy: true })));

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Show error details for"]',
    );
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("Server.setupListenHandle");

    const failedRow = container.querySelector<HTMLElement>('[aria-label^="Failed tool call:"]');
    const message = Array.from(failedRow?.querySelectorAll("span") ?? []).find((element) =>
      element.textContent?.includes("npm run dev"),
    );
    expect(message).not.toBeNull();

    act(() => message?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Server.setupListenHandle");

    act(() => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("Server.setupListenHandle");
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
    const trigger = row?.querySelector<HTMLButtonElement>(
      'button[aria-label="Show output for bycoda: List notes"]',
    );
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(row?.querySelector("pre")).toBeNull();
    expect(row?.textContent).toContain("Ranbycoda app notes.list");
    expect(row?.querySelector('img[src="/brand/bycoda/mark-black.svg"]')).not.toBeNull();
    expect(row?.querySelector("[class*=ui-surface-raised]")).not.toBeNull();
    expect(container.textContent).not.toContain("Contents/MacOS/bycoda");
    expect(container.textContent).not.toContain('"title":"Ideas"');
    act(() => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    act(() => row?.querySelector<HTMLButtonElement>('button[aria-label="Expand all"]')?.click());
    expect(row?.textContent).toContain("Ideas");
  });

  it("reveals a failed call's error when clicked", () => {
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

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Show error details for bycoda: List notes"]',
    );
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("Connection refused");

    act(() => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Connection refused");
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
    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label^="Show error details for"]')!
        .click(),
    );
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
        tool: { kind: "shell", status: "completed", detail: "Build succeeded: output-marker" },
      },
    ];
    act(() => root.render(createElement(AgentTranscript, { blocks, busy: true })));
    expect(container.querySelector("[data-tool-inspection]")).toBeNull();
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Show output for"]',
    );
    expect(trigger).not.toBeNull();
    act(() => trigger?.click());
    expect(container.querySelector("[data-tool-inspection]")?.textContent).toContain(
      "output-marker",
    );
    expect(container.querySelector("[data-tool-inspection] pre")?.className).toContain(
      "select-text",
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
            inspection: { kind: "content", text: "full code\nlast-line-marker", truncated: true },
          },
        },
      },
    ];
    act(() => root.render(createElement(AgentTranscript, { blocks, busy: true, onOpenFile })));
    expect(container.textContent).not.toContain("last-line-marker");
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Show changes for"]',
    );
    act(() => trigger?.click());
    expect(container.querySelector("[data-tool-inspection]")?.textContent).toContain(
      "last-line-marker",
    );
    expect(container.textContent).toContain("Content shortened");
    expect(onOpenFile).not.toHaveBeenCalled();
  });
});
