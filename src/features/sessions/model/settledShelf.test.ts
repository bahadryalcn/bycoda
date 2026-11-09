// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import type { SessionSummary } from "../data/sessionStore";
import { buildSessionList, sessionListNavigationIds, type SessionFolder } from "./sessionFolders";
import {
  loadSettledSessionsCollapsed,
  saveSettledSessionsCollapsed,
  shelveSettledSessions,
} from "./settledShelf";

function summary(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id,
    cwd: "/tmp/project",
    harness: "cursor",
    model: "gpt-5",
    runtimeMode: "supervised",
    title: id,
    createdAt: 1,
    updatedAt: 1,
    additions: 0,
    deletions: 0,
    ...overrides,
  };
}

afterEach(() => localStorage.clear());

it("moves only loose settled sessions to a trailing Settled group", () => {
  const sessions = [
    summary("loose"),
    summary("settled"),
    summary("pinned", { pinned: true }),
    summary("foldered"),
    summary("reminded"),
  ];
  const folders: SessionFolder[] = [
    { id: "f", name: "f", sessionIds: ["foldered"], collapsed: false },
  ];
  const loose = sessions.filter((session) => session.id !== "foldered");
  const entries = shelveSettledSessions(
    buildSessionList(sessions, folders, loose, false, {
      sessionIds: ["reminded"],
      collapsed: false,
    }),
    () => true,
    true,
  );
  expect(entries.map((entry) => entry.kind)).toEqual(["reminders", "folder", "pinned", "settled"]);
  const shelf = entries.at(-1);
  expect(shelf?.kind === "settled" && shelf.sessions.map((session) => session.id)).toEqual([
    "loose",
    "settled",
  ]);
});

it("adds no group when nothing is settled, and a collapsed shelf hides its rows", () => {
  const entries = buildSessionList([summary("a")], [], [summary("a")]);
  expect(shelveSettledSessions(entries, () => false, true)).toEqual(entries);
  const shelved = shelveSettledSessions(entries, () => true, true);
  expect(sessionListNavigationIds(shelved, false)).toEqual([]);
  expect(sessionListNavigationIds(shelved, true)).toEqual(["a"]);
});

it("starts collapsed and remembers an opened shelf", () => {
  expect(loadSettledSessionsCollapsed()).toBe(true);
  saveSettledSessionsCollapsed(false);
  expect(loadSettledSessionsCollapsed()).toBe(false);
  saveSettledSessionsCollapsed(true);
  expect(loadSettledSessionsCollapsed()).toBe(true);
});
