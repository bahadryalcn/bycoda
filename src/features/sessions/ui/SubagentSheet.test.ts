// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Block } from "../model/session";

vi.mock("../../../app/shell/GlassBackdrop", () => ({ GlassBackdrop: () => null }));
vi.mock("./AgentTranscript", () => ({ ActivityRow: () => null, agentStepBlock: () => null }));

import { ActivityDock } from "./ActivityDock";
import { SubagentSheet, useSubagentSheet } from "./SubagentSheet";

/** Hovers a control until the shared tooltip opens and returns its text (key caps included). */
async function tooltipText(element: HTMLElement): Promise<string> {
  await act(async () => {
    element.dispatchEvent(new Event("pointerover", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 520));
  });
  const text = document.querySelector('[role="tooltip"]')?.textContent ?? "";
  await act(async () => {
    element.dispatchEvent(new Event("pointerout", { bubbles: true }));
  });
  return text;
}
/** The sheet's Stop action, found by its visible label. */
function stopButton(dialog: Element | null) {
  return (
    [...(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (button) => button.textContent?.trim() === "Stop",
    ) ?? null
  );
}

const command: Block = {
  id: "command-1",
  role: "tool",
  text: "pnpm test --watch",
  tool: { callId: "background:1", kind: "execute", status: "in_progress", background: true },
};
let container: HTMLDivElement;
let root: Root;

function Harness({
  block,
  onStop,
}: {
  block: Block;
  onStop: ComponentProps<typeof SubagentSheet>["onStop"];
}) {
  const sheet = useSubagentSheet([block], true);
  return createElement(
    "div",
    { "data-session-drop": "" },
    createElement(ActivityDock, {
      sessionId: "command-details-test",
      blocks: [block],
      busy: true,
      pendingQuestion: false,
      atEnd: true,
      onOpenAgent: (agent) => sheet.open(agent.blockId),
    }),
    sheet.block
      ? createElement(SubagentSheet, {
          block: sheet.block,
          busy: true,
          visible: true,
          cwd: "G:/project",
          onClose: sheet.close,
          onStop,
          onShowInTranscript: vi.fn(),
        })
      : null,
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("lists nested running and past subagents and expands their live trails", () => {
  const nested = (status: string, text: string): Block =>
    ({
      id: "child",
      role: "tool",
      text: "Child",
      tool: { kind: "subagent", status: "in_progress" },
      agentRun: {
        name: "Child",
        steps: [
          {
            id: "native",
            kind: "tool",
            toolKind: "subagent",
            text: "Review",
            status,
            agentRun: {
              name: "Native reviewer",
              model: "claude-sonnet-4-6",
              steps: [{ id: "result", kind: "message", text }],
            },
          },
          {
            id: "past",
            kind: "tool",
            toolKind: "subagent",
            text: "Earlier",
            status: "failed",
            agentRun: { name: "Earlier reviewer", steps: [] },
          },
        ],
      },
    }) as Block;
  const render = (block: Block, busy = true) =>
    act(() =>
      root.render(
        createElement(
          "div",
          { "data-session-drop": "" },
          createElement(SubagentSheet, {
            block,
            busy,
            visible: true,
            onClose: vi.fn(),
          }),
        ),
      ),
    );
  render(nested("in_progress", "Checking parser"));
  expect(container.textContent).toContain("Subagents · 1 running · 1 past");
  const disclosure = container.querySelector<HTMLDetailsElement>("[data-nested-subagent='native']");
  expect(disclosure).not.toBeNull();
  expect(disclosure?.querySelector("summary")?.textContent).toContain("Native reviewer");
  expect(disclosure?.querySelector("summary")?.textContent).toContain("Sonnet");
  expect(disclosure?.querySelector("summary")?.textContent).toContain("Running");
  act(() => {
    disclosure!.open = true;
    disclosure!.dispatchEvent(new Event("toggle"));
  });
  expect(disclosure?.textContent).toContain("Checking parser");
  render(nested("completed", "Parser verified"), false);
  expect(container.textContent).toContain("Subagents · 0 running · 2 past");
  expect(disclosure?.open).toBe(true);
  expect(disclosure?.textContent).toContain("Parser verified");
  expect(disclosure?.querySelector("summary")?.textContent).toContain("Done");
  expect(container.querySelector("[data-nested-subagent='past'] summary")?.textContent).toContain(
    "Failed",
  );
  expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
});

it("names an advisor correctly and keeps its request form outside the message form", () => {
  const advisor: Block = {
    id: "advisor",
    role: "tool",
    text: "Review",
    tool: { kind: "agent", callId: "advisor", status: "in_progress" },
    agentRun: { name: "Reviewer", prompt: "Review changes", steps: [] },
  };
  act(() =>
    root.render(
      createElement(
        "div",
        { "data-session-drop": "" },
        createElement(SubagentSheet, {
          block: advisor,
          busy: true,
          visible: true,
          agentRole: "advisor",
          onClose: vi.fn(),
          requests: createElement(
            "form",
            { "data-request-form": "" },
            createElement("button", { type: "submit" }, "Answer"),
          ),
          relay: { mode: "direct", draft: "draft", setDraft: vi.fn(), send: vi.fn() },
        }),
      ),
    ),
  );
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Advisor: Reviewer");
  const request = container.querySelector("[data-request-form]");
  expect(request).not.toBeNull();
  expect(request?.parentElement?.closest("form")).toBeNull();
  expect(container.querySelector("textarea")?.value).toBe("draft");
});

it("opens the detail on clicking a background command and updates incoming output", async () => {
  const onStop = vi.fn().mockResolvedValue(undefined);
  act(() => root.render(createElement(Harness, { block: command, onStop })));
  const toggle = container.querySelector<HTMLButtonElement>("[data-dock-toggle]");
  if (toggle?.getAttribute("aria-expanded") === "false") act(() => toggle.click());
  act(() => container.querySelector<HTMLButtonElement>("[data-dock-agent]")?.click());
  const dialog = container.querySelector('[role="dialog"]');
  expect(dialog).not.toBeNull();
  expect(dialog?.textContent).toContain("pnpm test --watch");
  expect(dialog?.textContent).toContain("G:/project");
  expect(dialog?.textContent).toContain("Running");
  expect(dialog?.textContent).toContain("No output has been reported");
  const stop = stopButton(dialog);
  expect(stop).not.toBeNull();
  expect(await tooltipText(stop!)).toBe("Stop this command");
  await act(async () => stop?.click());
  expect(onStop).toHaveBeenCalledOnce();
  act(() =>
    root.render(
      createElement(Harness, {
        block: {
          ...command,
          tool: {
            ...command.tool,
            status: "completed",
            detail: "Tests passed",
            preview: { kind: "shell", output: "3 passed" },
          },
        },
        onStop,
      }),
    ),
  );
  expect(dialog?.textContent).toContain("3 passed");
  expect(dialog?.textContent).toContain("Tests passed");
  expect(dialog?.textContent).toContain("Done");
  expect(stopButton(dialog)).toBeNull();
  act(() =>
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});
