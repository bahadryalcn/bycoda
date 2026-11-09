// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelSwitchMeta } from "../model/modelSwitchHistory";
import { ModelSwitchRow } from "./ModelSwitchRow";

let container: HTMLDivElement;
let root: Root;

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

const render = (meta: ModelSwitchMeta) =>
  act(() => root.render(createElement(ModelSwitchRow, { meta })));

describe("ModelSwitchRow", () => {
  it("shows one switch as a single row without history", () => {
    render({
      steps: [
        { harness: "claude", account: "work", model: "Opus 5.5", at: 1 },
        { harness: "codex", model: "GPT-5.5", at: 2, note: "summary" },
      ],
    });
    const row = container.querySelector('[role="note"]');
    expect(row?.getAttribute("aria-label")).toBe(
      "Switched from Claude Code · work · Opus 5.5 to Codex · GPT-5.5",
    );
    expect(row?.textContent).toContain("Summary goes with next message");
    expect(container.querySelector("button")).toBeNull();
  });

  it("counts folded switches and opens their timed history", () => {
    render({
      steps: [
        { harness: "claude", account: "Personal", model: "Opus 5.5", at: 1 },
        { harness: "claude", account: "work", model: "Opus 5.5", at: 2 },
        { harness: "claude", account: "work", model: "Sonnet 5.5", at: 3 },
        { harness: "claude", account: "Personal", model: "Sonnet 5.5", at: 4, note: "deferred" },
      ],
    });
    const button = container.querySelector("button")!;
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.textContent).toContain("work");
    expect(button.textContent).toContain("Personal");
    expect(button.textContent).toContain("3");
    expect(button.textContent).toContain("Next message");
    expect(container.querySelector("ol")).toBeNull();
    act(() => button.click());
    const rows = [...container.querySelectorAll("li")].map((item) => item.textContent ?? "");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain("Before");
    expect(rows[1]).toContain("Account");
    expect(rows[2]).toContain("Model");
    expect(rows[3]).toContain("Now");
    expect(container.querySelectorAll("li time")).toHaveLength(3);
  });
});
