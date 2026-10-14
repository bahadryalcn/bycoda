import { expect, it } from "vitest";
import type { SessionSummary } from "../data/sessionStore";
import { buildSessionList, sessionListNavigationIds } from "./sessionFolders";
import { sessionStatusOrder } from "./sessionStatusOrder";

const row = (id: string, issue?: SessionSummary["issue"]): SessionSummary => ({
  id,
  issue,
  cwd: "/project",
  harness: "codex",
  model: "",
  runtimeMode: "supervised",
  title: id,
  createdAt: 1,
  updatedAt: 1,
  additions: 0,
  deletions: 0,
});

it("prioritizes input, failure, working, done and then history, preserving ties", () => {
  const compare = sessionStatusOrder(
    new Set(["input"]),
    new Set(["working", "input", "failed"]),
    new Set(["done", "failed"]),
  );
  const rows = [
    row("old-b"),
    row("done"),
    row("working"),
    row("failed", "failed"),
    row("input"),
    row("old-a"),
  ];
  expect(rows.sort(compare).map((session) => session.id)).toEqual([
    "input",
    "failed",
    "working",
    "done",
    "old-b",
    "old-a",
  ]);
  expect(compare(row("retry", "retrying"), row("working"))).toBe(0);
});

it("applies status changes inside ordered folders, pins, reminders and loose rows", () => {
  const rows = [row("old"), row("working"), row("input")];
  let compare = sessionStatusOrder(new Set(["input"]), new Set(["working"]), new Set());
  const folder = {
    id: "group",
    name: "Group",
    sessionIds: ["old", "working", "input"],
    ordered: true,
    collapsed: false,
  };
  expect(
    sessionListNavigationIds(
      buildSessionList(rows, [folder], [], false, undefined, compare),
      false,
    ),
  ).toEqual(["input", "working", "old"]);
  expect(
    sessionListNavigationIds(
      buildSessionList(
        rows,
        [],
        rows,
        false,
        { sessionIds: ["old", "working", "input"], collapsed: false },
        compare,
      ),
      false,
    ),
  ).toEqual(["input", "working", "old"]);
  const pins = rows.map((session) => ({ ...session, pinned: true }));
  expect(
    sessionListNavigationIds(buildSessionList(pins, [], pins, false, undefined, compare), false),
  ).toEqual(["input", "working", "old"]);
  compare = sessionStatusOrder(new Set(["old"]), new Set(["working"]), new Set(["input"]));
  expect(
    sessionListNavigationIds(buildSessionList(rows, [], rows, false, undefined, compare), false),
  ).toEqual(["old", "working", "input"]);
  expect(folder.sessionIds).toEqual(["old", "working", "input"]);
});
