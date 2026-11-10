import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { ApprovalMirrorEntry } from "../../src/shared/model/host-contracts/approvals";
import { ownerApprovalSignature } from "../../src/shared/model/ownerApprovalSignature";
import { HostStore } from "../store";
import { ApprovalRegistry, APPROVAL_KEEP_MS } from "./approval-registry";
import { ApprovalStore } from "./approval-store";

const DESKTOP = "desktop-hash";
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function entry(id: string, deadline: number) {
  const base = {
    id,
    title: `Title ${id}`,
    message: "Approve this exact operation",
    confirmLabel: "Approve",
    cancelLabel: "Cancel",
    deadline,
    remote: true,
  };
  return { ...base, signature: await ownerApprovalSignature(base) } as ApprovalMirrorEntry;
}

function host() {
  const dir = mkdtempSync(join(tmpdir(), "approvals-"));
  const store = new HostStore(join(dir, "host.db"));
  cleanups.push(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  let now = 1_000;
  const open = async () => {
    const registry = new ApprovalRegistry(() => now, new ApprovalStore(store.db));
    await registry.ready;
    registry.noteDesktop(DESKTOP);
    return registry;
  };
  return {
    open,
    rows: async () =>
      Number((await store.db.prepare("SELECT COUNT(*) AS n FROM approval_relay").get())?.n),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

it("keeps pending approvals and a phone decision across a registry re-create", async () => {
  const h = host();
  const first = await h.open();
  const a = await entry("a", 241_000);
  const b = await entry("b", 241_000);
  await first.mirror(DESKTOP, { upsert: [a, b], remove: [] });
  first.decide({ id: "a", signature: a.signature, approved: true });
  first.markPushed("b");
  await first.flush();

  const second = await h.open();
  expect(second.list().map((view) => [view.id, view.status])).toEqual([
    ["b", "pending"],
    ["a", "approved"],
  ]);
  expect(second.decisions(DESKTOP)).toEqual([{ id: "a", signature: a.signature, approved: true }]);
  // The push flag survives: no second push for the same approval.
  expect(second.unpushed()).toEqual([]);
  expect(second.decide({ id: "a", signature: a.signature, approved: false })).toMatchObject({
    alreadyDecided: true,
    approved: true,
  });
});

it("expires by deadline after a restart and prunes after the retention window", async () => {
  const h = host();
  const first = await h.open();
  const a = await entry("a", 241_000);
  await first.mirror(DESKTOP, { upsert: [a], remove: [] });
  await first.flush();
  h.advance(300_000);
  const second = await h.open();
  expect(second.list()).toMatchObject([{ id: "a", status: "expired" }]);
  await second.flush();
  expect(second.decisions(DESKTOP)).toEqual([]);

  h.advance(APPROVAL_KEEP_MS + 1_000);
  const third = await h.open();
  expect(third.list()).toEqual([]);
  await third.flush();
  expect(await h.rows()).toBe(0);
});
