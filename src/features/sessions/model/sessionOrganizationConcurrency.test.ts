// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: native.invoke }));
vi.mock("./sessionPinSaga", () => ({ listPinSagas: async () => [] }));

import {
  executeOrganizationOperation,
  previewOrganizationOperation,
} from "./sessionOrganizationOperations";

it("replays a real native gesture after another window changes an unrelated folder", async () => {
  const foldersKey = "bycoda.sessionFolders",
    orderKey = "bycoda.sessionOrder";
  const folderA = { id: "a", name: "A", sessionIds: ["s1"], collapsed: false };
  const folderB = { id: "b", name: "B", sessionIds: ["s2"], collapsed: false };
  const values = new Map<string, { version: number; value: unknown }>([
    [foldersKey, { version: 1, value: JSON.stringify({ "/project": [folderA, folderB] }) }],
    [orderKey, { version: 1, value: JSON.stringify({ "/project": { loose: ["s3"] } }) }],
  ]);
  let revision = 1;
  let injected = false;
  const receipts = new Map<string, unknown>();
  native.invoke.mockImplementation(async (command: string, args: any) => {
    if (command === "canonical_store_page_token") return "page";
    if (command === "canonical_store_list") return { revision, entries: [] };
    if (command === "canonical_store_read")
      return {
        revision,
        entries: args.keys.flatMap((key: string) => {
          const entry = values.get(key);
          return entry ? [{ key, ...structuredClone(entry) }] : [];
        }),
      };
    if (command === "canonical_store_receipt") return receipts.get(args.operationId) ?? null;
    if (command !== "canonical_store_transaction") throw new Error(`Unexpected ${command}`);
    if (!injected && String(args.operationId).includes(":effect:")) {
      injected = true;
      values.set(foldersKey, {
        version: 2,
        value: JSON.stringify({ "/project": [folderA, { ...folderB, colorIndex: 2 }] }),
      });
      revision++;
    }
    const applied =
      revision === args.expectedRevision &&
      args.checks.every((check: any) => (values.get(check.key)?.version ?? null) === check.version);
    if (applied) {
      for (const write of args.writes)
        values.set(write.key, {
          version: (values.get(write.key)?.version ?? 0) + 1,
          value: structuredClone(write.value),
        });
      revision++;
    }
    const result = { applied, revision, compacted: false, entries: [] };
    receipts.set(args.operationId, result);
    return result;
  });
  const result = await executeOrganizationOperation("concurrent-rename", {
    kind: "rename",
    cwd: "/project",
    folderId: "a",
    name: "Renamed",
  });
  expect(result.state).toBe("applied");
  const stored = JSON.parse(values.get(foldersKey)!.value as string)["/project"];
  expect(stored).toEqual([
    { ...folderA, name: "Renamed" },
    { ...folderB, colorIndex: 2 },
  ]);
  expect(JSON.parse(values.get(orderKey)!.value as string)["/project"].loose).toEqual(["s3"]);
});

it("applies collapse, pin and rebase over current independent edits", () => {
  const cwd = "/project";
  const state = {
    folders: {
      [cwd]: [{ id: "a", name: "Renamed", sessionIds: ["s1"], collapsed: false, colorIndex: 2 }],
    },
    order: { [cwd]: { loose: ["s2"], pinned: ["s3"] } },
  };
  const collapsed = previewOrganizationOperation(state, {
    kind: "folderCollapsed",
    cwd,
    folderId: "a",
    collapsed: true,
  });
  const pinned = previewOrganizationOperation(collapsed, {
    kind: "folderPinned",
    cwd,
    folderId: "a",
    pinned: true,
  });
  const rebased = previewOrganizationOperation(pinned, { kind: "rebase", cwd, to: "/renamed" });
  expect(rebased.folders["/renamed"]).toEqual([
    { id: "a", name: "Renamed", sessionIds: ["s1"], collapsed: true, colorIndex: 2, pinned: true },
  ]);
  expect(rebased.order["/renamed"]).toEqual({ loose: ["s2"], pinned: ["s3"] });
});
