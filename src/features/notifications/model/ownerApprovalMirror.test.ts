import { afterEach, describe, expect, it, vi } from "vitest";
import { ownerApprovalSignature } from "../../../shared/model/ownerApprovalSignature";
import { startOwnerApprovalMirror } from "./ownerApprovalMirror";
import { isRemoteApproval } from "./ownerApprovalRemote";
import {
  abandonOwnerApproval,
  onOwnerApprovalOutcome,
  ownerApprovalsSnapshot,
  requestOwnerApproval,
  settleOwnerApproval,
  subscribeOwnerApprovals,
} from "./ownerApprovals";

const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  for (const request of ownerApprovalsSnapshot()) abandonOwnerApproval(request.id);
});

const input = (title = "bycoda — Application operation approval") => ({
  title,
  message: "Approve this exact operation",
  confirmLabel: "Approve",
  cancelLabel: "Cancel",
  deadline: Date.now() + 200_000,
});

let sequence = 0;
/** Ids are unique per call because settled ids stay remembered for the whole run. */
function ask(name: string, title?: string, action = "owner.approval") {
  const id = `${name}-${(sequence += 1)}`;
  const answer = requestOwnerApproval({ id, action, input: input(title) });
  answer.catch(() => undefined);
  return Object.assign(answer, { id });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function start(decisions: () => { id: string; signature: string; approved: boolean }[]) {
  const calls: { method: string; params: any }[] = [];
  let tick: () => void = () => undefined;
  const stop = startOwnerApprovalMirror({
    request: async (method, params) => {
      calls.push({ method, params });
      return (method === "approvals.decisions" ? { decisions: decisions() } : {}) as never;
    },
    approvals: ownerApprovalsSnapshot,
    subscribe: subscribeOwnerApprovals,
    onOutcome: onOwnerApprovalOutcome,
    settle: settleOwnerApproval,
    setTimer: (run) => {
      tick = run;
      return () => undefined;
    },
  });
  stops.push(stop);
  return { calls, tick: () => tick() };
}

describe("owner approval classification", () => {
  it("keeps secrets and desktop input on the computer", () => {
    const title = "bycoda — Application operation approval";
    expect(isRemoteApproval({ action: "owner.approval", title, message: "m" })).toBe(true);
    expect(isRemoteApproval({ action: "owner.secret", title, message: "m" })).toBe(false);
    expect(
      isRemoteApproval({
        action: "owner.approval",
        title: "bycoda — Desktop action approval",
        message: "Click Save",
      }),
    ).toBe(false);
    expect(isRemoteApproval({ action: "something.new", title, message: "m" })).toBe(false);
    expect(
      isRemoteApproval({ action: "owner.approval", title: "bycoda — New dialog", message: "m" }),
    ).toBe(false);
    expect(isRemoteApproval({ title, message: "x".repeat(20_001) })).toBe(false);
  });

  it("marks the request and exposes it for the mirror", async () => {
    void ask("normal");
    void ask("desktop", "bycoda — Desktop action approval");
    const [normal, desktop] = ownerApprovalsSnapshot();
    expect(normal).toMatchObject({ remote: true, action: "owner.approval" });
    expect(desktop.remote).toBe(false);
  });
});

describe("owner approval mirror", () => {
  it("publishes pending approvals, including display-only ones, with a signature", async () => {
    const a = ask("a");
    const b = ask("b", "bycoda — Desktop action approval");
    const { calls } = start(() => []);
    await flush();
    const mirror = calls.find((call) => call.method === "approvals.mirror");
    expect(
      mirror?.params.upsert.map((entry: { id: string; remote: boolean }) => [
        entry.id,
        entry.remote,
      ]),
    ).toEqual([
      [a.id, true],
      [b.id, false],
    ]);
    expect(mirror?.params.upsert[0].signature).toBe(
      await ownerApprovalSignature(ownerApprovalsSnapshot()[0]),
    );
  });

  it("applies a phone decision only when the local approval matches", async () => {
    const pending = ask("a");
    const [local] = ownerApprovalsSnapshot();
    const good = await ownerApprovalSignature(local);
    let decisions = [{ id: pending.id, signature: "0".repeat(64), approved: true }];
    const { tick } = start(() => decisions);
    await flush();
    tick();
    await flush();
    expect(ownerApprovalsSnapshot()).toHaveLength(1);
    decisions = [
      { id: "unknown", signature: good, approved: true },
      { id: pending.id, signature: good, approved: true },
    ];
    tick();
    await flush();
    await expect(pending).resolves.toBe(true);
    expect(ownerApprovalsSnapshot()).toHaveLength(0);
  });

  it("never settles a desktop-input approval from a phone answer", async () => {
    const pending = ask("desk", "bycoda — Desktop action approval");
    const settled = vi.fn();
    pending.then(settled, () => undefined);
    const [local] = ownerApprovalsSnapshot();
    const signature = await ownerApprovalSignature(local);
    const { tick } = start(() => [{ id: pending.id, signature, approved: true }]);
    await flush();
    tick();
    await flush();
    expect(settled).not.toHaveBeenCalled();
    expect(ownerApprovalsSnapshot()).toHaveLength(1);
  });

  it("reports answered and unanswered ends to the Host", async () => {
    const a = ask("a");
    const b = ask("b");
    const { calls } = start(() => []);
    await flush();
    settleOwnerApproval(a.id, true);
    await flush();
    abandonOwnerApproval(b.id);
    await flush();
    const removed = calls
      .filter((call) => call.method === "approvals.mirror")
      .flatMap((call) => call.params.remove);
    expect(removed).toEqual([
      { id: a.id, outcome: "answered", approved: true },
      { id: b.id, outcome: "ended" },
    ]);
  });
});
