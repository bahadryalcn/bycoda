// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DockAgent } from "../model/activityDock";
import { SessionSubagentsMenu } from "./SessionSubagentsMenu";

let container: HTMLDivElement;
let root: Root;

const row = (blockId: string, status: DockAgent["status"]): DockAgent => ({
  blockId,
  name: `Agent ${blockId}`,
  kind: "agent",
  status,
  model: "Sonnet",
  detail: "",
  startedAt: 1_000,
  endedAt: 66_000,
});

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(agents: DockAgent[], onOpen = vi.fn()) {
  act(() => root.render(createElement(SessionSubagentsMenu, { agents, onOpen })));
  return onOpen;
}

describe("SessionSubagentsMenu", () => {
  it("renders nothing without subagents", () => {
    render([]);
    expect(container.querySelector("[data-composer-subagents-trigger]")).toBeNull();
  });

  it("names the count and the running ones", () => {
    render([row("a", "running"), row("b", "done")]);
    const trigger = container.querySelector("[data-composer-subagents-trigger]");
    expect(trigger?.getAttribute("aria-label")).toContain("1");
    expect(trigger?.textContent).toContain("2");
  });

  it("opens the list and selecting a row calls the open handler", () => {
    const onOpen = render([row("a", "done"), row("b", "failed")]);
    const trigger = container.querySelector<HTMLElement>("[data-composer-subagents-trigger]")!;
    act(() => trigger.click());
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items).toHaveLength(2);
    act(() => items[1].click());
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ blockId: "b" }));
  });
});
