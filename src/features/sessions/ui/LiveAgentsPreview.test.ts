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
  it("puts input requests first and excludes failed results", () => {
    const onSelect = vi.fn();
    render({
      agents: [
        agent("a", "/a"),
        agent("b", "/b"),
        agent("failed", "/c", { issue: "failed", done: true }),
        agent("approval", "/d", { needsApproval: true }),
      ],
      collapsible: true,
      onSelect,
    });
    const rows = Array.from(
      container.querySelectorAll<HTMLButtonElement>("[data-live-agent-card]"),
    );
    expect(rows.map((row) => row.dataset.liveAgentCard)).toEqual(["approval", "a", "b"]);
    for (const row of rows.slice(0, 2)) act(() => row.click());
    expect(onSelect.mock.calls).toEqual([["approval"], ["a"]]);
  });

  it("groups only working and waiting rows across projects", () => {
    render({
      agents: [
        agent("done", "/a", { done: true }),
        agent("waiting", "/b", { waiting: { kind: "commands", count: 1 } }),
        agent("run", "remote://host-a/repo/x"),
        agent("other-host", "remote://host-b/repo/x"),
        agent("failed", "/d", { issue: "failed", done: true }),
      ],
      collapsible: true,
    });
    const header = container.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    act(() => header.click());
    const list = container.querySelector("[data-live-agents-list]")!;
    expect(list.querySelectorAll("[data-live-agents-group]")).toHaveLength(2);
    expect(
      Array.from(
        list.querySelectorAll<HTMLElement>("[data-live-agent-card]"),
        (card) => card.dataset.liveAgentCard,
      ),
    ).toEqual(["run", "other-host", "waiting"]);
    expect(header.querySelector('[aria-label="2 working agents"]')).not.toBeNull();
    expect(header.querySelector('[aria-label="1 waiting agent"]')).not.toBeNull();
  });

  it("names questions separately from action approvals", () => {
    render({
      agents: [
        agent("question", "/repo/a", {
          needsApproval: true,
          inputKind: "question",
        }),
        agent("approval", "/repo/b", {
          needsApproval: true,
          inputKind: "approval",
        }),
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
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(card.closest("[hidden]")).not.toBeNull();
    expect(header.textContent).toContain("2");
    expect(onSelect).not.toHaveBeenCalled();
    act(() => header.click());
    expect(card.closest("[hidden]")).toBeNull();
    act(() => card.click());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("b");
  });

  it("keeps activity order within groups and exposes every row to scrolling", () => {
    render({
      agents: [
        agent("a-1", "/repo/a"),
        agent("b-1", "/repo/b", { needsApproval: true }),
        agent("a-2", "/repo/a"),
        agent("b-2", "/repo/b"),
        agent("c-1", "/repo/c"),
        agent("c-2", "/repo/c"),
      ],
      groupLabels: { "/repo/a": "Alpha", "/repo/b": "Beta" },
      groupColors: {},
      groupCustomColors: {},
      groupMascots: {},
    });

    const cards = Array.from(container.querySelectorAll<HTMLElement>("[data-live-agent-card]"));
    expect(cards.map((card) => card.dataset.liveAgentCard)).toEqual([
      "b-1",
      "a-1",
      "a-2",
      "b-2",
      "c-1",
      "c-2",
    ]);
    expect(cards[1].textContent).toContain("Alpha");
    expect(cards[0].textContent).toContain("Beta");
    expect(cards[1].querySelector(".bycoda-sigil-active")).not.toBeNull();
    expect(
      container.querySelector("[data-live-agents-list]")?.classList.contains("overflow-y-auto"),
    ).toBe(true);
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
    expect(container.querySelector('.sr-only[role="status"]')!.textContent).toBe("1 working agent");
  });

  it("keeps working visible when the conversation is open", () => {
    render({
      agents: [agent("open-session", "/repo/a")],
      activeSessionId: "open-session",
      groupLabels: {},
      groupColors: {},
      groupCustomColors: {},
      groupMascots: {},
    });

    expect(
      container
        .querySelector('[data-live-agent-card="open-session"]')
        ?.getAttribute("aria-current"),
    ).toBe("true");
  });

  it("hides Activity when only finished rows remain", () => {
    render({ agents: [agent("background", "/repo/b", { done: true, activity: "Done" })] });
    expect(container.querySelector("[data-live-agents-preview]")).toBeNull();
  });

  it("keeps elapsed timers out of its live region", () => {
    render({
      agents: [agent("a", "/repo/a"), agent("b", "/repo/b")],
      groupLabels: {},
      groupColors: {},
      groupCustomColors: {},
      groupMascots: {},
    });

    const liveRegion = container.querySelector('.sr-only[role="status"]')!;
    expect(liveRegion.textContent).toBe("2 working agents");
    expect(liveRegion.textContent).not.toMatch(/\d+s/);
    expect(container.querySelectorAll("[role=status]")).toHaveLength(1);
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
    agent("failed", "/repo/a", {
      issue: "failed",
      done: true,
      activity: "Failed",
    }),
    agent("input", "/repo/b", { needsApproval: true, inputKind: "approval" }),
    agent("run-1", "/repo/c"),
    agent("run-2", "/repo/d"),
    agent("done", "/repo/e", { done: true, activity: "Done" }),
  ];

  it("keeps waiting agents out of the working count", () => {
    const waiting = { kind: "commands", count: 1 } as const;
    const summary = summarizeLiveAgents([agent("a", "/a", { waiting }), agent("b", "/b")]);
    expect(summary).toMatchObject({
      working: 1,
      waiting: 1,
      headline: "working",
    });
    expect(summarizeLiveAgents([agent("a", "/a", { waiting })]).headline).toBe("waiting");
  });

  it("counts only running agents and pending input", () => {
    expect(summarizeLiveAgents(mixed)).toEqual({
      attention: 1,
      working: 2,
      waiting: 0,
      headline: "working",
    });
    expect(summarizeLiveAgents(mixed.slice(0, 2)).headline).toBe("attention");
    expect(summarizeLiveAgents(mixed.slice(4)).working).toBe(0);
  });

  it("announces only working and pending input", () => {
    render({ agents: mixed, collapsible: true });
    const section = container.querySelector("[data-live-agents-preview]")!;
    expect(section.getAttribute("data-live-agents-headline")).toBe("working");
    const header = container.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    expect(header.textContent).toContain("Activity");
    expect(header.textContent).not.toContain("need attention");
    const cards = container.querySelectorAll("[data-live-agent-card]");
    expect(cards[0].getAttribute("data-live-agent-card")).toBe("input");
    expect(cards[1].getAttribute("data-live-agent-card")).toBe("run-1");
    expect(header.textContent).not.toContain("Needs attention");
    expect(container.querySelector('.sr-only[role="status"]')!.textContent).toBe(
      "2 working agents, 1 needs attention",
    );
  });

  it("hides Activity when only failed work remains", () => {
    render({ agents: [mixed[0]], collapsible: true });
    expect(container.querySelector("[data-live-agents-preview]")).toBeNull();
  });

  it("ties the Activity control to the list it expands", () => {
    render({ agents: mixed, collapsible: true });
    const header = container.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    const list = document.getElementById(header.getAttribute("aria-controls")!)!;
    expect(list.hidden).toBe(true);
    act(() => header.click());
    expect(list.hidden).toBe(false);
    expect(list.querySelectorAll("[data-live-agent-card]")).toHaveLength(3);
  });
});

it("keeps retrying rows visible with a warning", () => {
  render({ agents: [agent("retry", "/repo/a", { issue: "retrying" })] });
  const status = container.querySelector('[data-live-agent-card="retry"] [data-live-agent-status]');
  expect(status?.getAttribute("data-tone")).toBe("warning");
});

it("hides Activity when several failed turns remain", () => {
  render({
    agents: [
      agent("a", "/a", { issue: "failed", done: true }),
      agent("b", "/b", { issue: "failed", done: true }),
    ],
    collapsible: true,
  });
  expect(container.querySelector("[data-live-agents-preview]")).toBeNull();
});
