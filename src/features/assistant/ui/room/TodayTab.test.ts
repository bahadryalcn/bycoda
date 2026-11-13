// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { TodayTab } from "./TodayTab";
import type { AssistantSnapshot } from "../../../../shared/model/host-contracts/assistant";

const room = vi.hoisted(() => ({
  setView: vi.fn(),
  setFilter: vi.fn(),
  setQuery: vi.fn(),
  setJobProjectFilter: vi.fn(),
  setJobDateFilter: vi.fn(),
  canSeeProject: () => true,
}));
vi.mock("./assistantRoomContext", () => ({ useAssistantRoom: () => room }));
vi.mock("./TodayNotes", () => ({ TodayNotes: () => null }));

it.each([
  ["Working", "working"],
  ["Done today", "doneToday"],
  ["Waiting for you", "waiting"],
])(
  "opens %s with matching job filters and clears only list restrictions",
  async (caption, filter) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.clearAllMocks();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          createElement(TodayTab, {
            snapshot: { jobs: [], activity: [] } as unknown as AssistantSnapshot,
          }),
        ),
      );
      const tile = [...container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes(caption),
      )!;
      await act(async () => tile.click());
      expect(room.setFilter).toHaveBeenCalledExactlyOnceWith(filter);
      expect(room.setView).toHaveBeenCalledExactlyOnceWith("Jobs");
      expect(room.setQuery).toHaveBeenCalledExactlyOnceWith("");
      expect(room.setJobProjectFilter).toHaveBeenCalledExactlyOnceWith("");
      expect(room.setJobDateFilter).toHaveBeenCalledExactlyOnceWith("all");
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  },
);
