import { visibleSessionTestText } from "./sessionUiTestText";
// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { ActivityDock } from "./ActivityDock";
import { STOP_ALL_CONFIRM_MS } from "./ActivityDockStopAll";
import { SubagentStateLine } from "./SubagentAnatomy";
import { HARNESS_ICONS } from "./HarnessIcon";

/** Hovers a control until the shared tooltip opens and returns its text (key caps included). */
async function tooltipText(element: HTMLElement): Promise<string> {
  await act(async () => {
    element.dispatchEvent(new Event("pointerover", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 520));
  });
  const text = document.querySelector('[role="tooltip"]')?.textContent ?? "";
  await act(async () => {
    element.dispatchEvent(new Event("pointerout", { bubbles: true }));
  });
  return text;
}

let container: HTMLDivElement;
let root: Root;

const user: Block = { id: "u1", role: "user", text: "go", startedAt: 1_000 };
const agent: Block = {
  id: "a1",
  role: "tool",
  text: "Agent: Side-by-side diff",
  tool: { callId: "a1", kind: "agent", status: "in_progress" },
  agentRun: { name: "Side-by-side diff", steps: [] },
};

function props(
  patch: Partial<ComponentProps<typeof ActivityDock>> = {},
): ComponentProps<typeof ActivityDock> {
  return {
    sessionId: "s1",
    blocks: [user, { id: "answer", role: "assistant", text: "Finished response" }],
    busy: false,
    pendingQuestion: false,
    atEnd: true,
    onOpenAgent: () => {},
    ...patch,
  };
}

function render(patch?: Partial<ComponentProps<typeof ActivityDock>>) {
  act(() =>
    root.render(
      createElement(
        "div",
        { "data-composer": "" },
        createElement("textarea"),
        createElement(ActivityDock, props(patch)),
      ),
    ),
  );
}

const dock = () => container.querySelector("[data-activity-dock]");

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

describe("ActivityDock", () => {
  it("shows application approval waiting and resumes after settlement", () => {
    render({ busy: true, pendingOwnerApproval: true });
    expect(visibleSessionTestText(container)).toContain("Needs your input");
    render({ busy: true, pendingOwnerApproval: false });
    expect(visibleSessionTestText(container)).toContain("Working");
    expect(visibleSessionTestText(container)).not.toContain("Needs your input");
  });

  it("renders a delegated provider's icon and exact account beside its model", () => {
    render({
      sessionId: "delegated-provider-identity",
      harness: "codex",
      busy: true,
      blocks: [user],
      delegatedAgents: [
        {
          blockId: "delegated:claude-work",
          sessionId: "claude-work",
          harness: "claude",
          providerAccountId: "work",
          name: "Review",
          model: "Haiku",
          kind: "agent",
          status: "running",
          detail: "",
        },
      ],
    });
    act(() => container.querySelector<HTMLButtonElement>("[data-dock-toggle]")?.click());
    const row = container.querySelector('[data-dock-agent="delegated:claude-work"]')!;
    expect(row.querySelector("img")?.getAttribute("src")).toBe(HARNESS_ICONS.claude);
    expect(row.textContent).toContain("work");
    expect(row.getAttribute("aria-label")).toContain("work");
  });
  it("lists children that also have an inline card and names a later round on a row", () => {
    const row = (id: string, extra: object) => ({
      blockId: `delegated:${id}`,
      sessionId: id,
      name: `Child ${id}`,
      kind: "agent" as const,
      status: "running" as const,
      detail: "",
      ...extra,
    });
    render({
      sessionId: "inline-children",
      busy: true,
      blocks: [user],
      delegatedAgents: [row("a", { inline: true }), row("b", { inline: true })],
    });
    expect(visibleSessionTestText(container)).toContain("2 running");
    expect(dock()?.hasAttribute("data-dock-subagents")).toBe(true);
    act(() => container.querySelector<HTMLButtonElement>("[data-dock-toggle]")?.click());
    expect(container.querySelectorAll("[data-dock-agent]")).toHaveLength(2);
    render({
      sessionId: "inline-children",
      busy: true,
      blocks: [user],
      delegatedAgents: [row("a", { inline: true }), row("c", { round: 2 })],
    });
    expect(container.querySelectorAll("[data-dock-agent]")).toHaveLength(2);
    expect(container.querySelector('[data-dock-agent="delegated:c"]')?.textContent).toContain(
      "Round 2",
    );
  });
  it("shows counts on the disclosure and points toward its opening direction", () => {
    render({ sessionId: "info-card", busy: true, blocks: [user, agent] });
    const toggle = container.querySelector<HTMLButtonElement>("[data-dock-toggle]")!;
    expect(toggle.textContent).toContain("1 running");
    expect(toggle.querySelector("svg")?.classList.contains("rotate-180")).toBe(false);
    expect(container.querySelector('[aria-label="Background work"]')).toBeNull();
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.querySelector("svg")?.classList.contains("rotate-180")).toBe(true);
  });
  it("keeps child identity and failed step metrics separate from lifecycle and opens the exact run", () => {
    const onOpenAgent = vi.fn();
    const run: Block = {
      ...agent,
      tool: { ...agent.tool!, status: "completed" },
      agentRun: {
        name: "Completed review",
        model: "gpt-6.1-sol",
        steps: [{ id: "check", kind: "tool", text: "Check", status: "failed" }],
        startedAt: 10_000,
        endedAt: 72_000,
      },
    };
    render({
      sessionId: "compact-identity",
      harness: "codex",
      busy: true,
      blocks: [user, run],
      onOpenAgent,
    });
    act(() => container.querySelector<HTMLButtonElement>("button[data-dock-toggle]")?.click());
    const row = container.querySelector<HTMLButtonElement>('[data-dock-agent="a1"]')!;
    expect(row.getAttribute("data-dock-agent-state")).toBe("done");
    expect(row.getAttribute("aria-label")).toContain("Done");
    expect(row.querySelector("[data-subagent-identity]")?.textContent).toContain(
      "Completed review",
    );
    expect(row.querySelector("[data-subagent-identity]")?.textContent).toContain("GPT-6.1-Sol");
    expect(row.querySelector("[data-subagent-state]")?.textContent).toContain("×1");
    expect(row.querySelector("[data-subagent-state]")?.textContent).toContain("1m 2s");
    act(() => row.click());
    expect(onOpenAgent).toHaveBeenCalledWith(
      expect.objectContaining({ blockId: "a1", status: "done" }),
    );
  });

  it("highlights failed steps without marking a running or completed agent as failed", () => {
    const steps = [
      { id: "read", kind: "tool" as const, text: "Read", status: "completed" },
      { id: "test", kind: "tool" as const, text: "Test", status: "failed" },
    ];
    const run = { ...agent, agentRun: { name: "Reviewer", steps } };
    render({ sessionId: "status-colors", busy: true, blocks: [user, run] });
    act(() => container.querySelector<HTMLButtonElement>("button[data-dock-toggle]")?.click());
    const row = dock()!.querySelector('[data-dock-agent="a1"]')!;
    expect(row.getAttribute("aria-label")).toContain("Running");
    expect(row.querySelector("[data-subagent-state]")?.textContent).toContain("×1");
    expect(row.getAttribute("aria-label")).toContain("2 steps, 1 failed");

    act(() =>
      root.render(
        createElement(SubagentStateLine, {
          block: { ...run, tool: { ...run.tool!, status: "completed" } },
          busy: false,
          steps,
        }),
      ),
    );
    const state = container.querySelector("[data-subagent-state]")!;
    expect(state.textContent).toContain("Done");
    expect(state.querySelector('[data-tone="success"]')?.textContent).toBe("Done");
    const completedFailure = [...state.querySelectorAll("span")].find(
      (span) => span.textContent === "1 failed" && span.getAttribute("data-tone") === "danger",
    );
    expect(completedFailure?.getAttribute("data-tone")).toBe("danger");
  });

  it("renders nothing for a session that was idle when opened", () => {
    render();
    expect(dock()).toBeNull();
  });

  it("keeps Done up after work finishes until the composer is focused", () => {
    render({ busy: true, atEnd: false });
    expect(dock()?.getAttribute("data-activity-dock")).toBe("working");
    expect(dock()?.querySelector("[data-pacing-uncle]")).not.toBeNull();
    expect(
      dock()
        ?.querySelector('[data-pacing-track="reserved"]')
        ?.closest("[data-activity-status-row]"),
    ).toBe(dock()?.querySelector("[data-activity-status-row]"));
    // The walker stays on the summary's row, not below it.
    expect(
      dock()?.querySelector('[data-pacing-track="reserved"]')?.closest(".activity-dock-summary"),
    ).not.toBeNull();
    expect(
      dock()?.querySelector('[data-pacing-track="reserved"]')?.classList.contains("absolute"),
    ).toBe(false);
    expect(dock()?.querySelector("[data-pacing-uncle]")?.classList.contains("h-8")).toBe(true);

    render({ busy: false, atEnd: false });
    expect(dock()?.getAttribute("data-activity-dock")).toBe("done");
    expect(dock()?.querySelector("[data-pacing-uncle]")).toBeNull();

    act(() => {
      container
        .querySelector("textarea")
        ?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(dock()).toBeNull();
  });

  it("clears Done when the reader scrolls back to the end", () => {
    render({ busy: true, atEnd: false });
    render({ busy: false, atEnd: false });
    expect(dock()?.getAttribute("data-activity-dock")).toBe("done");
    render({ busy: false, atEnd: true });
    expect(dock()).toBeNull();
  });

  it("names the finished turn separately while a queued send has unknown delivery", () => {
    render({ busy: true, deliveryUnconfirmed: true, atEnd: false });
    render({ busy: false, deliveryUnconfirmed: true, atEnd: false });
    expect(visibleSessionTestText(dock())).toContain("Turn activity: Finished");
    expect(container.querySelector(".sr-only[role='status']")?.textContent).toBe(
      "Turn activity: Finished",
    );
    render({ busy: false, deliveryUnconfirmed: false, atEnd: false });
    expect(visibleSessionTestText(dock())).toContain("Done");
  });

  it("does not flash Done when the completed response is already visible", () => {
    render({ busy: true });
    render({ busy: false });
    expect(dock()).toBeNull();
    expect(container.querySelector(".sr-only[role='status']")?.textContent).toBe("");
  });

  it("does not carry previous Done into a newly submitted message before busy acknowledgement", () => {
    render({ busy: true, atEnd: false });
    render({ busy: false, atEnd: false });
    expect(dock()?.getAttribute("data-activity-dock")).toBe("done");
    const next: Block = { id: "u2", role: "user", text: "next" };
    render({ busy: false, atEnd: false, blocks: [user, next] });
    expect(dock()).toBeNull();
    render({ busy: true, atEnd: false, blocks: [user, next] });
    expect(dock()?.getAttribute("data-activity-dock")).toBe("working");
    // The old transport may briefly settle before the new turn acknowledges.
    render({ busy: false, atEnd: false, blocks: [user, next] });
    expect(dock()).toBeNull();
  });

  it("announces the state in a polite live region", () => {
    render({ busy: true, pendingQuestion: true });
    const live = container.querySelector(".sr-only[role='status']");
    expect(live?.textContent).toBe("Needs your input");
  });

  it("lets the visible question own its status without another waiting panel", () => {
    render({ busy: true, pendingQuestion: true, questionPresented: true });
    expect(dock()).toBeNull();
    expect(container.querySelector(".sr-only[role='status']")?.textContent).toBe("");
  });

  it("keeps agent activity available while a question form is visible", () => {
    render({ busy: true, pendingQuestion: true, questionPresented: true, blocks: [user, agent] });
    expect(dock()).not.toBeNull();
    expect(container.querySelector("button[data-dock-toggle]")).not.toBeNull();
  });

  it("lists agents behind a button and opens one on click", () => {
    const onOpenAgent = vi.fn();
    render({ busy: true, blocks: [user, agent], onOpenAgent });
    expect(container.querySelector("[data-dock-agent]")).toBeNull();

    const chip = container.querySelector<HTMLButtonElement>("button[data-dock-toggle]");
    expect(chip?.getAttribute("aria-label")).toContain("1 running");
    expect(chip?.textContent).toContain("1 running");
    act(() => chip?.click());

    const row = container.querySelector<HTMLButtonElement>("[data-dock-agent='a1']");
    expect(row?.getAttribute("aria-label")).toContain("Side-by-side diff");
    act(() => row?.click());
    expect(onOpenAgent).toHaveBeenCalledWith(
      expect.objectContaining({ blockId: "a1", kind: "agent" }),
    );
  });

  it("shows a run's final duration in the agent list", () => {
    const timed: Block = {
      ...agent,
      tool: { callId: "a1", kind: "agent", status: "completed" },
      agentRun: { name: "Diff", steps: [], startedAt: 10_000, endedAt: 72_000 },
    };
    // Its own session id: the list's open state is remembered per session.
    render({ busy: true, blocks: [user, timed], sessionId: "s-timing" });
    act(() => container.querySelector<HTMLButtonElement>("button[data-dock-toggle]")?.click());
    expect(container.querySelector("[data-dock-agent='a1']")?.textContent).toContain("1m 2s");
  });

  describe("stopping", () => {
    const stopButtons = () =>
      [...container.querySelectorAll<HTMLButtonElement>("button:not([data-dock-stop-all])")].filter(
        (button) => /^Stop(ping)?[ …]/.test(button.getAttribute("aria-label") ?? ""),
      );
    const expand = () =>
      act(() => container.querySelector<HTMLButtonElement>("button[data-dock-toggle]")?.click());

    it("stops one running agent on its own and reads Stopping until it settles", async () => {
      let finish = () => {};
      const onStopAgent = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
      render({
        busy: true,
        blocks: [user, agent],
        sessionId: "s-stop-one",
        perItemStop: true,
        onStopAgent,
        onStopAll: async () => {},
      });
      expand();
      const [button] = stopButtons();
      expect(await tooltipText(button)).toBe("Stop this subagent");
      await act(async () => button.click());
      expect(onStopAgent).toHaveBeenCalledWith(expect.objectContaining({ callId: "a1" }));
      expect(stopButtons()[0].getAttribute("aria-disabled")).toBe("true");
      expect(visibleSessionTestText(stopButtons()[0])).toBe("Stopping…");
      finish();
    });

    it("gives the button back, marked, when the request fails", async () => {
      render({
        busy: true,
        blocks: [user, agent],
        sessionId: "s-stop-fail",
        perItemStop: true,
        onStopAgent: () => Promise.reject(new Error("no")),
      });
      expand();
      await act(async () => stopButtons()[0].click());
      const [button] = stopButtons();
      expect(button.disabled).toBe(false);
      expect(await tooltipText(button)).toBe("Could not stop it. Try again.");
      expect(visibleSessionTestText(button)).toBe("Retry stop");
      const labels = [...button.querySelectorAll("[data-reserve]")].map((node) =>
        node.getAttribute("data-reserve"),
      );
      expect(labels).toEqual(["Stop", "Retry stop", "Stopping…"]);
      expect(dock()?.querySelector('[role="status"].sr-only')?.textContent).toContain(
        "Could not stop it. Try again.",
      );
    });

    it("has no per-agent button when only the whole turn can be interrupted", async () => {
      const onStopAll = vi.fn(async () => {});
      render({
        busy: true,
        blocks: [user, agent],
        sessionId: "s-stop-turn",
        perItemStop: false,
        onStopAgent: async () => {},
        onStopAll,
      });
      expand();
      expect(stopButtons()).toHaveLength(0);
      const all = [...container.querySelectorAll("button")].find(
        (button) => visibleSessionTestText(button) === "Stop all",
      );
      expect(await tooltipText(all!)).toContain("Interrupt the whole turn");
      expect(all?.querySelector('[data-reserve="Stop all"]')).not.toBeNull();
      expect(all?.querySelector('[data-reserve="Retry stop"]')).not.toBeNull();
      act(() => all?.click());
      expect(onStopAll).not.toHaveBeenCalled();
      expect(visibleSessionTestText(all!)).toBe("Confirm stop?");
      await act(async () => all?.click());
      expect(onStopAll).toHaveBeenCalledOnce();
    });

    describe("stop all confirmation", () => {
      const renderStopAll = (onStopAll: () => Promise<void>, sessionId: string) => {
        render({
          busy: true,
          blocks: [user, agent],
          sessionId,
          perItemStop: true,
          onStopAgent: async () => {},
          onStopAll,
        });
        return container.querySelector<HTMLButtonElement>("[data-dock-stop-all]")!;
      };

      it("sits in the header while collapsed and stops only on the second press", async () => {
        const onStopAll = vi.fn(async () => {});
        const stopAll = renderStopAll(onStopAll, "s-stop-all");
        expect(stopAll.closest("[data-activity-status-row]")).not.toBeNull();
        expect(container.querySelector("[data-dock-agent]")).toBeNull();
        expect(visibleSessionTestText(stopAll)).toBe("Stop all");
        expect(stopAll.getAttribute("aria-label")).toBe("Stop all background work");
        act(() => stopAll.click());
        expect(onStopAll).not.toHaveBeenCalled();
        expect(visibleSessionTestText(stopAll)).toBe("Confirm stop 1?");
        expect(stopAll.getAttribute("aria-label")).toBeNull();
        await act(async () => stopAll.click());
        expect(onStopAll).toHaveBeenCalledOnce();
      });

      it("disarms when the confirmation window passes", () => {
        vi.useFakeTimers();
        try {
          const onStopAll = vi.fn(async () => {});
          const stopAll = renderStopAll(onStopAll, "s-stop-all-timeout");
          act(() => stopAll.click());
          act(() => vi.advanceTimersByTime(STOP_ALL_CONFIRM_MS));
          expect(visibleSessionTestText(stopAll)).toBe("Stop all");
          act(() => stopAll.click());
          expect(onStopAll).not.toHaveBeenCalled();
        } finally {
          vi.useRealTimers();
        }
      });

      it("does not let a double click pass the confirmation", () => {
        const onStopAll = vi.fn(async () => {});
        const stopAll = renderStopAll(onStopAll, "s-stop-all-double");
        const press = (detail: number) =>
          act(() => {
            stopAll.dispatchEvent(new MouseEvent("click", { bubbles: true, detail }));
          });
        press(1);
        press(2);
        expect(onStopAll).not.toHaveBeenCalled();
        expect(visibleSessionTestText(stopAll)).toBe("Confirm stop 1?");
      });

      it("disarms when focus leaves the button", () => {
        const onStopAll = vi.fn(async () => {});
        const stopAll = renderStopAll(onStopAll, "s-stop-all-blur");
        act(() => stopAll.focus());
        act(() => stopAll.click());
        act(() => stopAll.blur());
        expect(visibleSessionTestText(stopAll)).toBe("Stop all");
      });

      it("retries a failed stop on one press", async () => {
        const onStopAll = vi.fn(() => Promise.reject(new Error("no")));
        const stopAll = renderStopAll(onStopAll, "s-stop-all-retry");
        act(() => stopAll.click());
        await act(async () => stopAll.click());
        expect(visibleSessionTestText(stopAll)).toBe("Retry stop");
        await act(async () => stopAll.click());
        expect(onStopAll).toHaveBeenCalledTimes(2);
      });
    });

    it("shows a stopped agent as stopped by you, with nothing left to stop", () => {
      const stopped: Block = {
        ...agent,
        tool: { callId: "a1", kind: "agent", status: "stopped" },
      };
      render({
        busy: true,
        blocks: [user, stopped],
        sessionId: "s-stopped",
        perItemStop: true,
        onStopAgent: async () => {},
        onStopAll: async () => {},
      });
      expand();
      expect(stopButtons()).toHaveLength(0);
      expect(visibleSessionTestText(container)).not.toContain("Stop all");
      const row = container.querySelector("[data-dock-agent='a1']");
      expect(row?.textContent).toContain("Stopped");
      expect(row?.getAttribute("aria-label")).toContain("Stopped by you");
    });
  });
});
