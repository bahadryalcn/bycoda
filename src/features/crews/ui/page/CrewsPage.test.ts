// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { openCrewsPageAt } from "../../model/crewsPage";
import { CrewsPage } from "./CrewsPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const crews = vi.hoisted(() => ({
  definitions: [{ id: "d1", name: "Crew One" }] as unknown[],
  runs: [] as unknown[],
}));
const worked = vi.hoisted(() => vi.fn());
const library = vi.hoisted(() => vi.fn());
const dialogs = vi.hoisted(() => vi.fn());

vi.mock("../../model/crewClient", () => ({
  useProjectCrews: () => ({
    isSuccess: true,
    data: {
      modelPoolsSupported: true,
      machine: { id: "host" },
      project: { id: "p" },
      definitions: crews.definitions,
      runs: crews.runs,
    },
  }),
}));
vi.mock("../CrewDialogHost", () => ({
  CrewDialogHost: (props: { dialog: unknown }) => {
    dialogs(props.dialog);
    return null;
  },
}));
vi.mock("../CrewLibrary", () => ({
  CrewLibrary: (props: { newMemberOpen: boolean }) => {
    library(props.newMemberOpen);
    return createElement("div", null, "members-body");
  },
}));
vi.mock("./CrewsActive", () => ({
  CrewsActive: () => createElement("div", null, "elsewhere-body"),
}));
vi.mock("./CrewsTeams", () => ({ CrewsTeams: () => createElement("div", null, "teams-body") }));
vi.mock("./CrewsWork", () => ({
  CrewsWork: (props: {
    definitionId?: string;
    initialRunId?: string;
    onCrewChange?: (id: string) => void;
  }) => {
    worked(props);
    return createElement("div", null, "work-body");
  },
}));

let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLElement | undefined;
function mount() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(CrewsPage, { cwd: "/p" })));
  return host;
}
const tabs = () => [...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
const headerAction = (page: HTMLElement) =>
  [...page.querySelectorAll("button")].find((button) =>
    ["New crew", "New member", "New work"].includes(button.textContent ?? ""),
  )!;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  crews.definitions = [{ id: "d1", name: "Crew One" }];
  crews.runs = [];
  vi.clearAllMocks();
});

it("has three tabs and no Active or Models tab", () => {
  mount();
  expect(tabs()).toEqual(["Teams", "Members", "Work"]);
});

it("lands on Teams when nothing needs the owner", () => {
  const page = mount();
  expect(page.textContent).toContain("teams-body");
});

it("lands on Work when a run needs the owner", () => {
  crews.runs = [
    {
      id: "r1",
      status: "active",
      definition: { id: "d1" },
      messages: [{ id: "m", text: "Pick one", resolvedAt: undefined }],
      tasks: [],
      assignments: [],
    },
  ];
  const page = mount();
  expect(page.textContent).toContain("work-body");
});

it("offers one primary header action that follows the tab", () => {
  const page = mount();
  expect(headerAction(page).textContent).toBe("New crew");
  expect(headerAction(page).getAttribute("data-button-variant")).toBe("primary");
  act(() => openCrewsPageAt({ tab: "members" }));
  expect(headerAction(page).textContent).toBe("New member");
  act(() => openCrewsPageAt({ tab: "work" }));
  expect(headerAction(page).textContent).toBe("New work");
  expect(page.querySelectorAll('button[data-button-variant="primary"]')).toHaveLength(1);
});

it("asks the Members tab for its new-member dialog from the header", () => {
  const page = mount();
  act(() => openCrewsPageAt({ tab: "members" }));
  expect(library).toHaveBeenLastCalledWith(false);
  act(() => headerAction(page).click());
  expect(library).toHaveBeenLastCalledWith(true);
});

it("starts work for the crew the Work tab shows", () => {
  crews.definitions = [
    { id: "d1", name: "One" },
    { id: "d2", name: "Two" },
  ];
  const page = mount();
  act(() => openCrewsPageAt({ tab: "work" }));
  act(() => worked.mock.lastCall![0].onCrewChange("d2"));
  act(() => headerAction(page).click());
  expect(dialogs).toHaveBeenLastCalledWith({ kind: "start", definitionId: "d2" });
});

it("does not start work for a crew that was deleted", () => {
  const page = mount();
  act(() => openCrewsPageAt({ tab: "work" }));
  act(() => worked.mock.lastCall![0].onCrewChange("gone"));
  act(() => headerAction(page).click());
  expect(dialogs).toHaveBeenLastCalledWith({ kind: "start", definitionId: undefined });
});

it("disables New work while no crew exists", () => {
  crews.definitions = [];
  const page = mount();
  act(() => openCrewsPageAt({ tab: "work" }));
  expect(headerAction(page).getAttribute("aria-disabled")).toBe("true");
});

it("honors a landing request for the Work tab of one crew", () => {
  const page = mount();
  act(() => openCrewsPageAt({ tab: "work", definitionId: "d9", runId: "r9" }));
  expect(page.textContent).toContain("work-body");
  expect(worked).toHaveBeenLastCalledWith(
    expect.objectContaining({ definitionId: "d9", initialRunId: "r9" }),
  );
});

it("keeps work in other projects on the Work tab only", () => {
  const page = mount();
  expect(page.textContent).not.toContain("elsewhere-body");
  act(() => openCrewsPageAt({ tab: "work" }));
  expect(page.textContent).toContain("elsewhere-body");
});
