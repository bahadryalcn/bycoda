// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newDefaultSession } from "../model/session";
import type { HostSession } from "../../connections/model/protocol";
const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  load: vi.fn(),
  page: vi.fn(),
  block: vi.fn(),
  dispatch: vi.fn(),
  privacy: { lock: {} },
  locked: false,
}));
vi.mock("../../group-lock/model/groupLock", () => ({
  getGroupLockView: () => mocks.privacy,
  subscribeGroupLock: () => () => {},
}));
vi.mock("../model/localSessionNavigation", () => ({
  resolveLocalSessionReference: mocks.resolve,
  assertReferenceProjectVisible: () => {
    if (mocks.locked) throw new Error("locked");
  },
}));
vi.mock("../../connections/model/connections", () => ({
  loadRemoteSession: mocks.load,
  loadRemoteHistoryPage: mocks.page,
  loadRemoteBlock: mocks.block,
  sessionAccessForMachine: () => ({ dispatch: mocks.dispatch }),
}));
vi.mock("../../connections/model/sessionExecutionClient", () => ({
  sessionExecutionClient: (environmentId: string) => ({ environmentId, dispatch: mocks.dispatch }),
}));
import { useReadOnlyHostSession } from "./useReadOnlyHostSession";

let root: Root;
let container: HTMLDivElement;
let view: ReturnType<typeof useReadOnlyHostSession>;
let shell: ReturnType<typeof newDefaultSession>;
let snapshot: HostSession;
let visible: boolean;
function Harness() {
  view = useReadOnlyHostSession(shell, visible);
  return null;
}
async function render() {
  await act(async () => root.render(createElement(Harness)));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  localStorage.clear();
  mocks.privacy = { lock: {} };
  mocks.locked = false;
  visible = true;
  shell = {
    ...newDefaultSession("/project"),
    id: "shell",
    hostBinding: {
      kind: "local-host",
      machineId: "machine",
      environmentId: "environment",
      projectId: "project",
      sessionId: "canonical",
      authorityGeneration: null,
      created: true,
    },
  };
  snapshot = {
    session: {
      ...shell,
      id: "canonical",
      title: "Authoritative worker",
      blocks: [{ id: "tail", role: "user", text: "Latest question" }],
    },
    projectId: "project",
    revision: 7,
    status: "idle",
    history: { before: 1, revision: 7, totalBlocks: 2 },
  } as HostSession;
  mocks.resolve.mockResolvedValue({
    cwd: "/project",
    host: {
      machine: { id: "machine" },
      project: { id: "project" },
    },
  });
  mocks.load.mockResolvedValue(snapshot);
  mocks.page.mockResolvedValue({
    ...snapshot,
    history: undefined,
    session: {
      ...snapshot.session,
      blocks: [{ id: "older", role: "user", text: "Cited question" }, ...snapshot.session.blocks],
    },
  });
  mocks.block.mockResolvedValue({ id: "tail", role: "user", text: "Expanded question" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("reads the exact local Host worker through bounded preview pages without mounting any dispatch owner", async () => {
  await render();
  expect(mocks.resolve).toHaveBeenCalledWith({
    locator: { kind: "host", environmentId: "environment", sessionId: "canonical" },
  });
  expect(mocks.load).toHaveBeenCalledWith(
    "machine",
    "canonical",
    undefined,
    expect.objectContaining({
      pages: true,
      executionClient: expect.objectContaining({ environmentId: "environment" }),
    }),
  );
  expect(view.session.id).toBe("shell");
  expect(view.session.title).toBe("Authoritative worker");
  expect(view.session.blocks).toEqual(snapshot.session.blocks);
  expect(view.remoteHistoryHasMore).toBe(true);
  await act(async () => {
    await view.onLoadRemoteHistory();
  });
  expect(view.session.blocks.map((entry) => entry.id)).toEqual(["older", "tail"]);
  expect(view.remoteHistoryHasMore).toBe(false);
  await act(async () => {
    await view.onLoadRemoteBlock("tail");
  });
  expect(view.session.blocks[1].text).toBe("Expanded question");
  expect(mocks.dispatch).not.toHaveBeenCalled();
});

it("offers retry after an initial read error without changing session ownership", async () => {
  mocks.load.mockRejectedValueOnce(new Error("Disconnected"));
  await render();
  expect(view.error).toBe("Disconnected");
  expect(view.session.blocks).toEqual([]);
  await act(async () => view.retry());
  expect(view.error).toBeUndefined();
  expect(view.session.blocks).toHaveLength(1);
  expect(mocks.dispatch).not.toHaveBeenCalled();
});

it("does not read a mismatched machine or publish a mismatched project", async () => {
  mocks.resolve.mockResolvedValueOnce({
    cwd: "/project",
    host: { machine: { id: "foreign" }, project: { id: "project" } },
  });
  await render();
  expect(mocks.load).not.toHaveBeenCalled();
  expect(view.error).toContain("unavailable");
  mocks.load.mockResolvedValueOnce({ ...snapshot, projectId: "foreign-project" });
  await act(async () => view.retry());
  expect(view.session.blocks).toEqual([]);
  expect(view.error).toContain("unavailable");
});

it("discards pending reads and removes previous metadata after privacy changes", async () => {
  let finish!: (value: HostSession) => void;
  mocks.load.mockImplementationOnce(
    () =>
      new Promise<HostSession>((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  mocks.privacy = { lock: {} };
  visible = false;
  await render();
  await act(async () => finish(snapshot));
  expect(view.session.blocks).toEqual([]);
  expect(view.session.title).not.toBe("Authoritative worker");
  expect(mocks.dispatch).not.toHaveBeenCalled();
});

it("leaves failed history reads recoverable", async () => {
  await render();
  mocks.page.mockRejectedValueOnce(new Error("Page unavailable"));
  await act(async () => {
    await view.onLoadRemoteHistory();
  });
  expect(view.remoteHistoryError).toBe("Page unavailable");
  expect(view.remoteHistoryHasMore).toBe(true);
  expect(view.remoteHistoryLoading).toBe(false);
  await act(async () => {
    await view.onLoadRemoteHistory();
  });
  expect(view.remoteHistoryError).toBeUndefined();
  expect(view.session.blocks).toHaveLength(2);
  expect(mocks.dispatch).not.toHaveBeenCalled();
});

it("retains loaded worker history while hidden and during the next refresh", async () => {
  await render();
  const blocks = view.session.blocks;
  visible = false;
  await render();
  expect(view.session.blocks).toBe(blocks);
  mocks.load.mockImplementationOnce(() => new Promise(() => {}));
  visible = true;
  await render();
  expect(view.session.blocks).toBe(blocks);
  expect(view.session.historyLoading).toBe(false);
});
