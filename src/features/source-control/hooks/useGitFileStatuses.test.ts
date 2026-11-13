// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useGitFileStatuses } from "./useGitFileStatuses";
import { notifyDirsChanged } from "../../files/public/fileTree";
import { resetGitIndexStore } from "../model/gitIndexStore";

const api = vi.hoisted(() => ({ read: vi.fn(), available: true }));
vi.mock("../../../platform/tauri/fs", async (original) => ({
  ...(await original<typeof import("../../../platform/tauri/fs")>()),
  gitDiffFiles: api.read,
  subscribeGitChanged: () => () => {},
}));
vi.mock("../../connections/public/remoteHealth", () => ({
  remotePollDue: () => api.available,
  reportRemoteLoad: vi.fn(),
}));

let root: Root;
let serial = 0;
let left: string;
let right: string;
function View({ cwd }: { cwd: string }) {
  const statuses = useGitFileStatuses(cwd, true);
  return createElement("output", null, [...statuses.files.keys()].join(","));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  resetGitIndexStore();
  api.available = true;
  api.read.mockReset().mockImplementation(async (cwd: string) => ({
    head: "head",
    files: [{ path: `${cwd}/file.ts`, relative: "file.ts", status: "modified" }],
  }));
  root = createRoot(document.createElement("div"));
  serial++;
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const mount = () =>
  act(async () =>
    root.render(
      createElement(
        "div",
        null,
        createElement(View, { cwd: left }),
        createElement(View, { cwd: right }),
      ),
    ),
  );
const change = (cwd?: string) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(400);
    notifyDirsChanged(cwd);
    await vi.advanceTimersByTimeAsync(200);
  });

it.each(["local", "remote"])(
  "refreshes only the notified %s checkout and still handles unscoped changes",
  async (kind) => {
    const prefix = kind === "remote" ? "remote://host" : "";
    left = `${prefix}/status-${serial}-left`;
    right = `${prefix}/status-${serial}-right`;
    await mount();
    expect(api.read).toHaveBeenCalledTimes(2);
    api.read.mockClear();
    await change(`${left}/nested`);
    expect(api.read.mock.calls.map(([cwd]) => cwd)).toEqual([left]);
    api.read.mockClear();
    await change(right);
    expect(api.read.mock.calls.map(([cwd]) => cwd)).toEqual([right]);
    api.read.mockClear();
    await change();
    expect(api.read.mock.calls.map(([cwd]) => cwd).sort()).toEqual([left, right].sort());
  },
);

it("keeps unreachable remote directory polling paused until its existing health gate permits it", async () => {
  left = `remote://host/status-${serial}-left`;
  right = `remote://other/status-${serial}-right`;
  await mount();
  api.read.mockClear();
  api.available = false;
  await change(left);
  expect(api.read).not.toHaveBeenCalled();
  api.available = true;
  await change(left);
  expect(api.read.mock.calls.map(([cwd]) => cwd)).toEqual([left]);
});
