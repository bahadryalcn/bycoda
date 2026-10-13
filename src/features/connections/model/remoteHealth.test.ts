import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  notifyRemoteRecovered,
  readRemoteConnection,
  remotePollDue,
  reportRemoteLoad,
  resetRemoteConnection,
  resetRemoteHealth,
  subscribeRemoteRecovered,
} from "./remoteHealth";
import { remotePath } from "./remoteProjects";

const project = remotePath("env", "/Users/me/repo");
const down = "Machine is unreachable. Check the host and SSH tunnel, then reconnect.";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  resetRemoteHealth();
});
afterEach(() => vi.useRealTimers());

it("slows polling while unreachable and resumes after one success", () => {
  const recovered = vi.fn();
  const unsubscribe = subscribeRemoteRecovered(recovered);
  expect(remotePollDue(project)).toBe(true);

  reportRemoteLoad(project, "changes", down);
  expect(remotePollDue(project)).toBe(false);
  vi.advanceTimersByTime(14_999);
  expect(remotePollDue(project)).toBe(false);
  vi.advanceTimersByTime(1);
  expect(remotePollDue(project)).toBe(true);

  // A second failure in a row backs off further, to 30 seconds.
  reportRemoteLoad(project, "graph", down);
  vi.advanceTimersByTime(29_999);
  expect(remotePollDue(project)).toBe(false);
  vi.advanceTimersByTime(1);
  expect(remotePollDue(project)).toBe(true);

  reportRemoteLoad(project, "files");
  expect(remotePollDue(project)).toBe(true);
  expect(recovered).toHaveBeenCalledTimes(1);
  // Successes while healthy are not recoveries.
  reportRemoteLoad(project, "files");
  expect(recovered).toHaveBeenCalledTimes(1);
  unsubscribe();
});

it("treats an error from the machine itself as proof it is reachable", () => {
  reportRemoteLoad(project, "changes", down);
  expect(remotePollDue(project)).toBe(false);
  reportRemoteLoad(project, "graph", "Host rejected request: Not a working copy");
  expect(remotePollDue(project)).toBe(true);
});

it("resumes immediately after a reconnect", () => {
  const recovered = vi.fn();
  subscribeRemoteRecovered(recovered);
  reportRemoteLoad(project, "changes", down);
  notifyRemoteRecovered();
  expect(remotePollDue(project)).toBe(true);
  expect(recovered).toHaveBeenCalledTimes(1);
});

it("never records or slows local projects", () => {
  reportRemoteLoad("/Users/me/repo", "changes", down);
  expect(remotePollDue("/Users/me/repo")).toBe(true);
  expect(remotePollDue(project)).toBe(true);
});

it("keeps one connection status per machine, fed by every view's loads", () => {
  expect(readRemoteConnection("env").status).toBe("connecting");
  reportRemoteLoad(project, "files");
  expect(readRemoteConnection("env").status).toBe("connected");
  reportRemoteLoad(project, "changes", down);
  expect(readRemoteConnection("env")).toMatchObject({ status: "unreachable" });
  expect(readRemoteConnection("other").status).toBe("connecting");
  reportRemoteLoad(project, "graph");
  expect(readRemoteConnection("env").status).toBe("connected");
  // A host that is too old stays flagged until it is reconnected or updated.
  reportRemoteLoad(project, "changes", "Host rejected request: Unsupported workspace command");
  reportRemoteLoad(project, "files");
  expect(readRemoteConnection("env").status).toBe("outdated-host");
  notifyRemoteRecovered("env");
  expect(readRemoteConnection("env").status).toBe("connected");
});

it("starts a machine's connection over when its address is edited", () => {
  const recovered = vi.fn();
  const unsubscribe = subscribeRemoteRecovered(recovered);
  reportRemoteLoad(project, "changes", down);
  expect(readRemoteConnection("env").status).toBe("unreachable");
  expect(remotePollDue(project)).toBe(false);
  resetRemoteConnection("env");
  expect(readRemoteConnection("env")).toEqual({ status: "connecting" });
  expect(remotePollDue(project)).toBe(true);
  expect(recovered).not.toHaveBeenCalled();
  unsubscribe();
});
