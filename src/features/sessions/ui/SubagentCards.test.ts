// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  CREW_MEMBER_KEY,
  DELEGATION_PARENT_KEY,
} from "../../../shared/model/host-contracts/delegation";
import { delegatedCardBlock } from "../model/delegatedCards";
import { newSession, type Block, type Session } from "../model/session";
import { DelegatedRunOwner, SubagentRow, SubagentStack } from "./SubagentCards";

const fake = vi.hoisted(() => ({
  open: vi.fn(),
  stop: vi.fn(() => Promise.resolve()),
  retry: vi.fn(() => Promise.resolve()),
  received: false,
  child: undefined as unknown,
}));

vi.mock("../model/sessionsStore", () => ({
  useSession: () => fake.child,
  useSessionsSelector: () => fake.received,
}));
vi.mock("./delegatedFocus", () => ({
  requestViewDelegated: fake.open,
  stopDelegated: fake.stop,
  retryDelegated: fake.retry,
}));

let container: HTMLDivElement;
let root: Root;

function child(busy: boolean): Session {
  return {
    ...newSession("codex", "/repo", "codex:gpt-a"),
    id: "child-1",
    title: "Review the parser",
    busy,
    modelSettings: {
      [DELEGATION_PARENT_KEY]: JSON.stringify({
        parentSessionId: "parent-1",
        runId: "ask_1",
        kind: "subagent",
        model: "codex:gpt-a",
        startedAt: 1,
      }),
      [CREW_MEMBER_KEY]: JSON.stringify({ id: "m1", name: "Reviewer", handle: "reviewer" }),
    },
  };
}

function render(session: Session) {
  fake.child = session;
  act(() => {
    root.render(
      createElement(
        DelegatedRunOwner.Provider,
        { value: "parent-1" },
        createElement(SubagentRow, { block: delegatedCardBlock(session) }),
      ),
    );
  });
}

beforeEach(() => {
  fake.open.mockClear();
  fake.stop.mockClear();
  fake.retry.mockClear();
  fake.received = false;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it("shows the member's identity, task and status, and opens the child", () => {
  render(child(true));
  const text = container.textContent ?? "";
  expect(text).toContain("Reviewer");
  expect(text).toContain("@reviewer");
  expect(text).toContain("Review the parser");
  expect(text).toContain("Running");
  const open = container.querySelector<HTMLButtonElement>('button[aria-label^="Open Reviewer"]');
  act(() => open?.click());
  expect(fake.open).toHaveBeenCalledWith("parent-1", "child-1");
});

it("opens a run from a click on its row before it reports any step", () => {
  render(child(true));
  const row = container.querySelector<HTMLButtonElement>("button[data-subagent-open]");
  expect(row?.textContent).toContain("Reviewer");
  act(() => row?.click());
  expect(fake.open).toHaveBeenCalledWith("parent-1", "child-1");
});

it("marks an advisor run as the advisor", () => {
  const advisor = child(false);
  advisor.modelSettings = {
    [DELEGATION_PARENT_KEY]: JSON.stringify({
      parentSessionId: "parent-1",
      runId: "ask_2",
      kind: "advisor",
      model: "codex:gpt-a",
      startedAt: 1,
    }),
  };
  render(advisor);
  expect(container.querySelector("[data-subagent-advisor]")?.textContent).toBe("Advisor");
  render(child(false));
  expect(container.querySelector("[data-subagent-advisor]")).toBeNull();
});

it("stops a running member and offers no Stop once it is done", () => {
  render(child(true));
  const stop = container.querySelector<HTMLButtonElement>('button[aria-label="Stop Reviewer"]');
  act(() => stop?.click());
  expect(fake.stop).toHaveBeenCalledWith("parent-1", "child-1");
  render(child(false));
  expect(container.querySelector('button[aria-label^="Stop"]')).toBeNull();
  expect(container.textContent).toContain("Done");
});

it("shows a failed child's error with a Retry that sends the same task, and marks a received result", () => {
  const failed = {
    ...child(false),
    blocks: [
      { id: "u", role: "user", text: "Review", startedAt: 1 },
      { id: "e", role: "system", notice: "error", text: "Provider rejected the request" },
    ],
  } as Session;
  fake.received = true;
  render(failed);
  expect(container.textContent).toContain("Provider rejected the request");
  expect(container.querySelector("[data-delegation-result-received]")).not.toBeNull();
  act(() => container.querySelector<HTMLButtonElement>("[data-subagent-retry]")?.click());
  expect(fake.retry).toHaveBeenCalledWith("parent-1", "child-1");
  render(child(false));
  expect(container.querySelector("[data-subagent-retry]")).toBeNull();
});

function nativeRun(id: string, status: string): Block {
  return {
    id,
    role: "tool",
    text: `Task ${id}`,
    tool: { callId: id, kind: "agent", title: `Task ${id}`, status },
    agentRun: {
      name: `Task ${id}`,
      steps: [],
      startedAt: 1,
      endedAt: status === "completed" ? 2 : undefined,
    },
  } as Block;
}

function renderStack(statuses: string[]) {
  act(() => {
    root.render(
      createElement(SubagentStack, {
        blocks: statuses.map((status, index) => nativeRun(`r${index}`, status)),
        live: true,
      }),
    );
  });
}

it("lays up to three runs out as cards that open their own panel", () => {
  renderStack(["in_progress", "completed", "failed"]);
  expect(container.querySelectorAll("[data-subagent-card]")).toHaveLength(3);
  expect(container.querySelector("[data-subagent-list]")).toBeNull();
  expect(container.querySelector('[data-subagent-card] [role="progressbar"]')).not.toBeNull();
});

it("opens a card's run from a click anywhere on the card while it has no work to show", () => {
  const opened: string[] = [];
  const listen = (event: Event) => opened.push(String((event as CustomEvent).detail ?? ""));
  window.addEventListener("bycoda:view-subagent", listen);
  renderStack(["in_progress", "completed"]);
  const actions = container.querySelectorAll<HTMLButtonElement>(
    "button[data-subagent-card-action]",
  );
  expect(actions).toHaveLength(2);
  expect(actions[0].getAttribute("aria-label")).toBe("Open r0 in its own panel");
  act(() => actions[0].click());
  window.removeEventListener("bycoda:view-subagent", listen);
  expect(opened).toEqual(["r0"]);
});

it("lays more than three runs out as rows under a finished counter", () => {
  renderStack(["in_progress", "completed", "failed", "completed"]);
  expect(container.querySelector("[data-subagent-card]")).toBeNull();
  expect(container.querySelector("[data-subagent-list]")).not.toBeNull();
  expect(container.textContent).toContain("2/4 done");
  expect(container.textContent).toContain("1 failed");
});

function unstarted(id: string, reason: string, name = "Subagent"): Block {
  return {
    id,
    role: "tool",
    text: name,
    tool: { kind: "subagent", title: name, status: "failed", detail: reason },
    agentRun: { name, steps: [], unstarted: true },
  };
}

it("shows asks that never started as one line with their reason, not as cards", () => {
  const reason = "Choose an available worktree of this project";
  act(() => {
    root.render(
      createElement(SubagentStack, { blocks: [unstarted("a", reason), unstarted("b", reason)] }),
    );
  });
  expect(container.querySelector("[data-subagent-card]")).toBeNull();
  expect(container.querySelector('[role="progressbar"]')).toBeNull();
  const lines = container.querySelectorAll("[data-subagent-start-failure]");
  expect(lines).toHaveLength(1);
  expect(lines[0].textContent).toBe(`2 subagents could not start: ${reason}`);
  expect(container.textContent).not.toContain("Details");
});

it("keeps started runs as cards beside a line for the asks that never started", () => {
  act(() => {
    root.render(
      createElement(SubagentStack, {
        blocks: [
          nativeRun("r0", "completed"),
          unstarted("x", "Limit reached", "Advisor"),
          nativeRun("r1", "in_progress"),
        ],
        live: true,
      }),
    );
  });
  expect(container.querySelectorAll("[data-subagent-card]")).toHaveLength(2);
  expect(container.querySelector("[data-subagent-start-failure]")?.textContent).toBe(
    "Advisor could not start: Limit reached",
  );
});

it("shows a lone ask that never started as its line", () => {
  act(() => {
    root.render(createElement(SubagentRow, { block: unstarted("a", "Model unavailable") }));
  });
  expect(container.querySelector("[data-subagent-start-failure]")?.textContent).toBe(
    "Subagent could not start: Model unavailable",
  );
  expect(container.querySelector("[data-subagent-open]")).toBeNull();
});

it("shows a failed card's short reason on the card once, without a Details popover or Failure section", () => {
  act(() => {
    root.render(
      createElement(SubagentStack, {
        blocks: [
          nativeRun("a", "completed"),
          {
            ...nativeRun("b", "failed"),
            tool: { callId: "b", kind: "agent", title: "Task b", status: "failed", detail: "Boom" },
          } as Block,
        ],
      }),
    );
  });
  const reasons = container.querySelectorAll("[data-subagent-reason]");
  expect(reasons[1].textContent).toBe("Boom");
  expect(container.textContent).not.toContain("Details");
  expect(container.textContent).not.toContain("Failure");
  expect(container.querySelector("[data-subagent-trail]")).toBeNull();
});

it("opens one card's trail at a time under the grid, and a failed run opens itself on its reason", () => {
  const withSteps = (id: string, status: string, detail?: string): Block =>
    ({
      ...nativeRun(id, status),
      tool: { callId: id, kind: "agent", title: `Task ${id}`, status, detail },
      agentRun: {
        name: `Task ${id}`,
        steps: [{ id: `${id}-s`, kind: "message", text: `Notes of ${id}` }],
        startedAt: 1,
      },
    }) as Block;
  act(() => {
    root.render(
      createElement(SubagentStack, {
        blocks: [withSteps("a", "completed"), withSteps("b", "failed", "Provider fell over")],
        live: false,
      }),
    );
  });
  const card = (name: string) =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
  expect(container.querySelector("[data-subagent-reason]")?.textContent).toBe("");
  expect(container.textContent).toContain("Provider fell over");
  expect(card("Hide b's work")).not.toBeNull();
  expect(container.querySelectorAll("[data-subagent-trail]")).toHaveLength(1);
  act(() => card("Show a's work")?.click());
  expect(container.querySelectorAll("[data-subagent-trail]")).toHaveLength(1);
  expect(card("Hide a's work")).not.toBeNull();
  expect(card("Show b's work")).not.toBeNull();
});
