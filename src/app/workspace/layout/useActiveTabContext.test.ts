import { expect, it } from "vitest";
import { newSession } from "../../../features/sessions/model/session";
import { isProjectLockedIn, type LockSnapshot } from "../../../features/group-lock/model/lockState";
import { pathKey } from "../../../shared/lib/paths";
import {
  toolsContextForSession,
  toolsContextForSessionCached,
  toolsSessionsFor,
} from "./useActiveTabContext";

const lock: LockSnapshot = {
  lockedGroupIds: new Set(["group"]),
  lockedProjectKeys: new Set([pathKey("/repo/locked")]),
};

function session(id: string, cwd: string) {
  return { ...newSession("codex", cwd), id, title: `Title ${id}` };
}

it("returns the same tools context object for the same session", () => {
  const a = session("a", "/repo/one");
  const first = toolsContextForSessionCached(a);
  expect(first).not.toBeNull();
  expect(toolsContextForSessionCached(a)).toBe(first);
  // A new session object (a change) gets its own context.
  expect(toolsContextForSessionCached({ ...a, busy: true })).not.toBe(first);
});

it("selects the same tools sessions as the previous JSON round-trip", () => {
  const sessions = [
    session("a", "/repo/one"),
    session("b", "/repo/locked"),
    session("c", "/repo/two"),
  ];
  expect(isProjectLockedIn(lock, "/repo/locked")).toBe(true);
  const previous = JSON.parse(
    JSON.stringify(
      sessions
        .filter((entry) => !isProjectLockedIn(lock, entry.cwd))
        .map(toolsContextForSession)
        .filter(Boolean),
    ),
  );
  expect(toolsSessionsFor(sessions, lock)).toEqual(previous);
  expect(previous.map((entry: { composerSessionId: string }) => entry.composerSessionId)).toEqual([
    "a",
    "c",
  ]);
});

it("keeps identical objects across selections when sessions are unchanged", () => {
  const sessions = [session("a", "/repo/one")];
  const [first] = toolsSessionsFor(sessions, lock);
  expect(toolsSessionsFor(sessions, lock)[0]).toBe(first);
});
