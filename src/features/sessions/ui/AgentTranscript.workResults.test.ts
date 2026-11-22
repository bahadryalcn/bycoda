// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { AgentTranscript } from "./AgentTranscript";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render(
  blocks: Block[],
  options: Partial<ComponentProps<typeof AgentTranscript>> = {},
) {
  await act(async () =>
    root.render(createElement(AgentTranscript, { blocks, cwd: "/repo", ...options })),
  );
}

function resultCards() {
  return Array.from(host.querySelectorAll<HTMLElement>("[data-transcript-work-results]"));
}

async function openResults(card: HTMLElement) {
  await act(async () => card.querySelector<HTMLElement>("summary")?.click());
}

function button(card: HTMLElement, label: string) {
  return Array.from(card.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) =>
      candidate.getAttribute("aria-label") === label || candidate.textContent?.trim() === label,
  );
}

it("keeps each settled turn's retained results separate and excludes private and pending work", async () => {
  await render([
    { id: "one", role: "user", text: "Check typing" },
    {
      id: "typescript",
      role: "tool",
      text: "pnpm typecheck",
      tool: { status: "completed", output: "First turn only." },
    },
    {
      id: "internal",
      role: "tool",
      internal: true,
      text: "Hidden tool",
      tool: { status: "completed", output: "Private output" },
    },
    {
      id: "internal-cli",
      role: "tool",
      text: "bycoda app sessions.read --json 'abc'",
      tool: { status: "completed", output: "Scoped response" },
    },
    {
      id: "approval",
      role: "tool",
      text: "Awaiting approval",
      approval: { requestId: 1 },
      tool: { status: "completed", output: "Pending result" },
    },
    { id: "one-answer", role: "assistant", text: "Typing finished" },
    { id: "two", role: "user", text: "Run tests" },
    {
      id: "tests",
      role: "tool",
      text: "pnpm test",
      tool: { status: "failed", detail: "Second turn failure." },
    },
    { id: "two-answer", role: "assistant", text: "Tests finished" },
  ]);
  const [first, second] = resultCards();
  expect(resultCards()).toHaveLength(2);
  expect(first.querySelector("[data-tool-inspection]")).toBeNull();
  await openResults(first);
  expect(first.textContent).toContain("First turn only.");
  expect(first.textContent).not.toMatch(
    /Private output|Scoped response|Pending result|Second turn failure/,
  );
  await openResults(second);
  expect(second.textContent).toContain("Second turn failure.");
  expect(second.textContent).not.toContain("First turn only.");
});

it("opens the selected result's exact source and uses the native inspector copy action", async () => {
  const openDiff = vi.fn();
  const openFile = vi.fn();
  const edit: Block = {
    id: "edit",
    role: "tool",
    text: "Edit src/voice.ts",
    tool: {
      title: "Edit src/voice.ts",
      status: "completed",
      preview: {
        kind: "write",
        path: "/repo/src/voice.ts",
        inspection: { kind: "diff", text: "+export const voice = true;" },
      },
    },
  };
  await render(
    [
      { id: "turn", role: "user", text: "Edit voice" },
      edit,
      { id: "reply", role: "assistant", text: "Updated voice" },
    ],
    { onOpenDiff: openDiff, onOpenFile: openFile },
  );
  const [card] = resultCards();
  await openResults(card);
  expect(card.textContent).toContain("+export const voice = true;");
  await act(async () => button(card, "Open changes")?.click());
  expect(openDiff).toHaveBeenCalledExactlyOnceWith("/repo/src/voice.ts");
  expect(openFile).not.toHaveBeenCalled();
  await act(async () => button(card, "Copy")?.click());
  expect(await navigator.clipboard.readText()).toBe("+export const voice = true;");
});
