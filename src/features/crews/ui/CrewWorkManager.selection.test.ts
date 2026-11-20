// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrewWorkManager } from "./CrewWorkManager";
import type { CrewRunView, useProjectCrews } from "../model/crewClient";

vi.mock("./CrewMachineScope", () => ({
  useCrewMachineScope: (cwd: string, state: unknown) => ({
    cwd,
    state,
    picker: () => null,
    projectPicker: () => null,
  }),
}));
// The list and detail only expose what the manager hands them.
vi.mock("./CrewWorkDetail", () => ({
  CrewWorkDetail: ({ run }: { run: { id: string } }) =>
    createElement("div", { "data-detail": run.id }),
}));
vi.mock("./CrewWorkList", () => ({
  CrewWorkList: ({
    view,
    runs,
    selectedId,
    onViewChange,
    onSelect,
  }: {
    view: string;
    runs: { id: string }[];
    selectedId?: string;
    onViewChange: (view: "ongoing" | "finished") => void;
    onSelect: (id: string) => void;
  }) =>
    createElement(
      "div",
      { "data-list": view, "data-selected": selectedId ?? "" },
      runs.map((run) =>
        createElement("button", {
          key: run.id,
          "data-pick": run.id,
          onClick: () => onSelect(run.id),
        }),
      ),
      createElement("button", { "data-tab": "finished", onClick: () => onViewChange("finished") }),
    ),
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const definition = { id: "crew-1", name: "Crew", agents: [] };

function run(id: string, status: string, updatedAt: number): CrewRunView {
  return {
    id,
    title: id,
    status,
    updatedAt,
    definition,
    tasks: [],
    messages: [],
    assignments: [],
  } as unknown as CrewRunView;
}

function crewState(runs: CrewRunView[]) {
  return {
    data: {
      machine: { id: "m" },
      project: { id: "p" },
      definitions: [definition],
      runs,
      catalog: {},
    },
    error: null,
    refetch: vi.fn(),
    call: vi.fn(),
    dataUpdatedAt: 1,
  } as unknown as ReturnType<typeof useProjectCrews>;
}

async function render(runs: CrewRunView[]) {
  await act(async () =>
    root.render(
      createElement(CrewWorkManager, { cwd: "/repo", state: crewState(runs), layout: "page" }),
    ),
  );
}

const detail = () => container.querySelector("[data-detail]")?.getAttribute("data-detail");
const tab = () => container.querySelector("[data-list]")?.getAttribute("data-list");
const pick = (id: string) =>
  act(async () => container.querySelector<HTMLElement>(`[data-pick="${id}"]`)!.click());

it("keeps the chosen tab and run when the Host finishes the selected run", async () => {
  await render([run("a", "active", 3), run("b", "active", 2)]);
  await pick("b");
  expect(tab()).toBe("ongoing");
  expect(detail()).toBe("b");

  await render([run("a", "active", 3), run("b", "finished", 4)]);
  expect(tab()).toBe("ongoing");
  expect(detail()).toBe("b");
  expect(container.textContent).toContain("This work finished.");
  // The finished run left the Ongoing list but is not swapped for another run.
  expect(container.querySelector('[data-pick="b"]')).toBeNull();
});

it("keeps the Finished tab when a finished run is resumed", async () => {
  await render([run("a", "active", 3), run("b", "finished", 2)]);
  await act(async () => container.querySelector<HTMLElement>("[data-tab]")!.click());
  await pick("b");
  expect(tab()).toBe("finished");

  await render([run("a", "active", 3), run("b", "active", 4)]);
  expect(tab()).toBe("finished");
  expect(detail()).toBe("b");
  expect(container.textContent).toContain("This work is ongoing again.");
});

it("reports a deleted selected run instead of selecting the first run", async () => {
  await render([run("a", "active", 3), run("b", "active", 2)]);
  await pick("b");

  await render([run("a", "active", 3), run("c", "active", 1)]);
  expect(detail()).toBeUndefined();
  expect(container.textContent).toContain("This work no longer exists.");
  expect(container.querySelector("[data-list]")?.getAttribute("data-selected")).toBe("");

  // Moving on is the owner's explicit action.
  const choose = [...container.querySelectorAll("button")].find((node) =>
    node.textContent?.includes("Choose other work"),
  )!;
  await act(async () => choose.click());
  expect(detail()).toBe("a");
  expect(container.textContent).not.toContain("This work no longer exists.");
});
