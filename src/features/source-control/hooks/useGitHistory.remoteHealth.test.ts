// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { gitHistory, reportRemoteLoad } = vi.hoisted(() => ({
  gitHistory: vi.fn(),
  reportRemoteLoad: vi.fn(),
}));
vi.mock("../../../platform/tauri/fs", () => ({
  gitHistory,
  subscribeGitChanged: () => () => {},
  isGitWatched: () => true,
}));
vi.mock("../../connections/public/remoteHealth", () => ({
  reportRemoteLoad,
  useRemoteLoadFailure: () => null,
}));
vi.mock("../../projects/public/recents", () => ({ isRemoteProjectPath: () => true }));

import { presentRemoteError } from "../../connections/public/remoteFailure";
import { useGitHistory } from "./useGitHistory";
import { resetGitResourceCache } from "./useGitResource";

const CWD = "remote://machine/project";
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetGitResourceCache();
  gitHistory.mockReset();
  reportRemoteLoad.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function View() {
  useGitHistory(CWD, true, false);
  return null;
}

// A transient failure has no on-screen message. Reporting the message instead of the
// outcome told remote health the machine recovered, which reloaded every git reader,
// which failed again: an endless reload loop that froze the window.
it("reports a failed read that shows no message as a failure", async () => {
  const unreachable = new Error("This project's machine isn't connected on this computer.");
  expect(presentRemoteError(unreachable)).toBeUndefined();
  gitHistory.mockRejectedValue(unreachable);

  await act(async () => root.render(createElement(View)));

  expect(reportRemoteLoad).toHaveBeenCalledWith(CWD, "graph", unreachable);
  expect(reportRemoteLoad.mock.calls.filter((call) => call[2] === undefined)).toEqual([]);
});

it("keeps reporting the failure after the failed resource remounts", async () => {
  const unreachable = new Error("This project's machine isn't connected on this computer.");
  gitHistory.mockRejectedValue(unreachable);

  await act(async () => root.render(createElement(View)));
  await act(async () => root.render(null));
  reportRemoteLoad.mockReset();
  await act(async () => root.render(createElement(View)));

  expect(reportRemoteLoad.mock.calls.filter((call) => call[2] === undefined)).toEqual([]);
});

it("reports a successful read as recovered", async () => {
  gitHistory.mockResolvedValue({ commits: [] });

  await act(async () => root.render(createElement(View)));

  expect(reportRemoteLoad).toHaveBeenLastCalledWith(CWD, "graph", undefined);
});
