// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

const { notifyDirsChanged, notifyMachineDirsChanged } = vi.hoisted(() => ({
  notifyDirsChanged: vi.fn(),
  notifyMachineDirsChanged: vi.fn(),
}));
vi.mock("./connections", () => ({ remoteRequest: vi.fn(), remoteMachineFor: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("../../files/public/fileTree", () => ({ notifyDirsChanged, notifyMachineDirsChanged }));

import { subscribeGitChanged } from "../../../platform/tauri/fs";
import "./remoteCommands";
import { announceRemoteRecovery } from "./remoteHealth";
import { remotePath } from "./remoteProjects";

const stops: (() => void)[] = [];
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  vi.clearAllMocks();
});

function watch(filter?: { cwd?: string }) {
  const listener = vi.fn();
  stops.push(subscribeGitChanged(listener, filter));
  return listener;
}

it("reloads only the recovered machine's git views and folders", () => {
  const recovered = watch({ cwd: remotePath("env-1", "/work/app") });
  const other = watch({ cwd: remotePath("env-2", "/work/app") });
  const local = watch({ cwd: "/work/local" });

  announceRemoteRecovery("env-1");

  expect(recovered).toHaveBeenCalledTimes(1);
  expect(other).not.toHaveBeenCalled();
  expect(local).not.toHaveBeenCalled();
  expect(notifyMachineDirsChanged).toHaveBeenCalledExactlyOnceWith("env-1");
  expect(notifyDirsChanged).not.toHaveBeenCalled();
});

it("keeps reloading every view when the recovery names no machine", () => {
  const recovered = watch({ cwd: remotePath("env-1", "/work/app") });
  const local = watch({ cwd: "/work/local" });

  announceRemoteRecovery();

  expect(recovered).toHaveBeenCalledTimes(1);
  expect(local).toHaveBeenCalledTimes(1);
  expect(notifyDirsChanged).toHaveBeenCalledTimes(1);
  expect(notifyMachineDirsChanged).not.toHaveBeenCalled();
});
