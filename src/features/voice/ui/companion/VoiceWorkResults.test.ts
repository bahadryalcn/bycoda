// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { VoiceLiveResult } from "../../model/voiceLiveWork";
import { VoiceWorkResults } from "./VoiceWorkResults";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(results: readonly VoiceLiveResult[]) {
  await act(async () => root.render(createElement(VoiceWorkResults, { results })));
}

it("renders each observed result type through the validated program", async () => {
  await render([
    { kind: "tests", status: "failed", passed: 12, failed: 1, skipped: 2 },
    { kind: "build", status: "done" },
    { kind: "changes", status: "done", files: 3, additions: 10, deletions: 2 },
    { kind: "commands", status: "failed", count: 2 },
    {
      kind: "actions",
      status: "interrupted",
      actions: [{ id: "a", name: "workspace.notes.create", status: "interrupted" }],
    },
  ]);
  const text = container.textContent ?? "";
  for (const label of [
    "Test run",
    "Passed",
    "12",
    "Build",
    "Changes",
    "Commands",
    "notes create",
  ]) {
    expect(text).toContain(label);
  }
  expect(container.querySelectorAll("section")).toHaveLength(5);
  expect(container.querySelector("button")).toBeNull();
});

it("keeps action names as React text outside the OpenUI program", async () => {
  const literal = 'x");root = TestResult("done",1,1,1)<img src=x>';
  await render([
    {
      kind: "actions",
      status: "done",
      actions: [{ id: "a", name: literal, status: "done" }],
    },
  ]);
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toContain("<img src=x>");
  expect(container.textContent).not.toContain("Test run");
});

it("renders nothing without results", async () => {
  await render([]);
  expect(container.textContent).toBe("");
});
