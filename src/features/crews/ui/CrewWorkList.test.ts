// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CrewRunView } from "../model/crewClient";
import { CrewWorkList, type CrewWorkView } from "./CrewWorkList";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // The list scrolls the open run into view by its id; happy-dom has no CSS.escape.
  vi.stubGlobal("CSS", { escape: (value: string) => value });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function run(id: string, title: string): CrewRunView {
  return {
    id,
    title,
    status: "active",
    updatedAt: 1,
    coordinatorStatus: "idle",
    tasks: [],
    messages: [],
    assignments: [],
  } as unknown as CrewRunView;
}

const runs = [run("a", "First work"), run("b", "Second work")];

async function render({
  selectedId = "a",
  disabled = false,
  onSelect = vi.fn(),
}: { selectedId?: string; disabled?: boolean; onSelect?: (id: string) => void } = {}) {
  const view: CrewWorkView = "ongoing";
  await act(async () =>
    root.render(
      createElement(CrewWorkList, {
        view,
        ongoingCount: runs.length,
        runs,
        listedCount: runs.length,
        query: "",
        selectedId,
        disabled,
        onViewChange: vi.fn(),
        onQueryChange: vi.fn(),
        onSelect,
      }),
    ),
  );
  return onSelect;
}

const row = (id: string) => container.querySelector<HTMLButtonElement>(`[data-crew-work-choice="${id}"]`)!;

it("uses a plain list with no navigation landmark or toggle state", async () => {
  await render();
  expect(container.querySelector("nav")).toBeNull();
  expect(container.querySelector("[aria-pressed]")).toBeNull();
  expect(container.querySelector('ul[aria-label="Work list"] > li')).not.toBeNull();
  expect(container.querySelectorAll('ul[aria-label="Work list"] > li')).toHaveLength(2);
});

it("marks only the open run as current", async () => {
  await render({ selectedId: "b" });
  expect(row("b").getAttribute("aria-current")).toBe("true");
  expect(row("a").hasAttribute("aria-current")).toBe(false);
});

it("selects a run on click", async () => {
  const onSelect = await render({ selectedId: "a" });
  await act(async () => row("b").click());
  expect(onSelect).toHaveBeenCalledWith("b");
});

it("keeps rows focusable and ignores selection while an action is pending", async () => {
  const onSelect = await render({ disabled: true });
  expect(row("a").hasAttribute("disabled")).toBe(false);
  expect(row("a").getAttribute("aria-disabled")).toBe("true");
  await act(async () => row("b").click());
  expect(onSelect).not.toHaveBeenCalled();
});
