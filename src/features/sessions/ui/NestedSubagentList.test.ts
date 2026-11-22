// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { DockAgent } from "../model/activityDock";
import { NestedSubagentList } from "./NestedSubagentList";

const child: DockAgent = {
  blockId: "delegate-block",
  sessionId: "grandchild",
  kind: "agent",
  name: "Random number",
  status: "done",
  detail: "",
  model: "Claude Haiku 5.5",
};

it("opens the exact nested session and explains a failed navigation", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const open = vi.fn<() => boolean>().mockReturnValueOnce(false).mockReturnValueOnce(true);
  try {
    act(() => root.render(createElement(NestedSubagentList, { agents: [child], onOpen: open })));
    const row = container.querySelector<HTMLButtonElement>("[data-nested-subagent]")!;
    expect(row.textContent).toContain("Done");
    act(() => row.click());
    expect(open).toHaveBeenCalledWith("grandchild");
    expect(container.textContent).toContain("This conversation is no longer available.");
    act(() => row.click());
    expect(container.textContent).not.toContain("This conversation is no longer available.");
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("omits rows without a conversation destination", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        createElement(NestedSubagentList, {
          agents: [{ ...child, sessionId: undefined }],
          onOpen: vi.fn(),
        }),
      ),
    );
    expect(container.querySelector("button")).toBeNull();
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
