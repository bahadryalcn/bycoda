// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProjectGroup } from "../model/projectGroups";
import { useProjectGroupMembers } from "./useProjectGroupMembers";

const save = vi.hoisted(() => ({
  settle: null as null | ((saved: boolean) => void),
  fail: null as null | (() => void),
}));

vi.mock("../model/projectGroups", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../model/projectGroups")>()),
  // The desktop app saves through a Host round-trip, so the order lands after the drop.
  saveProjectGroupMemberOrder: vi.fn(
    () =>
      new Promise<boolean>((resolve, reject) => {
        save.settle = resolve;
        save.fail = () => reject(new Error("refused"));
      }),
  ),
}));

let container: HTMLDivElement;
let root: Root;
type Api = ReturnType<typeof useProjectGroupMembers>;
let api: Api;
const report = (value: Api) => {
  api = value;
};

function Probe({ group }: { group: ProjectGroup }) {
  report(useProjectGroupMembers(group, ["/work/a", "/work/b"], ["ws"], () => undefined, String));
  return null;
}

const group: ProjectGroup = { id: "team", name: "Team", collapsed: false };
const order = () => api.members.map((member) => member.id);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container);
  act(() => root.render(createElement(Probe, { group })));
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

it("keeps a moved workspace in its new slot while the save is in flight", async () => {
  expect(order()).toEqual(["/work/a", "/work/b", "ws"]);
  act(() => void api.sortable.moveBy("ws", -1));
  expect(order()).toEqual(["/work/a", "ws", "/work/b"]);
  // The saved order arrives with the group, then the pending one is released.
  act(() =>
    root.render(
      createElement(Probe, {
        group: { ...group, memberOrder: ["/work/a", "group:ws", "/work/b"] },
      }),
    ),
  );
  await act(async () => save.settle?.(true));
  expect(order()).toEqual(["/work/a", "ws", "/work/b"]);
});

it("returns the workspace to its saved slot when the save is refused", async () => {
  act(() => void api.sortable.moveBy("ws", -1));
  expect(order()).toEqual(["/work/a", "ws", "/work/b"]);
  await act(async () => save.fail?.());
  expect(order()).toEqual(["/work/a", "/work/b", "ws"]);
});
