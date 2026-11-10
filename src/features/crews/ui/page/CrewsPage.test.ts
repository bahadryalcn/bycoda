// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { ActiveCrewMemberView } from "../../model/crewActive";
import { openCrewsPageAt } from "../../model/crewsPage";
import { CrewsPage } from "./CrewsPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hosts = vi.hoisted(() => ({ supported: true, items: [] as unknown[] }));
const worked = vi.hoisted(() => vi.fn());
const opened = vi.hoisted(() => vi.fn());

vi.mock("../../model/crewActive", () => ({
  useActiveCrewSupported: () => hosts.supported,
  useActiveCrewMembers: () => ({ data: { items: hosts.items, truncated: false } }),
}));
vi.mock("../../model/crewClient", () => ({
  useProjectCrews: () => ({
    isSuccess: true,
    data: { machine: { id: "host" }, project: { id: "p" }, definitions: [], runs: [] },
  }),
}));
vi.mock("../../model/crewActiveTarget", () => ({
  activeSessionTarget: async (item: { sessionId: string }) => ({ ...item, cwd: "/p" }),
}));
vi.mock("../MemberAvatar", () => ({ MemberAvatar: () => null }));
vi.mock("../CrewDialogHost", () => ({ CrewDialogHost: () => null }));
vi.mock("../CrewLibrary", () => ({ CrewLibrary: () => null }));
vi.mock("./CrewsTeams", () => ({ CrewsTeams: () => createElement("div", null, "teams-body") }));
vi.mock("./CrewsWork", () => ({
  CrewsWork: (props: { definitionId?: string; initialRunId?: string }) => {
    worked(props);
    return createElement("div", null, "work-body");
  },
}));

const member = (over: Partial<ActiveCrewMemberView> = {}) =>
  ({
    runId: "r1",
    projectId: "p",
    projectName: "Alpha",
    definitionId: "d1",
    definitionName: "Crew One",
    runStatus: "active",
    memberId: "m1",
    memberName: "Mia",
    memberRole: "specialist",
    kind: "worker",
    machineId: "host",
    sessionId: "s1",
    taskTitle: "Fix login",
    ...over,
  }) as ActiveCrewMemberView;

let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLElement | undefined;
function mount(onOpenSession = opened) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(CrewsPage, { cwd: "/p", onOpenSession })));
  return host;
}
const tabs = () => [...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  hosts.supported = true;
  hosts.items = [];
  vi.clearAllMocks();
});

it("lands on Active first when someone is working and lists the member", () => {
  hosts.items = [member()];
  const page = mount();
  expect(tabs()[0]).toContain("Active");
  expect(page.textContent).toContain("Mia");
  expect(page.textContent).toContain("Fix login");
  expect(page.textContent).toContain("Alpha");
});

it("starts on Teams when nobody works and offers New work on the empty Active tab", () => {
  const page = mount();
  expect(page.textContent).toContain("teams-body");
  act(() => document.querySelector<HTMLElement>('[role="tab"]')!.click());
  expect(page.textContent).toContain("No crew member is working right now");
  expect(page.textContent).toContain("New work");
});

it("hides the Active tab on hosts without the capability", () => {
  hosts.supported = false;
  hosts.items = [member()];
  const page = mount();
  expect(tabs().some((tab) => tab?.includes("Active"))).toBe(false);
  expect(page.textContent).toContain("teams-body");
});

it("opens the member's session from its row", async () => {
  hosts.items = [member()];
  const page = mount();
  const row = page.querySelector<HTMLButtonElement>("ul button");
  await act(async () => row!.click());
  expect(opened).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "s1", cwd: "/p" }));
});

it("names attention in text and opens that crew's work", () => {
  hosts.items = [member({ attention: "decision" })];
  const page = mount();
  expect(page.textContent).toContain("Needs decision");
  const action = [...page.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Open crew work"),
  );
  act(() => action!.click());
  expect(page.textContent).toContain("work-body");
  expect(worked).toHaveBeenLastCalledWith(
    expect.objectContaining({ definitionId: "d1", initialRunId: "r1" }),
  );
});

it("honors a landing request for the Work tab of one crew", () => {
  const page = mount();
  act(() => openCrewsPageAt({ tab: "work", definitionId: "d9", runId: "r9" }));
  expect(page.textContent).toContain("work-body");
  expect(worked).toHaveBeenLastCalledWith(
    expect.objectContaining({ definitionId: "d9", initialRunId: "r9" }),
  );
});
