// @vitest-environment happy-dom
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { saveGitPanelSection } from "../model/panelSections";

vi.mock("./GitStashSection", () => ({
  GitStashSection: () => createElement("section", { "data-section": "stashes" }),
}));
vi.mock("./GitHistoryGraph", () => ({
  GRAPH_PANEL_DEFAULT: 240,
  GRAPH_PANEL_MIN: 120,
  loadGraphPanelHeight: () => 240,
  saveGraphPanelHeight: vi.fn(),
  GraphResizeSash: () => null,
  GitHistoryGraph: (props: { expanded: boolean; onToggleExpanded: () => void }) =>
    createElement(
      "button",
      { "data-section": "graph", "aria-expanded": props.expanded, onClick: props.onToggleExpanded },
      "Graph",
    ),
}));

import { GitPanelSections, usePanelPreferencesMenu } from "./GitPanelSections";

let host: HTMLDivElement;
let root: Root;
const toggleAutoFetch = vi.fn();

function Panel({ repository = false }: { repository?: boolean }) {
  const pane = useRef<HTMLDivElement>(null);
  const preferences = usePanelPreferencesMenu({
    autoFetch: false,
    canFetch: true,
    onToggleAutoFetch: toggleAutoFetch,
  });
  return createElement(
    "div",
    // oxlint-disable-next-line react-hooks-js/refs -- the test passes the pane ref object down; nothing reads .current during render
    { ref: pane, onContextMenu: preferences.onContextMenu },
    preferences.menu,
    createElement("header", null, "api"),
    createElement("textarea"),
    // oxlint-disable-next-line react-hooks-js/refs -- the test passes the pane ref object down; nothing reads .current during render
    createElement(GitPanelSections, {
      cwd: "/repo",
      enabled: true,
      hasChanges: false,
      onOpenCommit: vi.fn(),
      paneRef: pane,
      repository,
    }),
  );
}

const sections = () =>
  [...host.querySelectorAll("[data-section]")].map((node) => node.getAttribute("data-section"));
const rightClick = async (target: Element) => {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  await act(async () => target.dispatchEvent(event));
  return event;
};
const pick = async (label: string) => {
  const item = [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find((row) =>
    row.textContent?.includes(label),
  );
  if (!item) throw new Error(`No menu item ${label}`);
  await act(async () => item.click());
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  saveGitPanelSection("stashes", true);
  saveGitPanelSection("graph", true);
  toggleAutoFetch.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("hides and restores a section from the panel's context menu and remembers the choice", async () => {
  await act(async () => root.render(createElement(Panel)));
  expect(sections()).toEqual(["stashes", "graph"]);
  await rightClick(host.querySelector("header")!);
  await pick("Graph");
  expect(sections()).toEqual(["stashes"]);
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(JSON.parse(localStorage.getItem("bycoda.gitPanelSections")!)).toEqual({
    stashes: true,
    graph: false,
  });
  await rightClick(host.querySelector("header")!);
  await pick("Stashes");
  expect(sections()).toEqual([]);
  await rightClick(host.querySelector("header")!);
  await pick("Graph");
  expect(sections()).toEqual(["graph"]);
});

it("offers Auto Fetch beside the section choices", async () => {
  await act(async () => root.render(createElement(Panel)));
  await rightClick(host.querySelector("header")!);
  await pick("Auto Fetch");
  expect(toggleAutoFetch).toHaveBeenCalledTimes(1);
});

it("leaves text fields and rows with their own menus alone", async () => {
  await act(async () => root.render(createElement(Panel)));
  expect((await rightClick(host.querySelector("textarea")!)).defaultPrevented).toBe(false);
  const claimed = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  claimed.preventDefault();
  await act(async () => host.querySelector("header")!.dispatchEvent(claimed));
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it("starts a repository row's graph folded while the single panel keeps it open", async () => {
  await act(async () => root.render(createElement(Panel)));
  expect(host.querySelector('[data-section="graph"]')!.getAttribute("aria-expanded")).toBe("true");
  await act(async () => root.render(createElement(Panel, { key: "row", repository: true })));
  expect(host.querySelector('[data-section="graph"]')!.getAttribute("aria-expanded")).toBe("false");
});
