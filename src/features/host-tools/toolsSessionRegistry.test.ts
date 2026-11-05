import { expect, it } from "vitest";
import {
  mergeToolsSource,
  sameToolsSession,
  toolsSessionOptions,
  toolsSessionKey,
  type ToolsSourceSnapshot,
} from "./toolsSessionRegistry";
const session = {
  cwd: "remote://mac/repo",
  sessionId: "host-one",
  composerSessionId: "shell-one",
  title: "One",
};
const snapshot: ToolsSourceSnapshot = {
  sourceWindow: "main",
  revision: 2,
  selectionRevision: 10,
  active: session,
  panes: [{ ...session, id: "one" }],
};
it("keeps remote environment and Host identity separate from composer IDs", () => {
  expect(sameToolsSession(session, { ...session, composerSessionId: "other" })).toBe(true);
  expect(sameToolsSession(session, { ...session, cwd: "remote://linux/repo" })).toBe(false);
  expect(sameToolsSession(session, { ...session, sessionId: "shell-one" })).toBe(false);
});
it("ignores out-of-order source snapshots and preserves selector order on status updates", () => {
  const initial = mergeToolsSource(new Map(), snapshot);
  expect(mergeToolsSource(initial, { ...snapshot, revision: 1, panes: [] })).toBe(initial);
  const two = { ...session, sessionId: "host-two", title: "Two" };
  const next = mergeToolsSource(initial, {
    ...snapshot,
    revision: 3,
    panes: [
      { ...session, id: "one", status: "Working" },
      { ...two, id: "two" },
    ],
  });
  expect(toolsSessionOptions(next).map((item) => item.title)).toEqual(["One", "Two"]);
  expect(toolsSessionOptions(next)[0].status).toBe("Working");
  expect(toolsSessionOptions(next, { ...two, sessionId: "empty", title: "Empty" })).toHaveLength(3);
});

it("uses shared project path identity for Windows and preserves remote POSIX case", () => {
  expect(toolsSessionKey({ cwd: "G:/Projects/Repo", sessionId: "one" })).toBe(
    toolsSessionKey({ cwd: "g:/projects/repo/", sessionId: "one" }),
  );
  expect(toolsSessionKey({ cwd: "remote://mac/Users/Repo", sessionId: "one" })).not.toBe(
    toolsSessionKey({ cwd: "remote://mac/users/repo", sessionId: "one" }),
  );
  expect(toolsSessionKey({ cwd: "remote://pc/G:/Repo", sessionId: "one" })).toBe(
    toolsSessionKey({ cwd: "remote://pc/g:/repo", sessionId: "one" }),
  );
});

it("accepts restarted source revisions while rejecting late pre-reload snapshots", () => {
  const previous = mergeToolsSource(new Map(), { ...snapshot, sourceEpoch: 100, revision: 20 });
  const restarted = mergeToolsSource(previous, { ...snapshot, sourceEpoch: 101, revision: 1 });
  expect(restarted.get("main")?.revision).toBe(1);
  expect(mergeToolsSource(restarted, { ...snapshot, sourceEpoch: 100, revision: 99 })).toBe(
    restarted,
  );
});
