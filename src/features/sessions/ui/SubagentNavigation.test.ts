// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { AgentTranscript } from "./AgentTranscript";
import { SubagentSheet, useSubagentSheet } from "./SubagentSheet";

vi.mock("../../../app/shell/GlassBackdrop", () => ({ GlassBackdrop: () => null }));

let container: HTMLDivElement;
let root: Root;
const onOpenFile = vi.fn();
const onOpenDiff = vi.fn();

function Harness({ block, busy }: { block: Block; busy: boolean }) {
  const blocks: Block[] = [{ id: "user", role: "user", text: "Read some files" }, block];
  const sheet = useSubagentSheet(blocks, true);
  return createElement(
    "div",
    { "data-session-drop": "" },
    createElement(AgentTranscript, { blocks, busy, cwd: "G:/project", onOpenFile, onOpenDiff }),
    sheet.block
      ? createElement(SubagentSheet, {
          block: sheet.block,
          busy,
          visible: true,
          cwd: "G:/project",
          onClose: sheet.close,
          onShowInTranscript: vi.fn(),
          onOpenFile,
          onOpenDiff,
        })
      : null,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
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

const agent: Block = {
  id: "agent",
  role: "tool",
  text: "File click test subagent",
  tool: { callId: "spawn", kind: "agent", status: "in_progress" },
  agentRun: { name: "File click test subagent", prompt: "Inspect the requested files", steps: [] },
};

it.each([true, false])("opens an empty subagent's panel (busy=%s)", (busy) => {
  act(() => root.render(createElement(Harness, { block: agent, busy })));
  const button = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Open File click test subagent in its own panel"]',
  );
  expect(button).not.toBeNull();
  act(() => button!.click());
  const panel = container.querySelector('[role="dialog"]');
  expect(panel?.textContent).toContain("Inspect the requested files");
  expect(panel?.textContent).toContain(
    busy ? "Waiting for the first step." : "This agent did not report any steps.",
  );
});

it("keeps the panel open as steps arrive and opens read/write files from their rows", () => {
  act(() => root.render(createElement(Harness, { block: agent, busy: true })));
  act(() =>
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Open File click test subagent in its own panel"]',
      )!
      .click(),
  );
  const updated: Block = {
    ...agent,
    agentRun: {
      ...agent.agentRun!,
      steps: [
        {
          id: "read",
          kind: "tool",
          text: "Read src/read.ts",
          toolKind: "read",
          status: "completed",
          preview: { kind: "read", path: "G:/project/src/read.ts", fileName: "read.ts" },
        },
        {
          id: "write",
          kind: "tool",
          text: "Write src/write.ts",
          toolKind: "write",
          status: "completed",
          preview: { kind: "write", path: "G:/project/src/write.ts", fileName: "write.ts" },
        },
      ],
    },
  };
  act(() => root.render(createElement(Harness, { block: updated, busy: true })));
  const panel = container.querySelector('[role="dialog"]')!;
  const read = panel.querySelector<HTMLButtonElement>('button[title="src/read.ts"]');
  const write = panel.querySelector<HTMLButtonElement>('button[title="src/write.ts"]');
  expect(read).not.toBeNull();
  expect(write).not.toBeNull();
  act(() => read!.click());
  act(() => write!.click());
  expect(onOpenFile).toHaveBeenCalledWith("G:/project/src/read.ts");
  expect(onOpenDiff).toHaveBeenCalledWith("G:/project/src/write.ts");
});
