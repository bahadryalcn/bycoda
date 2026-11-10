import { describe, expect, it } from "vitest";
import type { ApprovalMirrorEntry } from "../../src/shared/model/host-contracts/approvals";
import { ownerApprovalSignature } from "../../src/shared/model/ownerApprovalSignature";
import { ApprovalRegistry, APPROVAL_KEEP_MS } from "./approval-registry";

const DESKTOP = "desktop-hash";
const PHONE = "phone-hash";

async function entry(id: string, over: Partial<ApprovalMirrorEntry> = {}, at = 1_000) {
  const base = {
    id,
    title: `Title ${id}`,
    message: "Approve this exact operation",
    confirmLabel: "Approve",
    cancelLabel: "Cancel",
    deadline: at + 240_000,
    remote: true,
    ...over,
  };
  return { ...base, signature: await ownerApprovalSignature(base) } as ApprovalMirrorEntry;
}

function setup() {
  let now = 1_000;
  const registry = new ApprovalRegistry(() => now);
  registry.noteDesktop(DESKTOP);
  return {
    registry,
    advance: (ms: number) => {
      now += ms;
      registry.noteDesktop(DESKTOP);
    },
  };
}

describe("approval registry", () => {
  it("lets only the desktop principal mirror or read decisions", async () => {
    const { registry } = setup();
    const item = await entry("a");
    await expect(registry.mirror(PHONE, { upsert: [item], remove: [] })).rejects.toThrow(
      /desktop app/,
    );
    expect(() => registry.decisions(PHONE)).toThrow(/desktop app/);
    await registry.mirror(DESKTOP, { upsert: [item], remove: [] });
    expect(registry.list().map((view) => view.id)).toEqual(["a"]);
  });

  it("stops recognizing a desktop that went quiet", () => {
    let now = 1_000;
    const registry = new ApprovalRegistry(() => now);
    registry.noteDesktop(DESKTOP);
    expect(registry.isDesktop(DESKTOP)).toBe(true);
    expect(registry.isDesktop(PHONE)).toBe(false);
    now += 31_000;
    expect(registry.isDesktop(DESKTOP)).toBe(false);
  });

  it("rejects a mirrored entry whose signature does not match its content", async () => {
    const { registry } = setup();
    const item = { ...(await entry("a")), message: "Something else entirely" };
    await expect(registry.mirror(DESKTOP, { upsert: [item], remove: [] })).resolves.toEqual({
      accepted: 0,
    });
    expect(registry.list()).toEqual([]);
  });

  it("keeps the first mirrored content for an id", async () => {
    const { registry } = setup();
    const first = await entry("a");
    await registry.mirror(DESKTOP, { upsert: [first], remove: [] });
    const changed = await entry("a", { message: "Different operation" });
    await registry.mirror(DESKTOP, { upsert: [changed], remove: [] });
    expect(registry.list()[0].message).toBe(first.message);
  });

  it("bounds pending approvals at 24", async () => {
    const { registry } = setup();
    const upsert = await Promise.all(Array.from({ length: 24 }, (_, i) => entry(`a${i}`)));
    await registry.mirror(DESKTOP, { upsert, remove: [] });
    await registry.mirror(DESKTOP, { upsert: [await entry("extra")], remove: [] });
    expect(registry.list()).toHaveLength(24);
  });

  it("decides a remote approval and the first decision wins", async () => {
    const { registry } = setup();
    const item = await entry("a");
    await registry.mirror(DESKTOP, { upsert: [item], remove: [] });
    expect(registry.decide({ id: "a", signature: item.signature, approved: true })).toEqual({
      id: "a",
      status: "approved",
      approved: true,
      alreadyDecided: false,
    });
    expect(registry.decide({ id: "a", signature: item.signature, approved: false })).toEqual({
      id: "a",
      status: "approved",
      approved: true,
      alreadyDecided: true,
    });
    expect(registry.decisions(DESKTOP)).toEqual([
      { id: "a", signature: item.signature, approved: true },
    ]);
  });

  it("rejects missing, not-remote, mismatched and expired decisions", async () => {
    const { registry, advance } = setup();
    const secret = await entry("secret", { remote: false });
    const normal = await entry("normal");
    await registry.mirror(DESKTOP, { upsert: [secret, normal], remove: [] });
    expect(() =>
      registry.decide({ id: "none", signature: normal.signature, approved: true }),
    ).toThrow(/not found/);
    expect(() =>
      registry.decide({ id: "secret", signature: secret.signature, approved: true }),
    ).toThrow(/on the computer/);
    expect(() =>
      registry.decide({ id: "normal", signature: "0".repeat(64), approved: true }),
    ).toThrow(/changed/);
    expect(registry.decisions(DESKTOP)).toEqual([]);
    advance(240_001);
    expect(() =>
      registry.decide({ id: "normal", signature: normal.signature, approved: true }),
    ).toThrow(/expired/);
  });

  it("rejects a retry with a different signature after a decision", async () => {
    const { registry } = setup();
    const item = await entry("a");
    await registry.mirror(DESKTOP, { upsert: [item], remove: [] });
    registry.decide({ id: "a", signature: item.signature, approved: true });
    expect(() => registry.decide({ id: "a", signature: "f".repeat(64), approved: false })).toThrow(
      /changed/,
    );
  });

  it("records an expired entry when the dialog ends without an answer", async () => {
    const { registry } = setup();
    const item = await entry("a");
    await registry.mirror(DESKTOP, { upsert: [item], remove: [] });
    await registry.mirror(DESKTOP, { upsert: [], remove: [{ id: "a", outcome: "ended" }] });
    const [view] = registry.list();
    expect(view.status).toBe("expired");
    expect(view.notice).toBe("Approval expired: Title a. Ask the assistant to try again.");
  });

  it("expires a pending approval at its deadline and drops it after 24 hours", async () => {
    const { registry, advance } = setup();
    const item = await entry("a");
    await registry.mirror(DESKTOP, { upsert: [item], remove: [] });
    advance(240_000);
    expect(registry.list()[0].status).toBe("expired");
    advance(APPROVAL_KEEP_MS + 1);
    expect(registry.list()).toEqual([]);
  });

  it("expires a phone answer the desktop never applied", async () => {
    const { registry, advance } = setup();
    const item = await entry("a");
    await registry.mirror(DESKTOP, { upsert: [item], remove: [] });
    registry.decide({ id: "a", signature: item.signature, approved: true });
    advance(240_000);
    expect(registry.decisions(DESKTOP)).toEqual([]);
    expect(registry.list()[0].status).toBe("expired");
  });

  it("keeps the phone answer once the desktop applied it", async () => {
    const { registry } = setup();
    const item = await entry("a");
    await registry.mirror(DESKTOP, { upsert: [item], remove: [] });
    registry.decide({ id: "a", signature: item.signature, approved: false });
    await registry.mirror(DESKTOP, {
      upsert: [],
      remove: [{ id: "a", outcome: "answered", approved: false }],
    });
    expect(registry.decisions(DESKTOP)).toEqual([]);
    expect(registry.list()[0]).toMatchObject({ status: "denied", decidedBy: "phone" });
  });

  it("records an answer given on the computer", async () => {
    const { registry } = setup();
    const item = await entry("a");
    await registry.mirror(DESKTOP, { upsert: [item], remove: [] });
    await registry.mirror(DESKTOP, {
      upsert: [],
      remove: [{ id: "a", outcome: "answered", approved: true }],
    });
    expect(registry.list()[0]).toMatchObject({ status: "approved", decidedBy: "desktop" });
  });

  it("offers each remote approval for a push once", async () => {
    const { registry } = setup();
    await registry.mirror(DESKTOP, {
      upsert: [await entry("a"), await entry("b", { remote: false })],
      remove: [],
    });
    expect(registry.unpushed().map((view) => view.id)).toEqual(["a"]);
    registry.markPushed("a");
    expect(registry.unpushed()).toEqual([]);
  });
});
