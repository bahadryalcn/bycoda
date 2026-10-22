// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
import {
  abandonMissingSshRunbookStart,
  sshRunbookDraft,
  sshRunbookFromDraft,
  sameSshRunbook,
  sshRunActive,
  listSshRunbooks,
  saveSshRunbook,
  removeSshRunbook,
  reviewSshRunbook,
  startSshRunbook,
  statusSshRunbook,
  cancelSshRunbook,
  type SshRunbook,
} from "./sshRunbooks";
afterEach(() => vi.clearAllMocks());
const profile: SshRunbook = {
  id: "book-1",
  name: "Inspect",
  revision: 2,
  script: "printf '%s' '$HOME'\npwd",
  shell: "posix",
  targetIds: ["server-1"],
  limits: { concurrency: 1, timeoutSeconds: 60 },
};
it("preserves revision, exact multiline script, limits and independent target drafts", () => {
  const draft = sshRunbookDraft(profile);
  expect(sshRunbookFromDraft(draft)).toEqual(profile);
  draft.targetIds.push("other");
  expect(profile.targetIds).toEqual(["server-1"]);
  const created = sshRunbookDraft(undefined, "server-1");
  expect(created.revision).toBe(0);
  expect(created.id).toMatch(/^[a-f0-9-]+$/);
  expect(sameSshRunbook(profile, { limits: profile.limits, ...profile })).toBe(true);
  expect(sameSshRunbook(profile, { ...profile, script: profile.script + " " })).toBe(false);
});
it("bounds scripts, unique targets, concurrency and timeouts without evaluating literals", () => {
  for (const patch of [
    { targetIds: [] },
    { targetIds: ["x", "x"] },
    { targetIds: Array.from({ length: 17 }, (_, i) => `x${i}`) },
    { concurrency: "5" },
    { concurrency: "1.5" },
    { timeoutSeconds: "0" },
    { timeoutSeconds: "86401" },
    { script: "echo \u0000" },
    { script: "日".repeat(22000) },
    { script: "-----BEGIN OPENSSH PRIVATE KEY-----" },
  ])
    expect(sshRunbookFromDraft({ ...sshRunbookDraft(profile), ...patch })).toBeUndefined();
  const full = {
    ...sshRunbookDraft(profile),
    targetIds: Array.from({ length: 16 }, (_, i) => `server:${i}`),
    concurrency: "4",
    timeoutSeconds: "86400",
  };
  expect(sshRunbookFromDraft(full)?.script).toBe(profile.script);
});
it("uses exact canonical native CAS/review/run IDs and never starts through list/save/status", async () => {
  await listSshRunbooks();
  await saveSshRunbook(profile, 2);
  await removeSshRunbook(profile.id, 2);
  await reviewSshRunbook(profile.id, 2);
  await statusSshRunbook("run-id");
  expect(native.invoke.mock.calls.map(([name]) => name)).not.toContain("ssh_runbook_start");
  await startSshRunbook(profile.id, 2, "ticket", "run-id");
  await cancelSshRunbook("run-id", "server-1");
  await cancelSshRunbook("run-id");
  expect(native.invoke).toHaveBeenCalledWith("ssh_runbook_save", { profile, expectedRevision: 2 });
  expect(native.invoke).toHaveBeenCalledWith("ssh_runbook_start", {
    automationId: profile.id,
    expectedRevision: 2,
    reviewId: "ticket",
    runId: "run-id",
  });
  expect(native.invoke).toHaveBeenCalledWith("ssh_runbook_cancel", {
    runId: "run-id",
    serverId: "server-1",
  });
  expect(native.invoke).toHaveBeenLastCalledWith("ssh_runbook_cancel", { runId: "run-id" });
});
it("regards unknown/recovered outcomes as terminal status and never as a runnable ticket", () => {
  const status = {
    runId: "run",
    automationId: "book",
    revision: 1,
    owner: "main",
    digest: "x",
    targets: [{ serverId: "s", state: "unknown" as const, exitCode: null, reason: "recovered" }],
  };
  expect(sshRunActive(status)).toBe(false);
  expect(sshRunActive({ ...status, targets: [{ ...status.targets[0], state: "running" }] })).toBe(
    true,
  );
});

it("retains schedule/startup scope in revision comparisons and validates target membership", () => {
  const scheduled = {
    ...profile,
    triggers: { startupServerIds: ["server-1"], intervalMinutes: 15, nextRunAt: 12345 },
  };
  expect(sshRunbookFromDraft(sshRunbookDraft(scheduled))).toEqual(scheduled);
  expect(
    sameSshRunbook(scheduled, {
      ...scheduled,
      triggers: { ...scheduled.triggers, intervalMinutes: 16 },
    }),
  ).toBe(false);
  for (const intervalMinutes of ["0", "525601", "1.5", "bad"])
    expect(sshRunbookFromDraft({ ...sshRunbookDraft(scheduled), intervalMinutes })).toBeUndefined();
  expect(
    sshRunbookFromDraft({
      ...sshRunbookDraft(scheduled),
      triggers: { startupServerIds: ["foreign"] },
    }),
  ).toBeUndefined();
});

it("abandons only the exact original attempt through the durable native boundary", async () => {
  await abandonMissingSshRunbookStart("run-origin", "book-original", 2);
  expect(native.invoke).toHaveBeenCalledExactlyOnceWith("ssh_runbook_abandon_missing", {
    runId: "run-origin",
    automationId: "book-original",
    revision: 2,
  });
});
