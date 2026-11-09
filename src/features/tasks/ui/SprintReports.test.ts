// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SprintReports } from "./SprintReports";
import type { SprintBoardController } from "../model/sprintClient";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const controller = (sprints: { id: string; name: string }[]) =>
  ({
    supported: false,
    sprints,
    sources: [],
    planning: new Map(),
    tasks: [],
    machines: [],
    syncFailures: {},
    taskRef: () => undefined,
  }) as unknown as SprintBoardController;
const button = (label: string) =>
  Array.from(host.querySelectorAll("button")).find((entry) => entry.textContent?.trim() === label);

it("offers the next step instead of an empty report when no sprint exists", () => {
  const openSprints = vi.fn();
  act(() =>
    root.render(
      createElement(SprintReports, {
        board: controller([]),
        sprintId: "",
        onOpenSprints: openSprints,
      }),
    ),
  );
  expect(host.textContent).toContain("No sprints yet");
  // No chart or velocity placeholder without a sprint.
  expect(host.textContent).not.toContain("Sprint velocity");
  act(() => button("Go to Sprints")!.click());
  // One action only: the backlog is not offered from an empty report.
  expect(button("Open backlog")).toBeUndefined();
  expect(openSprints).toHaveBeenCalledTimes(1);
});

it("lets the owner choose an existing sprint from the empty report", () => {
  act(() =>
    root.render(
      createElement(SprintReports, {
        board: controller([{ id: "s1", name: "Sprint one" }]),
        sprintId: "",
        onChooseSprint: vi.fn(),
        onOpenSprints: vi.fn(),
      }),
    ),
  );
  expect(host.textContent).toContain("Choose a sprint to inspect its progress and burndown.");
  expect(host.querySelector('button[aria-label^="Sprint"], [aria-label="Sprint"]')).not.toBeNull();
  expect(button("Open sprints")).toBeDefined();
});
