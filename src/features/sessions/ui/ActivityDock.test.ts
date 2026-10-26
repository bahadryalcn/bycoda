import { visibleSessionTestText } from "./sessionUiTestText";
// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { ActivityDock } from "./ActivityDock";

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
    expect(container.querySelector("[aria-live='polite']")?.textContent).toBe(
      "Turn activity: Finished",
    );
    render({ busy: false, deliveryUnconfirmed: false, atEnd: false });
    expect(visibleSessionTestText(dock())).toContain("Done");
  });

  it("does not flash Done when the completed response is already visible", () => {
    render({ busy: true });
    render({ busy: false });
    expect(dock()).toBeNull();
    expect(container.querySelector("[aria-live='polite']")?.textContent).toBe("");
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
    const live = container.querySelector("[aria-live='polite']");
    expect(live?.textContent).toBe("Needs your input");
  });

  it("lets the visible question own its status without another waiting panel", () => {
    render({ busy: true, pendingQuestion: true, questionPresented: true });
    expect(dock()).toBeNull();
    expect(container.querySelector("[aria-live='polite']")?.textContent).toBe("");
  });

  it("keeps agent activity available while a question form is visible", () => {
    render({ busy: true, pendingQuestion: true, questionPresented: true, blocks: [user, agent] });
    expect(dock()).not.toBeNull();
    expect(container.querySelector("button[aria-expanded]")).not.toBeNull();
  });

  it("lists agents behind a button and opens one on click", () => {
    const onOpenAgent = vi.fn();
    render({ busy: true, blocks: [user, agent], onOpenAgent });
    expect(container.querySelector("[data-dock-agent]")).toBeNull();

    const chip = container.querySelector<HTMLButtonElement>("button[aria-expanded]");
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
    act(() => container.querySelector<HTMLButtonElement>("button[aria-expanded]")?.click());
    expect(container.querySelector("[data-dock-agent='a1']")?.textContent).toContain("1m 2s");
  });

  describe("stopping", () => {
    const stopButtons = () =>
      [...container.querySelectorAll<HTMLButtonElement>("button")].filter((button) =>
        /^Stop(ping)? /.test(button.getAttribute("aria-label") ?? ""),
      );
    const expand = () =>
      act(() => container.querySelector<HTMLButtonElement>("button[aria-expanded]")?.click());

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
      expect(button.title).toBe("Stop this subagent");
      await act(async () => button.click());
      expect(onStopAgent).toHaveBeenCalledWith(expect.objectContaining({ callId: "a1" }));
      expect(stopButtons()[0].disabled).toBe(true);
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
      expect(button.title).toBe("Could not stop it. Try again.");
    });

    it("has no per-agent button when only the whole turn can be interrupted", () => {
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
      expect(all?.title).toContain("Interrupt the whole turn");
      act(() => all?.click());
      expect(onStopAll).toHaveBeenCalled();
    });

    it("offers Stop all background work where tasks stop one by one", () => {
      render({
        busy: true,
        blocks: [user, agent],
        perItemStop: true,
        onStopAgent: async () => {},
        onStopAll: async () => {},
      });
      expect(visibleSessionTestText(container)).toContain("Stop all background work");
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
      expect(container.querySelector("[data-dock-agent='a1']")?.textContent).toContain(
        "stopped by you",
      );
    });
  });
});
