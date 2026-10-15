// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Block } from "../model/session";

vi.mock("../../../app/shell/GlassBackdrop", () => ({ GlassBackdrop: () => null }));
vi.mock("./AgentTranscript", () => ({ ActivityRow: () => null, agentStepBlock: () => null }));

import { ActivityDock } from "./ActivityDock";
import { SubagentSheet, useSubagentSheet } from "./SubagentSheet";

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

it("arka plan komutuna tıklayınca detayını açar ve gelen çıktıyı günceller", async () => {
  const onStop = vi.fn().mockResolvedValue(undefined);
  act(() => root.render(createElement(Harness, { block: command, onStop })));
  const toggle = container.querySelector<HTMLButtonElement>("button[aria-expanded]");
  if (toggle?.getAttribute("aria-expanded") === "false") act(() => toggle.click());
  act(() => container.querySelector<HTMLButtonElement>("[data-dock-agent]")?.click());
  const dialog = container.querySelector('[role="dialog"]');
  expect(dialog).not.toBeNull();
  expect(dialog?.textContent).toContain("pnpm test --watch");
  expect(dialog?.textContent).toContain("G:/project");
  expect(dialog?.textContent).toContain("Running");
  expect(dialog?.textContent).toContain("No output has been reported");
  const stop = dialog?.querySelector<HTMLButtonElement>('button[title="Stop this command"]');
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
  expect(dialog?.querySelector('button[title="Stop this command"]')).toBeNull();
  act(() =>
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});
