// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { ActivityDock } from "./ActivityDock";
import { SessionWorkSummary } from "./SessionWorkSummary";

const completed: Block = {
  id: "check",
  role: "tool",
  text: "check syntax",
  tool: { kind: "shell", status: "completed", output: "  syntax OK\n" },
};
const failed: Block = {
  id: "test",
  role: "tool",
  text: "run tests",
  tool: { kind: "shell", status: "failed", detail: "test failed\n" },
};
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function dialog() {
  return document.querySelector<HTMLElement>('[role="dialog"][aria-label="Work summary"]');
}

async function clickButton(name: string) {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) =>
      candidate.getAttribute("aria-label") === name || candidate.textContent?.trim() === name,
  );
  expect(button).toBeDefined();
  await act(async () => button?.click());
}

it("filters retained results and copies the real selected output", async () => {
  await act(async () =>
    root.render(createElement(SessionWorkSummary, { tools: [completed, failed], busy: false })),
  );
  await clickButton("Work summary");
  expect(dialog()?.textContent).toContain("test failed");

  await clickButton("Completed");
  expect(dialog()?.textContent).not.toContain("run tests");
  expect(dialog()?.querySelector("pre")?.textContent).toBe("  syntax OK\n");
  await clickButton("Copy output");
  expect(await navigator.clipboard.readText()).toBe("  syntax OK\n");
});

it("keeps the preview mounted as the turn finishes and opens the live workspace on request", async () => {
  const open = vi.fn();
  const request: Block = { id: "turn", role: "user", text: "Check syntax" };
  const active: Block = {
    ...completed,
    tool: { kind: "shell", status: "running" },
  };
  const render = async (tool: Block, busy: boolean) =>
    act(async () =>
      root.render(
        createElement(ActivityDock, {
          sessionId: "preview",
          blocks: [request, tool],
          busy,
          pendingQuestion: false,
          atEnd: true,
          onOpenAgent: () => {},
          workControl: createElement(SessionWorkSummary, {
            tools: [tool],
            busy,
            onOpenLiveWork: open,
          }),
        }),
      ),
    );
  await render(active, true);
  await clickButton("Work summary");
  expect(dialog()?.textContent).toContain("Running. No output");
  await render(completed, false);
  expect(dialog()?.querySelector("pre")?.textContent).toBe("  syntax OK\n");
  await clickButton("View live work");
  expect(open).toHaveBeenCalledOnce();
  expect(dialog()).toBeNull();
});
