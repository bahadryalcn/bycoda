// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveAgent } from "../model/liveAgents";
import { LiveAgentsPreview, summarizeLiveAgents } from "./LiveAgentsPreview";

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
  it("summarizes this project's work before applying the other-project row cap", () => {
    const agents = [
      agent("x1", "G:/Projects/X"),
      agent("x2", "g:\\projects\\x\\"),
      agent("x3", "G:/Projects/X"),
      agent("y1", "G:/Projects/Y"),
      agent("y2", "G:/Projects/Y"),
    ];
    const onSelect = vi.fn();
    render({ agents, currentProject: "g:/projects/x", collapsible: true, onSelect });
    expect(container.querySelector("[data-live-agents-project-summary]")?.textContent).toBe(
      "3 working in this project",
    );
    expect(container.querySelectorAll("[data-live-agent-card]")).toHaveLength(2);
    expect(container.textContent).not.toContain("more");
    expect(container.querySelector("button[aria-expanded]")?.textContent).toContain("5");
    act(() => container.querySelector<HTMLButtonElement>('[data-live-agent-card="y1"]')!.click());
    expect(onSelect).toHaveBeenCalledWith("y1");
    render({ agents, currentProject: "G:/Projects/Y", collapsible: true });
    expect(container.querySelector("[data-live-agents-project-summary]")?.textContent).toBe(
      "2 working in this project",
    );
    expect(container.querySelector('[data-live-agent-card="y1"]')).toBeNull();
    act(() =>
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("1 more"))!
        .click(),
    );
    expect(container.querySelectorAll("[data-live-agent-card]")).toHaveLength(3);
  });

  it("retains attention and finished rows, distinguishes machines and allows an all-project summary", () => {
    const agents = [
      agent("run", "remote://host-a/repo/x"),
      agent("attention", "remote://host-a/repo/x", { needsApproval: true }),
      agent("failed", "remote://host-a/repo/x", { done: true, issue: "failed" }),
      agent("finished", "remote://host-a/repo/x", { done: true }),
      agent("other-host", "remote://host-b/repo/x"),
    ];
    render({ agents, currentProject: "remote://host-a/repo/x" });
    expect(container.querySelector("[data-live-agents-project-summary]")?.textContent).toBe(
      "1 working in this project",
    );
    expect(container.querySelectorAll("[data-live-agent-card]")).toHaveLength(4);
    render({
      agents: [agents[0]],
      activeSessionId: "run",
      currentProject: agents[0].cwd,
      collapsible: true,
    });
    expect(container.querySelector("[data-live-agents-project-summary]")?.textContent).toBe(
      "1 working in this project",
    );
    expect(container.querySelectorAll("[data-live-agent-card]")).toHaveLength(0);
    render({ agents });
    expect(container.querySelector("[data-live-agents-project-summary]")).toBeNull();
  });

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

describe("LiveAgentsPreview mixed collections", () => {
  const mixed = [
    agent("failed", "/repo/a", { issue: "failed", done: true, activity: "Failed" }),
    agent("input", "/repo/b", { needsApproval: true, inputKind: "approval" }),
    agent("run-1", "/repo/c"),
    agent("run-2", "/repo/d"),
    agent("done", "/repo/e", { done: true, activity: "Done" }),
  ];

  it("separates running, needs-attention and finished counts", () => {
    expect(summarizeLiveAgents(mixed)).toEqual({
      attention: 2,
      finished: 1,
      working: 2,
      headline: "working",
    });
    expect(summarizeLiveAgents(mixed.slice(0, 2)).headline).toBe("attention");
    expect(summarizeLiveAgents(mixed.slice(4)).headline).toBe("finished");
  });

  it("titles a mixed list by running work and reports what needs attention beside the count", () => {
    render({ agents: mixed, collapsible: true });
    const section = container.querySelector("[data-live-agents-preview]")!;
    expect(section.getAttribute("data-live-agents-headline")).toBe("working");
    const header = container.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    expect(header.textContent).toContain("Working");
    expect(header.textContent).toContain("2 need attention");
    expect(header.textContent).not.toContain("Needs attention");
    expect(container.querySelector('[aria-live="polite"]')!.textContent).toBe(
      "2 working agents, 2 need attention, 1 finished agent",
    );
  });

  it("titles an attention-only list Needs attention and never calls failed work finished", () => {
    render({ agents: [mixed[0]], collapsible: true });
    const header = container.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    expect(header.textContent).toContain("Needs attention");
    expect(container.querySelector("[data-live-agents-preview]")!.getAttribute("aria-label")).toBe(
      "Agents needing attention",
    );
    expect(container.querySelector('[aria-live="polite"]')!.textContent).toBe("1 needs attention");
    const card = container.querySelector('[data-live-agent-card="failed"]')!;
    expect(card.getAttribute("data-live-agent-state")).toBe("failed");
    expect(card.querySelector("[data-live-agent-status]")!.textContent).toContain("Failed");
  });

  it("ties the more control to the list it expands", () => {
    render({ agents: mixed, collapsible: true });
    const more = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("3 more"),
    )!;
    expect(more.getAttribute("aria-controls")).toBe(
      container.querySelector("[data-live-agent-card]")!.closest("[id]")!.id,
    );
    act(() => more.click());
    expect(more.textContent).toContain("Show less");
    expect(container.querySelectorAll("[data-live-agent-card]")).toHaveLength(5);
  });
});
