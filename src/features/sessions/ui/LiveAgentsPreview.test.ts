// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveAgent } from "../model/liveAgents";
import { t } from "../../../shared/i18n";
import { LiveAgentsPreview, liveActivityCounts } from "./LiveAgentsPreview";

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
  it("keeps chronological order across states and opens the selected rows", () => {
    const onSelect = vi.fn();
    render({
      agents: [
        agent("a", "/a"),
        agent("b", "/b"),
        agent("failed", "/c", { issue: "failed", done: true, startedAt: 2_000 }),
        agent("approval", "/d", { needsApproval: true, startedAt: 3_000 }),
      ],
      collapsible: true,
      onSelect,
    });
    act(() => container.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click());
    const rows = Array.from(
      container.querySelectorAll<HTMLButtonElement>("[data-live-agent-card]"),
    );
    expect(rows.map((row) => row.dataset.liveAgentCard)).toEqual(["approval", "failed", "a", "b"]);
    for (const row of rows.slice(0, 2)) act(() => row.click());
    expect(onSelect.mock.calls).toEqual([["approval"], ["failed"]]);
  });

  it("shows state counts and a single list across projects", () => {
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
    expect(list.querySelectorAll(":scope > [data-live-agent-card]")).toHaveLength(5);
    expect(
      Array.from(
        list.querySelectorAll<HTMLElement>("[data-live-agent-card]"),
        (card) => card.dataset.liveAgentCard,
      ),
    ).toEqual(["done", "waiting", "run", "other-host", "failed"]);
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
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(header.textContent).toContain("2");
    expect(container.querySelector('[role="status"]')!.textContent).toBe("2 working agents");
    expect(onSelect).not.toHaveBeenCalled();
    act(() => header.click());
    const card = container.querySelector<HTMLButtonElement>('[data-live-agent-card="b"]')!;
    expect(card.closest("[hidden]")).toBeNull();
    act(() => card.click());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("b");
  });

  it("mounts no row cards while collapsed and builds them on expand", () => {
    render({
      agents: Array.from({ length: 40 }, (_, index) => agent(`run-${index}`, `/repo/${index % 4}`)),
      collapsible: true,
    });
    const list = container.querySelector("[data-live-agents-list]")!;
    expect(list.children).toHaveLength(0);
    expect(list.closest("[hidden]")).not.toBeNull();
    const header = container.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    expect(header.querySelector('[aria-label="40 working agents"]')!.textContent).toBe("40");
    act(() => header.click());
    expect(list.querySelectorAll("[data-live-agent-card]")).toHaveLength(40);
  });

  it("keeps counts, live announcements and the selected row current while collapsed", () => {
    const onSelect = vi.fn();
    const base = [agent("a", "/repo/a"), agent("b", "/repo/b")];
    render({ agents: base, collapsible: true, activeSessionId: "b", onSelect });
    const header = container.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    render({
      agents: [...base, agent("c", "/repo/c", { needsApproval: true, inputKind: "approval" })],
      collapsible: true,
      activeSessionId: "b",
      onSelect,
    });
    expect(container.querySelector("button[aria-expanded]")).toBe(header);
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(header.querySelector('[aria-label="Need approval: 1"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')!.textContent).toBe(
      "2 working agents, Need approval: 1",
    );
    act(() => header.click());
    expect(
      container.querySelector('[data-live-agent-card="b"]')?.getAttribute("aria-current"),
    ).toBe("true");
    expect(container.querySelector('[data-live-agent-card="c"]')).not.toBeNull();
  });

  it("keeps input order for equal timestamps and exposes every row to scrolling", () => {
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
      "a-1",
      "b-1",
      "a-2",
      "b-2",
      "c-1",
      "c-2",
    ]);
    expect(cards[0].textContent).toContain("Alpha");
    expect(cards[1].textContent).toContain("Beta");
    expect(cards[0].querySelector(".bycoda-sigil-active")).not.toBeNull();
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

  it("shows Done when only a finished row remains", () => {
    render({ agents: [agent("background", "/repo/b", { done: true, activity: "Done" })] });
    expect(container.querySelector('[data-live-agent-state="done"]')).not.toBeNull();
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
  const status = card.querySelector("[data-live-agent-status]")!;
  expect(status.textContent).toBe("Working");
  expect(status.querySelector("[data-live-agent-elapsed]")).toBeNull();
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
    expect(
      liveActivityCounts([agent("a", "/a", { waiting }), agent("b", "/b")], t, String),
    ).toMatchObject([
      { state: "working", count: 1 },
      { state: "waiting", count: 1 },
    ]);
  });

  it("uses matching labels and icons for rows and nonzero counts", () => {
    const question = agent("question", "/repo/f", { needsApproval: true, inputKind: "question" });
    render({ agents: [...mixed, question], collapsible: true });
    const header = container.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    act(() => header.click());
    for (const [state, label, accessibleCount, count] of [
      ["failed", "Failed", "Failed: 1", "1"],
      ["working", "Working", "2 working agents", "2"],
      ["done", "Done", "Done: 1", "1"],
      ["question", "Question", "Question: 1", "1"],
      ["approval", "Need approval", "Need approval: 1", "1"],
    ]) {
      const status = container.querySelector(
        `[data-live-agent-state="${state}"] [data-live-agent-status]`,
      )!;
      const badge = header.querySelector(`[aria-label="${accessibleCount}"]`)!;
      expect(status.textContent).toContain(label);
      expect(badge.textContent).toBe(count);
      expect(badge.querySelector('[aria-hidden="true"]')?.firstElementChild).not.toBeNull();
    }
    expect(container.querySelector('[role="status"]')!.textContent).toBe(
      "2 working agents, Failed: 1, Question: 1, Done: 1, Need approval: 1",
    );
  });

  it("ties the Activity control to the list it expands", () => {
    render({ agents: mixed, collapsible: true });
    const header = container.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    const list = document.getElementById(header.getAttribute("aria-controls")!)!;
    expect(list.hidden).toBe(true);
    act(() => header.click());
    expect(list.hidden).toBe(false);
    expect(list.querySelectorAll("[data-live-agent-card]")).toHaveLength(5);
  });
});

it("keeps retrying rows visible with a warning", () => {
  render({ agents: [agent("retry", "/repo/a", { issue: "retrying" })] });
  const status = container.querySelector('[data-live-agent-card="retry"] [data-live-agent-status]');
  expect(status?.getAttribute("data-tone")).toBe("warning");
});

it("keeps the Failed counter when several failed turns remain", () => {
  render({
    agents: [
      agent("a", "/a", { issue: "failed", done: true }),
      agent("b", "/b", { issue: "failed", done: true }),
    ],
    collapsible: true,
  });
  expect(container.querySelector('[aria-label="Failed: 2"]')?.textContent).toBe("2");
});
