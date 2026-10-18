// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveAgent } from "../model/liveAgents";
import { LiveAgentsPreview } from "./LiveAgentsPreview";

let container: HTMLDivElement;
let root: Root;

function agent(id: string, cwd: string, patch: Partial<LiveAgent> = {}): LiveAgent {
  return {
    id,
    cwd,
    title: `Agent ${id}`,
    harness: "codex",
    activity: "Working",
    startedAt: 1_000,
    needsApproval: false,
    done: false,
    ...patch,
  };
}

function render(props: ComponentProps<typeof LiveAgentsPreview>) {
  act(() => root.render(createElement(LiveAgentsPreview, props)));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    clear: () => stored.clear(),
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("LiveAgentsPreview", () => {
  it("names questions separately from action approvals", () => {
    render({
      agents: [
        agent("question", "/repo/a", { needsApproval: true, inputKind: "question" }),
        agent("approval", "/repo/b", { needsApproval: true, inputKind: "approval" }),
      ],
    });
    const question = container.querySelector('[data-live-agent-card="question"]')!;
    const approval = container.querySelector('[data-live-agent-card="approval"]')!;
    expect(question.textContent).toContain("Question");
    expect(question.getAttribute("aria-label")).toContain("Question");
    expect(question.textContent).not.toContain("Need approval");
    expect(approval.textContent).toContain("Need approval");
  });

  it("collapses the working list while retaining its count and session selection", () => {
    const onSelect = vi.fn();
    render({
      agents: [agent("a", "/repo/a"), agent("b", "/repo/b")],
      collapsible: true,
      onSelect,
    });
    const header = container.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    const card = container.querySelector<HTMLButtonElement>('[data-live-agent-card="b"]')!;
    expect(header.getAttribute("aria-expanded")).toBe("true");
    act(() => header.click());
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(card.closest("[hidden]")).not.toBeNull();
    expect(header.textContent).toContain("2");
    expect(onSelect).not.toHaveBeenCalled();
    act(() => header.click());
    expect(card.closest("[hidden]")).toBeNull();
    act(() => card.click());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("b");
  });

  it("keeps the incoming activity order and the global four-agent cap", () => {
    render({
      agents: [
        agent("a-1", "/repo/a"),
        agent("b-1", "/repo/b", { needsApproval: true }),
        agent("a-2", "/repo/a"),
        agent("b-2", "/repo/b"),
        agent("c-1", "/repo/c"),
      ],
      groupLabels: { "/repo/a": "Alpha", "/repo/b": "Beta" },
      groupColors: {},
      groupCustomColors: {},
      groupMascots: {},
    });

    const cards = Array.from(container.querySelectorAll<HTMLElement>("[data-live-agent-card]"));
    expect(cards.map((card) => card.dataset.liveAgentCard)).toEqual(["a-1", "b-1", "a-2", "b-2"]);
    expect(cards[0].textContent).toContain("Alpha");
    expect(cards[1].textContent).toContain("Beta");
    expect(cards[0].querySelector(".bycoda-sigil-active")).not.toBeNull();
    expect(container.textContent).toContain("1 more");

    const more = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("1 more"),
    )!;
    act(() => more.click());
    expect(container.querySelectorAll("[data-live-agent-card]")).toHaveLength(5);
  });

  it("selects an agent from the activity list", () => {
    const onSelect = vi.fn();
    render({
      agents: [agent("a", "/repo/a"), agent("b", "/repo/b")],
      onSelect,
      groupLabels: {},
      groupColors: {},
      groupCustomColors: {},
      groupMascots: {},
    });

    act(() => container.querySelector<HTMLButtonElement>('[data-live-agent-card="b"]')!.click());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("b");
  });

  it("keeps an unfocused working agent after the other turn finishes", () => {
    render({
      agents: [agent("background", "/repo/b")],
      activeSessionId: "open-session",
      groupLabels: {},
      groupColors: {},
      groupCustomColors: {},
      groupMascots: {},
    });

    expect(container.querySelector('[data-live-agent-card="background"]')).not.toBeNull();
    expect(container.querySelector('[aria-live="polite"]')!.textContent).toBe("1 working agent");
  });

  it("hides the card when the only live agent is the open session", () => {
    render({
      agents: [agent("open-session", "/repo/a")],
      activeSessionId: "open-session",
      groupLabels: {},
      groupColors: {},
      groupCustomColors: {},
      groupMascots: {},
    });

    expect(container.querySelector("[data-live-agents-preview]")).toBeNull();
  });

  it("keeps an unfocused finished session until it is opened", () => {
    render({
      agents: [agent("background", "/repo/b", { done: true, activity: "Done" })],
      activeSessionId: "open-session",
      groupLabels: {},
      groupColors: {},
      groupCustomColors: {},
      groupMascots: {},
    });

    const card = container.querySelector('[data-live-agent-card="background"]')!;
    expect(card.textContent).toContain("Done");
    expect(container.querySelector("[data-live-agents-preview]")?.getAttribute("aria-label")).toBe(
      "Finished agents",
    );
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe("1 finished agent");
  });

  it("keeps elapsed timers out of its live region", () => {
    render({
      agents: [agent("a", "/repo/a"), agent("b", "/repo/b")],
      groupLabels: {},
      groupColors: {},
      groupCustomColors: {},
      groupMascots: {},
    });

    const liveRegion = container.querySelector('[aria-live="polite"]')!;
    expect(liveRegion.textContent).toBe("2 working agents");
    expect(liveRegion.textContent).not.toMatch(/\d+s/);
    expect(container.querySelector("[role=status]")).toBeNull();
  });
});

it("shows the provider beside the title and keeps unknown start times empty", () => {
  render({ agents: [agent("unknown", "/repo/a", { startedAt: undefined })] });
  const card = container.querySelector('[data-live-agent-card="unknown"]')!;
  expect(card.querySelector("[data-live-agent-title] img")).not.toBeNull();
  const status = card.querySelector("[data-session-working-status]")!;
  expect(status.getAttribute("aria-label")).toBe("Working");
  expect(status.querySelector(".tabular-nums")).toBeNull();
});
