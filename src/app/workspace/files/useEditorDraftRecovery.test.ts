// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useEditorDraftRecovery, editorDraftRecoveryKey } from "./useEditorDraftRecovery";
import type { EditorDraftRecoveryMetadata } from "../../../features/files/data/editorDraftRecovery";

const bridge = vi.hoisted(() => ({ list: vi.fn(), prepare: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("../../../features/files/data/editorDraftRecovery", () => ({
  listEditorDraftRecovery: bridge.list,
  prepareEditorDraftRestore: bridge.prepare,
}));
const row = (id = "source") =>
  ({
    ownerId: "a".repeat(64),
    documentId: id,
    revision: 1,
    payloadDigest: "b".repeat(64),
    path: "/repo/a.txt",
    state: "retained",
    serializedTextDigest: "c".repeat(64),
    baselineDigest: "d".repeat(64),
  }) as EditorDraftRecoveryMetadata;
const page = (records = [row()], next: { ownerId: string; documentId: string } | null = null) => ({
  version: 1,
  qualified: false,
  records,
  next,
});
const prepared = (documentId: string) => ({
  version: 1,
  qualified: false,
  source: row(),
  target: {
    ownerEpoch: "a".repeat(64),
    documentId,
    path: "/repo/a.txt",
    revision: 1,
    payloadDigest: "b".repeat(64),
  },
  payload: { text: "draft", diskBaseline: "base", eol: "lf" },
});
let root: Root;
let host: HTMLDivElement;
let result: ReturnType<typeof useEditorDraftRecovery>;
let allowed: boolean;
let openTargets: Set<string>;
let onOpen: ReturnType<typeof vi.fn>;
function Harness() {
  result = useEditorDraftRecovery({
    allowPath: () => allowed,
    isTargetOpen: (id) => openTargets.has(id),
    onOpen,
  });
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  allowed = true;
  openTargets = new Set();
  bridge.list.mockReset().mockResolvedValue(page());
  bridge.prepare
    .mockReset()
    .mockImplementation(async (_source, { documentId }) => prepared(documentId));
  onOpen = vi.fn(async (value) => {
    openTargets.add(value.target.documentId);
  });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const mount = () =>
  act(async () => root.render(createElement(StrictMode, null, createElement(Harness))));

it("retains a single pending initial catalog through StrictMode and publishes metadata after its actual read", async () => {
  let finish!: (value: ReturnType<typeof page>) => void;
  bridge.list.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await mount();
  expect(bridge.list).toHaveBeenCalledTimes(1);
  await act(async () => finish(page()));
  expect(result.records).toEqual([row()]);
  expect(result.loading).toBe(false);
});
it("keeps the previous catalog when a later pagination refresh fails", async () => {
  await mount();
  bridge.list
    .mockResolvedValueOnce(page([row("new")], { ownerId: "a".repeat(64), documentId: "new" }))
    .mockRejectedValueOnce(new Error("unavailable"));
  await act(async () => result.refresh());
  expect(result.records).toEqual([row()]);
  expect(result.error).toBe(true);
});
it("refuses duplicate inventory identities instead of fabricating a complete list", async () => {
  bridge.list.mockResolvedValue(page([row(), row()]));
  await mount();
  expect(result.error).toBe(true);
  expect(result.records).toHaveLength(0);
});
it("uses the same target ID for unknown-ACK retry and deduplicates a pending click", async () => {
  await mount();
  bridge.prepare.mockRejectedValueOnce(new Error("unknown ack"));
  await act(async () => {
    await expect(result.restore(row())).rejects.toThrow("unknown ack");
  });
  const id = bridge.prepare.mock.calls[0][1].documentId;
  let finish!: (value: ReturnType<typeof prepared>) => void;
  bridge.prepare.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  let pending!: Promise<void>;
  act(() => {
    pending = result.restore(row());
    expect(result.restore(row())).toBe(pending);
  });
  expect(bridge.prepare).toHaveBeenCalledTimes(1);
  await act(async () => {
    await Promise.resolve();
    finish(prepared(id));
    await pending;
  });
  expect(bridge.prepare.mock.calls[1][1].documentId).toBe(id);
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(result.errors.has(editorDraftRecoveryKey(row()))).toBe(false);
});
it("retains accepted copy identity across open failure but creates a fresh copy after an opened tab was closed", async () => {
  await mount();
  onOpen.mockRejectedValueOnce(new Error("open failed"));
  await act(async () => {
    await expect(result.restore(row())).rejects.toThrow("open failed");
  });
  await act(async () => result.restore(row()));
  const id = bridge.prepare.mock.calls[0][1].documentId;
  expect(bridge.prepare.mock.calls[1][1].documentId).toBe(id);
  openTargets.clear();
  await act(async () => result.restore(row()));
  expect(bridge.prepare.mock.calls[2][1].documentId).not.toBe(id);
});
it("rechecks current concealment after preparation before opening and preserves the source catalog", async () => {
  await mount();
  let finish!: (value: ReturnType<typeof prepared>) => void;
  bridge.prepare.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  let pending!: Promise<void>;
  act(() => {
    pending = result.restore(row());
  });
  await act(async () => {
    await Promise.resolve();
  });
  allowed = false;
  await act(async () => {
    finish(prepared("copy"));
    await expect(pending).rejects.toThrow("unavailable");
  });
  expect(onOpen).not.toHaveBeenCalled();
  expect(result.records).toEqual([row()]);
});
