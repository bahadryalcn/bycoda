// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelSwitchMeta } from "../model/modelSwitchHistory";
import { changedEffort, earlierStates, ModelSwitchRow } from "./ModelSwitchRow";

vi.mock("../../providers/model/useProviderAccounts", () => ({
  useProviderAccounts: (provider: string | null) =>
    provider === "claude"
      ? [
          { id: "default", provider, label: "Personal", isDefault: true },
          { id: "p2", provider, label: "Personal 2" },
          { id: "p3", provider, label: "Team" },
        ]
      : [],
}));

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
const note = () => container.querySelector('[role="note"]')!;

describe("ModelSwitchRow", () => {
  it("is a divider with hairlines that reads as one sentence", () => {
    render({
      steps: [
        { harness: "claude", account: "work", model: "Opus 5.5", at: 1 },
        { harness: "codex", model: "GPT-5.5", at: 2, note: "summary" },
      ],
    });
    expect(note().getAttribute("aria-label")).toBe(
      "Switched from Claude Code · work · Opus 5.5 to Codex · GPT-5.5. Summary goes with next message",
    );
    expect(container.querySelectorAll("[data-orientation=horizontal]")).toHaveLength(2);
    expect(container.querySelector("button, summary")).toBeNull();
  });

  it("shows the numbered account chip for a switch between two accounts of one model", () => {
    render({
      steps: [
        { harness: "claude", account: "Personal 2", accountId: "p2", model: "Opus 5.5", at: 1 },
        { harness: "claude", account: "Team", accountId: "p3", model: "Opus 5.5", at: 2 },
      ],
    });
    const chips = [...container.querySelectorAll("[data-model-account-number]")].map(
      (chip) => chip.textContent,
    );
    expect(chips).toEqual(["2", "3"]);
    // The label is not visible next to the chip, so the sentence and tooltip carry it.
    expect(note().textContent).not.toContain("Team");
    expect(note().getAttribute("aria-label")).toBe(
      "Switched from Claude Code · Personal 2 · Opus 5.5 to Claude Code · Team · Opus 5.5",
    );
  });

  it("collapses several hops into one row listing the earlier ones", () => {
    render({
      steps: [
        { harness: "claude", model: "6.2 Astra", at: 1 },
        { harness: "codex", model: "6.2 Sol", at: 2 },
        { harness: "claude", model: "Opus 5.5", at: 3 },
      ],
    });
    expect(container.querySelectorAll('[role="note"]')).toHaveLength(1);
    expect(note().textContent).toContain("6.2 Astra");
    expect(note().textContent).toContain("6.2 Sol");
    expect(note().getAttribute("aria-label")).toBe(
      "Switched from Claude Code · 6.2 Astra, Codex · 6.2 Sol to Claude Code · Opus 5.5",
    );
  });

  it("folds hops past the cap into a count", () => {
    render({
      steps: ["A", "B", "C", "D", "E", "F"].map((model, at) => ({
        harness: "claude" as const,
        model,
        at,
      })),
    });
    expect(note().textContent).toContain("+2");
    expect(note().textContent).not.toContain("A");
  });

  it("renders an old row without an account id from its label", () => {
    render({
      steps: [
        { harness: "claude", account: "Personal", model: "Opus 5.5", at: 1 },
        { harness: "claude", account: "work", model: "Sonnet 5.5", at: 2 },
      ],
    });
    expect(container.querySelector("[data-model-account-number]")).toBeNull();
    expect(note().textContent).toContain("work");
    expect(note().textContent).toContain("Personal");
  });

  it("shows effort only when it changed", () => {
    render({
      steps: [
        { harness: "claude", model: "Opus 5.5", effort: "High", at: 1 },
        { harness: "claude", model: "Sonnet 5.5", effort: "High", at: 2 },
      ],
    });
    expect(container.querySelector("[data-model-effort]")).toBeNull();
    render({
      steps: [
        { harness: "claude", model: "Opus 5.5", effort: "High", at: 1 },
        { harness: "claude", model: "Sonnet 5.5", effort: "Low", at: 2 },
      ],
    });
    expect(container.querySelector("[data-model-effort]")?.textContent).toBe("Low");
  });

  it("names the next-message note without a visible duplicate label", () => {
    render({
      steps: [
        { harness: "claude", model: "Opus 5.5", at: 1 },
        { harness: "claude", model: "Sonnet 5.5", at: 2, note: "deferred" },
      ],
    });
    expect(note().getAttribute("aria-label")).toContain("Next message");
    expect(note().textContent).not.toContain("Next message");
  });
});

describe("switch row helpers", () => {
  it("drops a hop that repeats the one before it", () => {
    const hop = { harness: "claude" as const, model: "A", at: 1 };
    expect(earlierStates([hop, { ...hop, at: 2 }, { ...hop, model: "B", at: 3 }])).toHaveLength(1);
  });

  it("reports effort only when it differs", () => {
    const high = { harness: "claude" as const, model: "A", effort: "High" };
    expect(changedEffort(high, high)).toBeUndefined();
    expect(changedEffort(undefined, high)).toBe("High");
    expect(changedEffort(high, { ...high, effort: "Low" })).toBe("Low");
  });
});
