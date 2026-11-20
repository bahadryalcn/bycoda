// @vitest-environment happy-dom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { gitDiffIndex } = vi.hoisted(() => ({ gitDiffIndex: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
vi.mock("../../../platform/tauri/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/fs")>()),
  gitDiffIndex,
}));

import { adoptRemoteMachineInventory } from "../../connections/model/connections";
import {
  notifyRemoteRecovered,
  recordRemoteConnection,
  resetRemoteHealth,
} from "../../connections/model/remoteHealth";
import { remotePath } from "../../connections/model/remoteProjects";
import { resetGitIndexStore } from "../model/gitIndexStore";
import { useDiffIndex } from "./useDiffIndex";

const CWD = remotePath("env", "G:/Projects/repo");
const MACHINE = { id: "m1", name: "Desk", endpoint: "http://desk", environmentId: "env" };
const INDEX = { files: [], additions: 0, deletions: 0, branch: "main" };
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetRemoteHealth();
  resetGitIndexStore();
  adoptRemoteMachineInventory([]);
  gitDiffIndex.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  adoptRemoteMachineInventory([]);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const panel = createRef<HTMLDivElement>();
function View() {
  useDiffIndex(CWD, true, true, panel);
  return null;
}

// The Mac kept "Loading changes…" for minutes: every read of a project whose machine was
// removed failed, and the reconnect that followed found no machine and forgot every view's
// failure, so the panel went back to its spinner while its next read waited three minutes.
it("does not read the changes of a project whose machine is not added on this computer", async () => {
  gitDiffIndex.mockRejectedValue(
    new Error("This project’s machine isn’t connected on this computer."),
  );

  await act(async () => root.render(createElement(View)));

  expect(gitDiffIndex).not.toHaveBeenCalled();
});

it("reads the changes once the machine is added again", async () => {
  gitDiffIndex.mockResolvedValue(INDEX);
  await act(async () => root.render(createElement(View)));
  expect(gitDiffIndex).not.toHaveBeenCalled();

  await act(async () => adoptRemoteMachineInventory([MACHINE]));

  expect(gitDiffIndex).toHaveBeenCalledTimes(1);
});

it("keeps the loaded changes and starts no read while the machine is offline, then reloads", async () => {
  adoptRemoteMachineInventory([MACHINE]);
  gitDiffIndex.mockResolvedValue(INDEX);
  vi.useFakeTimers({ toFake: ["Date"] });
  let shown: ReturnType<typeof useDiffIndex> | undefined;
  const Probe = () => {
    shown = useDiffIndex(CWD, true, true, panel);
    return null;
  };
  await act(async () => root.render(createElement(Probe)));
  expect(gitDiffIndex).toHaveBeenCalledTimes(1);
  expect(shown?.index).not.toBeNull();

  await act(async () => recordRemoteConnection("env", "Machine is unreachable"));
  await act(async () => root.render(createElement(Probe)));

  expect(gitDiffIndex).toHaveBeenCalledTimes(1);
  expect(shown?.index).not.toBeNull();

  // The outage outlasted the two minutes a shared index stays fresh.
  vi.setSystemTime(Date.now() + 3 * 60_000);
  await act(async () => recordRemoteConnection("env"));
  await act(async () => notifyRemoteRecovered("env"));

  expect(gitDiffIndex.mock.calls.length).toBeGreaterThan(1);
});

// The read that met the outage failed, and its three-minute retry backoff outlived a short
// outage: the panel kept its stale changes after the machine answered again.
it("reads the changes as soon as the machine recovers from a failed read", async () => {
  adoptRemoteMachineInventory([MACHINE]);
  gitDiffIndex.mockRejectedValueOnce(new Error("Machine is unreachable"));
  await act(async () => root.render(createElement(View)));
  expect(gitDiffIndex).toHaveBeenCalledTimes(1);

  await act(async () => recordRemoteConnection("env", "Machine is unreachable"));
  gitDiffIndex.mockResolvedValue(INDEX);
  await act(async () => recordRemoteConnection("env"));
  await act(async () => notifyRemoteRecovered("env"));

  expect(gitDiffIndex).toHaveBeenCalledTimes(2);
});
