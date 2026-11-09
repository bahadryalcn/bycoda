import { expect, it } from "vitest";
import type { SessionSummary } from "../data/sessionStore";
import { buildSessionList, sessionListNavigationIds } from "./sessionFolders";
import { orderLooseRows } from "./sessionOrder";
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

it("prioritizes input, failure and working, preserving finished/history ties", () => {
  const compare = sessionStatusOrder(new Set(["input"]), new Set(["working", "input", "failed"]));
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
    "old-b",
    "done",
    "old-a",
  ]);
  expect(compare(row("retry", "retrying"), row("working"))).toBe(0);
  expect(compare({ ...row("interrupted"), interrupted: true }, row("failed", "failed"))).toBe(0);
  expect(compare({ ...row("working"), interrupted: true }, row("working"))).toBe(0);
});

it("lifts unseen finished above working, and drafts below working", () => {
  const now = 10 * 24 * 60 * 60 * 1000;
  const compare = sessionStatusOrder(new Set(), new Set(["working"]), {
    doneIds: new Set(["done"]),
    draftIds: new Set(["typed"]),
    now,
  });
  const rows = [
    { ...row("idle"), updatedAt: now },
    { ...row("saved-draft"), draft: true, updatedAt: now },
    { ...row("typed"), updatedAt: now },
    { ...row("working"), updatedAt: now },
    { ...row("done"), updatedAt: now },
    { ...row("interrupted"), interrupted: true, updatedAt: now },
  ];
  expect(rows.sort(compare).map((session) => session.id)).toEqual([
    "interrupted",
    "done",
    "working",
    "saved-draft",
    "typed",
    "idle",
  ]);
});

it("keeps saved pin order but leaves loose rows in recency order", () => {
  const compare = sessionStatusOrder(new Set(), new Set());
  const rows = [
    { ...row("pin-new"), pinned: true },
    { ...row("pin-old"), pinned: true },
    row("newest"),
    row("older"),
  ];
  expect(orderLooseRows(rows, ["pin-old", "pin-new"], compare).map((r) => r.id)).toEqual([
    "pin-old",
    "pin-new",
    "newest",
    "older",
  ]);
});

it("keeps stale interruptions, failures and drafts in recency order", () => {
  const now = 10 * 24 * 60 * 60 * 1000;
  const stale = now - 4 * 24 * 60 * 60 * 1000;
  const compare = sessionStatusOrder(new Set(), new Set(), { draftIds: new Set(), now });
  const idle = { ...row("idle"), updatedAt: now };
  const staleDraft = { ...row("old"), draft: true, lastActivityAt: stale, updatedAt: now };
  expect(compare({ ...row("old"), interrupted: true, updatedAt: stale }, idle)).toBe(0);
  expect(compare({ ...row("old", "failed"), updatedAt: stale }, idle)).toBe(0);
  expect(compare(staleDraft, idle)).toBe(0);
  expect(compare({ ...row("new"), interrupted: true, updatedAt: now }, idle)).toBeLessThan(0);
});

it("applies status changes inside ordered folders, pins, reminders and loose rows", () => {
  const rows = [row("old"), row("working"), row("input")];
  let compare = sessionStatusOrder(new Set(["input"]), new Set(["working"]));
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
  compare = sessionStatusOrder(new Set(["old"]), new Set(["working"]));
  expect(
    sessionListNavigationIds(buildSessionList(rows, [], rows, false, undefined, compare), false),
  ).toEqual(["old", "working", "input"]);
  expect(folder.sessionIds).toEqual(["old", "working", "input"]);
});

it("ranks waiting rows right after working and before drafts", () => {
  const compare = sessionStatusOrder(new Set(), new Set(["working", "both"]), {
    waitingIds: new Set(["waiting", "both"]),
    draftIds: new Set(["draft"]),
  });
  const rows = [row("plain"), row("draft"), row("waiting"), row("both"), row("working")];
  expect(rows.sort(compare).map((session) => session.id)).toEqual([
    "both",
    "working",
    "waiting",
    "draft",
    "plain",
  ]);
});
