// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { notifyDirsChanged } = vi.hoisted(() => ({ notifyDirsChanged: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
vi.mock("../model/fileTree", () => ({
  notifyDirsChanged,
  subscribeDirsChanged: () => () => {},
}));

import { adoptRemoteMachineInventory } from "../../connections/model/connections";
import { recordRemoteConnection, resetRemoteHealth } from "../../connections/model/remoteHealth";
import { remotePath } from "../../connections/model/remoteProjects";
import { useFileTreePolling } from "./useFileTreePolling";

const MACHINE = { id: "m1", name: "Desk", endpoint: "http://desk", environmentId: "env" };
const CWD = remotePath("env", "G:/Projects/tree");
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetRemoteHealth();
  adoptRemoteMachineInventory([MACHINE]);
  notifyDirsChanged.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  adoptRemoteMachineInventory([]);
  vi.unstubAllGlobals();
});

function Tree() {
  useFileTreePolling(CWD, true);
  return null;
}

it("re-lists a retained tree on return only while its machine can be asked", async () => {
  await act(async () => root.render(createElement(Tree)));
  recordRemoteConnection("env", "Machine is unreachable");

  window.dispatchEvent(new Event("focus"));
  expect(notifyDirsChanged).not.toHaveBeenCalled();

  recordRemoteConnection("env");
  window.dispatchEvent(new Event("focus"));
  expect(notifyDirsChanged).toHaveBeenCalledWith(CWD, true, true);
});
