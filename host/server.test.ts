import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { request } from "node:http";
import { HostEngine } from "./engine";
import { HostStore } from "./store";
import { createHostServer } from "./server";
import { BrowserRuntime } from "./browser-runtime";
import { DeviceHost } from "./device-host";
import * as expoGo from "./expo-go";
import { RuntimeLogsService } from "./runtime-logs";
import { HostChildBackend } from "./child-backend";
import { HostTasks } from "./tasks";
import { HostGoals } from "./goals";
import { DesktopSessions } from "./desktopSessions";
import { HostNotes } from "./host-notes";
import { GenericAcpService } from "./generic-acp";
import * as accessCenter from "./access-center";
import { ConversationDesktopRelay } from "./conversation-tools";
import { DevicePreviews } from "./device-preview";
import { ProviderInboxBridge } from "./provider-inbox";
import { VoiceSetupService } from "./voice-setup";
import { LocalVoiceService } from "./voice-local";
import { configureChildBackend } from "../src/integrations/harness/core/child";
import type { SendTurnInput } from "../src/integrations/harness/core/types";
import type { RemoteProvider } from "../src/features/connections/model/protocol";
import { QUEUE_LEASE_TTL_MS } from "../src/features/connections/model/sharedQueue";
import { RUN_LEASE_TTL_MS } from "../src/features/sync/model/runLease";
import { CLAIM_GRACE_MS, SessionQueues } from "./session-queue";

const modelProbe = vi.hoisted(() => vi.fn());
vi.mock("../src/integrations/harness/providers/codex/codexCatalog", () => ({
  discoverCodexModels: modelProbe,
  refreshCodexCatalog: async () => {},
}));
// Catalog tests point the host at a stand-in provider CLI.
const binaries: { codex?: string } = {};
configureChildBackend(new HostChildBackend(binaries));

const cleanups: Array<() => Promise<void>> = [];

it("requires the dedicated review confirmation before queuing an exact PR review", async () => {
  const s = await setup([]);
  const request = vi.spyOn(ProviderInboxBridge.prototype, "request").mockReturnValue({ id: "job", state: "queued" });
  try {
    const input = { action: "review", projectId: s.project.id, requestId: "review-rpc", item: { provider: "github", kind: "pr", number: 7, repo: "owner/project", projectPath: s.project.cwd }, commitId: "a".repeat(40), event: "COMMENT", body: "Reviewed summary", comments: [] };
    expect((await s.call("inbox.provider.request", { ...input, confirm: "CHANGE_PR_STATE" })).value.error).toMatch(/explicit owner/);
    expect(request).not.toHaveBeenCalled();
    expect((await s.call("inbox.provider.request", { ...input, confirm: "SUBMIT_PR_REVIEW" }, "invalid")).status).toBe(401);
    expect((await s.call("inbox.provider.request", { ...input, confirm: "SUBMIT_PR_REVIEW" })).value.result).toEqual({ id: "job", state: "queued" });
    expect(request).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9]{64}$/), "review-rpc", expect.objectContaining({ action: "review", commitId: "a".repeat(40), body: "Reviewed summary", cwd: s.project.cwd }));
    expect(s.send).not.toHaveBeenCalled();
  } finally { request.mockRestore(); }
});

it("requires a dedicated owner confirmation and derives project identity for Jira board writes", async () => {
  const s = await setup([]);
  expect((await s.call("environment.describe")).value.result.capabilities).toContain("inbox.jiraBoard.v1");
  const request = vi.spyOn(ProviderInboxBridge.prototype, "request").mockReturnValue({ id: "job", state: "queued" });
  try {
    const input = { action: "jira-board-transition", projectId: s.project.id, requestId: "jira-rpc", snapshotId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", key: "ENG-7", transitionId: "9" };
    expect((await s.call("inbox.provider.request", { ...input, confirm: "CHANGE_PR_STATE" })).value.error).toMatch(/explicit owner/);
    expect(request).not.toHaveBeenCalled();
    expect((await s.call("inbox.provider.request", { ...input, confirm: "CHANGE_JIRA_BOARD" }, "invalid")).status).toBe(401);
    expect((await s.call("inbox.provider.request", { ...input, confirm: "CHANGE_JIRA_BOARD" })).value.result).toEqual({ id: "job", state: "queued" });
    expect(request).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9]{64}$/), "jira-rpc", { action: "jira-board-transition", cwd: s.project.cwd, snapshotId: input.snapshotId, key: "ENG-7", transitionId: "9" });
    expect((await s.call("inbox.provider.request", { ...input, projectId: "foreign", confirm: "CHANGE_JIRA_BOARD" })).value.error).toBeTruthy();
    expect((await s.call("inbox.provider.request", { ...input, cwd: "/foreign", confirm: "CHANGE_JIRA_BOARD" })).value.error).toBeTruthy();
    expect(request).toHaveBeenCalledOnce();
    expect(s.send).not.toHaveBeenCalled();
  } finally { request.mockRestore(); }
});

it("derives mobile preview ownership from the paired credential and project and guards service stop", async () => {
  const s = await setup([]);
  const job = { id: "job-id", requestId: "attempt", deviceId: "device", state: "running" as const, stages: [], verification: "launch-only" as const, updatedAt: new Date().toISOString() };
  let owner = "";
  const start = vi.spyOn(DevicePreviews.prototype, "start").mockImplementation((_input, currentOwner) => { owner = currentOwner; return job; });
  const status = vi.spyOn(DevicePreviews.prototype, "mobileStatus").mockImplementation((currentOwner) => { if (currentOwner !== owner) throw new Error("PREVIEW_NOT_FOUND"); return job; });
  const impact = vi.spyOn(DevicePreviews.prototype, "stopImpact").mockReturnValue({ activeCount: 1, owned: [], otherActiveCount: 1 });
  const stop = vi.spyOn(DeviceHost.prototype, "stop").mockResolvedValue({ running: false, installed: true, agentInstalled: false, platform: "win32", platforms: [] });
  const idle = vi.spyOn(DevicePreviews.prototype, "stopIdle").mockRejectedValue(new Error("PREVIEW_BUSY"));
  try {
    const scope = { projectId: s.project.id };
    const input = { ...scope, requestId: "attempt", deviceId: "device", url: "exp://127.0.0.1:8081" };
    expect((await s.call("devices.preview.mobile.start", input)).value.result.id).toBe(job.id);
    expect(owner).toMatch(new RegExp(`^mobile:[a-f0-9]{64}:${s.project.id}$`));
    expect(owner).not.toContain(s.first.token);
    expect((await s.call("devices.preview.mobile.status", { ...scope, requestId: "attempt" })).value.result.id).toBe(job.id);
    expect((await s.call("devices.preview.mobile.status", { ...scope, requestId: "attempt" }, s.second.token)).value.error).toContain("PREVIEW_NOT_FOUND");
    const other = s.store.addProject(join(s.directory, "other"), "Other");
    expect((await s.call("devices.preview.mobile.status", { projectId: other.id, requestId: "attempt" })).value.error).toContain("PREVIEW_NOT_FOUND");
    expect((await s.call("devices.preview.mobile.start", { ...input, previewOwner: owner })).value.error).toBeTruthy();
    expect((await s.call("devices.preview.mobile.start", input, "invalid")).status).toBe(401);
    expect(start).toHaveBeenCalledOnce();
    expect((await s.call("devices.preview.impact", scope)).value.result).toEqual({ activeCount: 1, owned: [], otherActiveCount: 1 });
    expect((await s.call("devices.stop", scope)).value.error).toContain("PREVIEW_BUSY");
    expect(idle).toHaveBeenCalledOnce(); expect(stop).not.toHaveBeenCalled();
    expect(s.send).not.toHaveBeenCalled();
  } finally { start.mockRestore(); status.mockRestore(); impact.mockRestore(); stop.mockRestore(); idle.mockRestore(); }
});

it("routes history import only through the authenticated desktop owner with frozen project and conversation identity", async () => {
  const s = await setup();
  expect((await s.call("environment.describe")).value.result.capabilities).toContain("history.import.desktop.v1");
  const created = s.engine.command({ type: "create", commandId: "history-rpc-source", projectId: s.project.id, harness: "codex", model: "codex:test", runtimeMode: "supervised" });
  const source = s.store.session(created.sessionId);
  const relay = vi.spyOn(ConversationDesktopRelay.prototype, "call").mockResolvedValue({ state: "unknown" });
  try {
    const scope = { projectId: s.project.id, sessionId: created.sessionId };
    expect((await s.call("history.import.preview", scope)).value.error).toBeUndefined();
    expect(relay).toHaveBeenLastCalledWith("historyImport.discover", { sessionId: created.sessionId }, s.project.cwd,
      { kind: "session", projectId: s.project.id, sessionId: created.sessionId, provider: "codex" }, expect.any(Function));
    expect(s.store.session(created.sessionId)).toEqual(source);
    expect((await s.call("history.import.status", { ...scope, operationId: "attempt" })).value.result).toEqual({ state: "unknown" });
    expect(relay.mock.calls.at(-1)?.[0]).toBe("historyImport.status");
    const authorize = relay.mock.calls.at(-1)![4]!;
    expect(authorize()).toBe(true);
    expect((await s.call("history.import.preview", { ...scope, projectId: "foreign" })).value.error).toBeTruthy();
    expect((await s.call("history.import.preview", { ...scope, projectCwd: "/foreign" })).value.error).toBeTruthy();
    expect((await s.call("history.import.commit", scope, "invalid")).status).toBe(401);
    expect(relay).toHaveBeenCalledTimes(2);
    s.store.revokeToken(s.first.token); expect(authorize()).toBe(false);
    expect(s.send).not.toHaveBeenCalled();
  } finally { relay.mockRestore(); }
});

it("routes history import to the registered source worktree and refuses unrelated checkouts", async () => {
  const s = await setup();
  const git = (...args: string[]) => execFileSync("git", args, { cwd: s.project.cwd });
  git("init", "-q");
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-qm", "initial");
  const checkout = join(s.directory, "history-worktree");
  git("worktree", "add", "-qb", "history-source", checkout);
  const opened = await s.call("commands.dispatch", {
    type: "create", commandId: "history-worktree-source", projectId: s.project.id,
    worktreeCwd: checkout, harness: "codex", model: "codex:test", runtimeMode: "supervised",
  });
  expect(opened.value.error).toBeUndefined();
  const relay = vi.spyOn(ConversationDesktopRelay.prototype, "call").mockResolvedValue({ state: "unknown" });
  try {
    const scope = { projectId: s.project.id, sessionId: opened.value.result.sessionId };
    expect((await s.call("history.import.preview", scope)).value.error).toBeUndefined();
    expect(relay.mock.calls[0][2].replaceAll("\\", "/")).toBe(realpathSync.native(checkout).replaceAll("\\", "/"));
    expect(relay.mock.calls[0][4]!()).toBe(true);
    expect((await s.call("history.import.preview", { ...scope, cwd: s.project.cwd })).value.error).toBeTruthy();
    expect((await s.call("commands.dispatch", {
      type: "create", commandId: "unrelated-history-source", projectId: s.project.id,
      worktreeCwd: tmpdir(), harness: "codex", model: "codex:test", runtimeMode: "supervised",
    })).value.error).toContain("available worktree");
    expect(relay).toHaveBeenCalledOnce();
    expect(s.send).not.toHaveBeenCalled();
  } finally { relay.mockRestore(); }
});

it("binds organization metadata operations to the authenticated owning conversation", async () => {
  const s = await setup();
  expect((await s.call("environment.describe")).value.result.capabilities).toContain("projects.organization.desktop.v1");
  const created = s.engine.command({ type: "create", commandId: "organization-source", projectId: s.project.id, harness: "codex", model: "codex:test", runtimeMode: "supervised" });
  const relay = vi.spyOn(ConversationDesktopRelay.prototype, "call").mockResolvedValue({ state: "unknown" });
  const scope = { projectId: s.project.id, sessionId: created.sessionId };
  try {
    expect((await s.call("projects.organization.read", scope)).value.error).toBeUndefined();
    const change = { kind: "projectName", name: "Reviewed" };
    const patch = { ...scope, expectedRevision: "a".repeat(64), operationId: "attempt", change };
    expect((await s.call("projects.organization.patch", patch)).value.error).toBeUndefined();
    expect(relay).toHaveBeenLastCalledWith("organization.patch", { sessionId: scope.sessionId, expectedRevision: patch.expectedRevision, operationId: "attempt", change }, s.project.cwd,
      { kind: "session", projectId: s.project.id, sessionId: scope.sessionId, provider: "codex" }, expect.any(Function));
    const authorize = relay.mock.calls.at(-1)![4]!;
    expect(authorize()).toBe(true);
    expect((await s.call("projects.organization.patch", patch, "invalid")).status).toBe(401);
    expect((await s.call("projects.organization.read", { ...scope, projectId: "foreign" })).value.error).toBeTruthy();
    expect((await s.call("projects.organization.patch", { ...patch, cwd: "/foreign" })).value.error).toBeTruthy();
    expect(relay).toHaveBeenCalledTimes(2);
    s.store.revokeToken(s.first.token); expect(authorize()).toBe(false);
    expect(s.send).not.toHaveBeenCalled();
  } finally { relay.mockRestore(); }
});

it("keeps new canonical desktop preference, provider and worktree facades finite and scoped", async () => {
  const s = await setup([]);
  const capabilities = (await s.call("environment.describe")).value.result.capabilities;
  for (const capability of ["preferences.desktop.v1", "providers.desktop.v1", "worktrees.removal.desktop.v1"])
    expect(capabilities).toContain(capability);
  const created = s.engine.command({ type: "create", commandId: "desktop-settings-source", projectId: s.project.id, harness: "codex", model: "codex:test", runtimeMode: "supervised" });
  const scope = { projectId: s.project.id, sessionId: created.sessionId };
  const relay = vi.spyOn(ConversationDesktopRelay.prototype, "call").mockImplementation(async (action, args) => ({ state: "unknown",
    ...(action === "providerManagement.patch" || action === "providerManagement.status" ? { operationId: args.operationId } : {}) }));
  const routes = [
    ["preferences.desktop.read", "preferences.read", {}],
    ["preferences.desktop.template.read", "preferences.templateRead", { templateId: "snippet", expectedRevision: "a".repeat(64) }],
    ["preferences.desktop.status", "preferences.status", { operationId: "attempt" }],
    ["preferences.desktop.patch", "preferences.patch", { operationId: "attempt", expectedRevision: "a".repeat(64), change: { kind: "templateDelete", templateId: "snippet" } }],
    ["providers.desktop.read", "providerManagement.read", {}],
    ["providers.desktop.status", "providerManagement.status", { operationId: "account-operation" }],
    ["providers.desktop.patch", "providerManagement.patch", { operationId: "account-operation", expectedAccountRevision: "a".repeat(64), provider: "codex", accountId: "default", change: { kind: "default", confirm: "DEFAULT_FOR_FUTURE_SESSIONS" } }],
  ] as const;
  try {
    for (const [method, action, fields] of routes) {
      const input = { ...scope, ...fields };
      expect((await s.call(method, input, "invalid")).status).toBe(401);
      expect((await s.call(method, { ...input, cwd: "/injected", command: "unsafe" })).value.error).toBeTruthy();
      const actorScoped = action === "providerManagement.patch" || action === "providerManagement.status";
      expect((await s.call(method, input)).value.result).toEqual({ state: "unknown", ...(actorScoped ? { operationId: (fields as Record<string, unknown>).operationId } : {}) });
      expect(relay).toHaveBeenLastCalledWith(action, { sessionId: scope.sessionId, ...fields, ...(actorScoped ? { operationId: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) } : {}) }, s.project.cwd,
        { kind: "session", projectId: s.project.id, sessionId: scope.sessionId, provider: "codex" }, expect.any(Function));
    }
    expect(relay).toHaveBeenCalledTimes(routes.length);
    expect(s.send).not.toHaveBeenCalled();
  } finally { relay.mockRestore(); }
});

it("binds a native worktree review and status receipt to its paired device without exposing the host signing key", async () => {
  const s = await setup([]);
  const created = s.engine.command({ type: "create", commandId: "worktree-device-source", projectId: s.project.id, harness: "codex", model: "codex:test", runtimeMode: "supervised" });
  const scope = { projectId: s.project.id, sessionId: created.sessionId };
  const nativeId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const expiresAt = Date.now() + 120_000;
  const path = join(s.project.cwd, "checkout");
  const receipts = new Map<string, unknown>();
  const relay = vi.spyOn(ConversationDesktopRelay.prototype, "call").mockImplementation(async (action, args) => {
    if (action === "worktrees.removal.review") return { reviewId: nativeId, expiresAt, path };
    if (action === "worktrees.removal.approve") {
      expect(args.reviewId).toBe(nativeId);
      receipts.set(String(args.requestId), { state: "applied", path });
    }
    return receipts.get(String(args.requestId)) ?? { state: "unknown" };
  });
  try {
    const reviewed = (await s.call("worktrees.removal.review", { ...scope, path })).value.result;
    expect(reviewed.reviewId).not.toBe(nativeId);
    expect(reviewed.reviewId.length).toBeLessThanOrEqual(200);
    const input = { ...scope, reviewId: reviewed.reviewId, requestId: "phone-operation" };
    expect((await s.call("worktrees.removal.approve", input, s.second.token)).value.error).toMatch(/does not belong/);
    const actorHash = createHash("sha256").update(s.second.token).digest("hex");
    const forgedMac = createHmac("sha256", s.second.token).update(JSON.stringify(["bycoda:worktree-removal:v1", actorHash, s.store.environmentId, scope.projectId, scope.sessionId, "review", nativeId, expiresAt])).digest("base64url");
    const forged = `v1.${nativeId}.${expiresAt}.${forgedMac}`;
    expect((await s.call("worktrees.removal.approve", { ...input, reviewId: forged }, s.second.token)).value.error).toMatch(/does not belong/);
    expect((await s.call("worktrees.removal.approve", { ...input, reviewId: nativeId })).value.error).toBeTruthy();
    expect(relay).toHaveBeenCalledOnce();
    expect((await s.call("worktrees.removal.approve", input)).value.result).toEqual({ state: "applied", path });
    const firstNativeRequest = relay.mock.calls.at(-1)![1].requestId;
    expect(firstNativeRequest).not.toBe("phone-operation");
    expect((await s.call("worktrees.removal.status", { ...scope, requestId: "phone-operation" })).value.result).toEqual({ state: "applied", path });
    expect((await s.call("worktrees.removal.status", { ...scope, requestId: "phone-operation" }, s.second.token)).value.result).toEqual({ state: "unknown" });
    expect(relay.mock.calls.at(-1)![1].requestId).not.toBe(firstNativeRequest);
    expect(JSON.stringify(reviewed)).not.toContain(s.first.token);
    expect(s.send).not.toHaveBeenCalled();
  } finally { relay.mockRestore(); }
});

it("isolates SSH approvals, workspace handles and uncertain receipts per actor and source", async () => {
  const s = await setup([]);
  const created = s.engine.command({ type: "create", commandId: "ssh-owned-source", projectId: s.project.id, harness: "codex", model: "codex:test", runtimeMode: "supervised" });
  const scope = { projectId: s.project.id, sessionId: created.sessionId };
  const reviewId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const workspaceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const receipts = new Map<string, unknown>();
  const relay = vi.spyOn(ConversationDesktopRelay.prototype, "call").mockImplementation(async (action, args) => {
    expect(args.actorId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    if (action === "ssh.workspace.review" || action === "ssh.workspace.close.review") return { reviewId, expiresAt: Date.now() + 60_000, ...(action.includes("close") ? { workspaceId } : {}) };
    if (action === "ssh.workspace.approve") {
      expect(args.reviewId).toBe(reviewId);
      receipts.set(String(args.actorId) + args.requestId, { state: "opening", workspaceId });
    }
    if (args.workspaceId) { expect(args.workspaceId).toBe(workspaceId); return { state: "opened-on-computer", workspaceId }; }
    return receipts.get(String(args.actorId) + args.requestId) ?? { state: "unknown" };
  });
  try {
    expect((await s.call("ssh.workspace.review", { ...scope, connectionId: "saved" }, "invalid")).status).toBe(401);
    const review = (await s.call("ssh.workspace.review", { ...scope, connectionId: "saved" })).value.result;
    const approve = { ...scope, reviewId: review.reviewId, requestId: "one-open" };
    expect((await s.call("ssh.workspace.approve", approve, s.second.token)).value.error).toBeTruthy();
    expect((await s.call("ssh.workspace.approve", { ...approve, actorId: "spoof" })).value.error).toBeTruthy();
    expect(relay).toHaveBeenCalledOnce();
    const opening = (await s.call("ssh.workspace.approve", approve)).value.result;
    expect(opening.workspaceId).not.toBe(workspaceId);
    expect((await s.call("ssh.workspace.status", { ...scope, workspaceId: opening.workspaceId }, s.second.token)).value.error).toBeTruthy();
    expect((await s.call("ssh.workspace.status", { ...scope, requestId: "one-open" }, s.second.token)).value.result).toEqual({ state: "unknown" });
    expect((await s.call("ssh.workspace.status", { ...scope, requestId: "one-open" })).value.result).toEqual(opening);
    expect((await s.call("ssh.workspace.status", { ...scope, workspaceId: opening.workspaceId })).value.result.state).toBe("opened-on-computer");
    expect((await s.call("ssh.workspace.status", { ...scope, workspaceId: opening.workspaceId, requestId: "one-open" })).value.error).toMatch(/exactly one/);
    const close = (await s.call("ssh.workspace.close.review", { ...scope, workspaceId: opening.workspaceId })).value.result;
    expect(close.workspaceId).toBe(opening.workspaceId);
    expect(close.reviewId).not.toBe(reviewId);
    expect(s.send).not.toHaveBeenCalled();
  } finally { relay.mockRestore(); }
});

it("seals fresh owned PTY identifiers by role and injects actor identity only after public validation", async () => {
  const s = await setup([]);
  const created = s.engine.command({ type: "create", commandId: "pty-owned-source", projectId: s.project.id, harness: "codex", model: "codex:test", runtimeMode: "supervised" });
  const scope = { projectId: s.project.id, sessionId: created.sessionId };
  const terminalId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const epoch = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const leaseId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const terminal = { terminalId, epoch, state: "running" };
  let ownerActor: unknown;
  let createRequest: unknown;
  const createdLease = { terminal, leaseId, expiresAt: Date.now() + 30_000 };
  const relay = vi.spyOn(ConversationDesktopRelay.prototype, "call").mockImplementation(async (action, args) => {
    expect(args.actorId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    if (action === "ptyMobile.create") { ownerActor = args.actorId; createRequest = args.requestId; expect(args.requestId).not.toBe("new-pty"); return createdLease; }
    if (action === "ptyMobile.status" && args.requestId) return args.actorId === ownerActor && args.requestId === createRequest ? createdLease : { state: "unknown" };
    if (action === "ptyMobile.list") return { terminals: args.actorId === ownerActor ? [terminal] : [] };
    expect(args.terminalId).toBe(terminalId);
    expect(args.epoch).toBe(epoch);
    if (args.leaseId) expect(args.leaseId).toBe(leaseId);
    if (action === "ptyMobile.read") return { terminalId, epoch, dataBase64: "YQ==", after: 0, next: 1 };
    return { accepted: true };
  });
  try {
    expect((await s.call("terminals.pty.desktop.create", { ...scope, requestId: "new-pty", cols: 80, rows: 24 }, "invalid")).status).toBe(401);
    const lease = (await s.call("terminals.pty.desktop.create", { ...scope, requestId: "new-pty", cols: 80, rows: 24 })).value.result;
    expect(lease.terminal.terminalId).not.toBe(terminalId);
    expect((await s.call("terminals.pty.desktop.status", { ...scope, requestId: "new-pty" })).value.result).toEqual(lease);
    expect((await s.call("terminals.pty.desktop.status", { ...scope, requestId: "new-pty" }, s.second.token)).value.result).toEqual({ state: "unknown" });
    expect((await s.call("terminals.pty.desktop.status", { ...scope, requestId: "new-pty", terminalId: lease.terminal.terminalId })).value.error).toBeTruthy();
    const input = { ...scope, terminalId: lease.terminal.terminalId, epoch: lease.terminal.epoch, leaseId: lease.leaseId, inputSequence: 1, dataBase64: "YQ==" };
    for (const invalid of [{ ...input, actorId: "spoof" }, { ...input, epoch: input.terminalId }, { ...input, terminalId }])
      expect((await s.call("terminals.pty.desktop.write", invalid)).value.error).toBeTruthy();
    expect((await s.call("terminals.pty.desktop.write", input, s.second.token)).value.error).toBeTruthy();
    expect(relay).toHaveBeenCalledTimes(3);
    expect((await s.call("terminals.pty.desktop.write", input)).value.result).toEqual({ accepted: true });
    const listed = (await s.call("terminals.pty.desktop.list", scope)).value.result.terminals;
    expect(listed[0]).toEqual(lease.terminal);
    expect((await s.call("terminals.pty.desktop.list", scope, s.second.token)).value.result.terminals).toEqual([]);
    const read = (await s.call("terminals.pty.desktop.read", { ...scope, terminalId: input.terminalId, epoch: input.epoch, after: 0 })).value.result;
    expect(read.terminalId).toBe(input.terminalId);
    expect(read.dataBase64).toBe("YQ==");
    expect(s.send).not.toHaveBeenCalled();
  } finally { relay.mockRestore(); }
});

it("authenticates exact native pre-effect authority checks without accepting a caller-selected owner", async () => {
  const s = await setup([]);
  const authorize = vi.spyOn(ConversationDesktopRelay.prototype, "authorize").mockReturnValue({ authorized: false });
  try {
    const input = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", action: "ssh.workspace.approve" };
    expect((await s.call("conversation.desktop.authorize", input, "invalid")).status).toBe(401);
    expect((await s.call("conversation.desktop.authorize", { ...input, owner: "foreign" })).value.error).toBeTruthy();
    expect((await s.call("conversation.desktop.authorize", { ...input, action: "ptyMobile.list" })).value.error).toBeTruthy();
    expect(authorize).not.toHaveBeenCalled();
    expect((await s.call("conversation.desktop.authorize", input, s.second.token)).value.result).toEqual({ authorized: false });
    expect(authorize).toHaveBeenCalledWith(input.id, input.action, createHash("sha256").update(s.second.token).digest("hex"));
    for (const action of ["ssh.workspace.close.approve", "ptyMobile.create", "ptyMobile.attach", "ptyMobile.write", "ptyMobile.resize", "ptyMobile.detach", "ptyMobile.close"])
      expect((await s.call("conversation.desktop.authorize", { ...input, action }, s.second.token)).value.result).toEqual({ authorized: false });
    expect(s.send).not.toHaveBeenCalled();
  } finally { authorize.mockRestore(); }
});

it("partitions provider metadata and quota receipts without leaking internal operation identities", async () => {
  const s = await setup([]);
  const created = s.engine.command({ type: "create", commandId: "account-owned-source", projectId: s.project.id, harness: "codex", model: "codex:test", runtimeMode: "supervised" });
  const scope = { projectId: s.project.id, sessionId: created.sessionId };
  const receipts = new Map<string, unknown>();
  const relay = vi.spyOn(ConversationDesktopRelay.prototype, "call").mockImplementation(async (action, args) => {
    expect(args.operationId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    if (action !== "providerManagement.status") receipts.set(String(args.operationId), { state: "applied", operationId: args.operationId, atomic: false });
    return receipts.get(String(args.operationId)) ?? { state: "unknown", operationId: args.operationId, atomic: false };
  });
  try {
    const identity = { ...scope, operationId: "phone-account-op" };
    const patch = { ...identity, expectedAccountRevision: "revision", provider: "claude", accountId: "profile", change: { kind: "rename", label: "Work" } };
    expect((await s.call("providers.desktop.patch", patch, "invalid")).status).toBe(401);
    const applied = { state: "applied", operationId: identity.operationId, atomic: false };
    expect((await s.call("providers.desktop.patch", patch)).value.result).toEqual(applied);
    expect((await s.call("providers.desktop.status", identity)).value.result).toEqual(applied);
    expect((await s.call("providers.desktop.status", identity, s.second.token)).value.result).toEqual({ ...applied, state: "unknown" });
    expect((await s.call("providers.desktop.quota.refresh", { ...identity, operationId: "quota-once", expectedAccountRevision: "revision", provider: "claude", accountId: "profile", confirm: "REFRESH_PROVIDER_QUOTA" })).value.result.operationId).toBe("quota-once");
    expect((await s.call("providers.desktop.patch", { ...patch, cwd: "foreign" })).value.error).toBeTruthy();
    expect(s.send).not.toHaveBeenCalled();
  } finally { relay.mockRestore(); }
});

it("authenticates reviewed social policy updates without enabling sends or creating work", async () => {
  const s = await setup();
  expect((await s.call("environment.describe")).value.result.capabilities).toContain("social.policy.reviewed.v1");
  const expectedPolicies = (await s.call("social.request", { action: "policy.get", input: {} })).value.result;
  const input = { policies: { global: { maxContentCharacters: 200 }, platforms: {} }, expectedPolicies, confirm: "UPDATE_SOCIAL_POLICY" };
  expect((await s.call("social.request", { action: "policy.saveReviewed", input }, "invalid")).status).toBe(401);
  expect((await s.call("social.request", { action: "policy.saveReviewed", input: { ...input, confirm: "SEND" } })).value.error).toMatch(/Confirm/);
  expect((await s.call("social.request", { action: "policy.saveReviewed", input })).value.result).toEqual(input.policies);
  expect((await s.call("social.request", { action: "policy.saveReviewed", input })).value.error).toMatch(/changed/);
  const snapshot = (await s.call("social.request", { action: "snapshot", input: {} })).value.result;
  expect(snapshot.sendingEnabled).toBe(false);
  expect(snapshot.jobs).toEqual([]);
  expect(s.send).not.toHaveBeenCalled();
});

it("validates note context before special-command side effects and sends only an explicit authenticated request", async () => {
  const s = await setup();
  const created = s.engine.command({ type: "create", commandId: "note-rpc-source", projectId: s.project.id, harness: "codex", model: "codex:test", runtimeMode: "supervised" });
  const noteCard = { id: "reviewed-note", slug: "review", title: "Review", body: "Exact note snapshot" };
  const source = s.store.session(created.sessionId);
  const command = { type: "send", commandId: "note-rpc-send", sessionId: created.sessionId, text: "Review this", noteCard };
  expect((await s.call("environment.describe")).value.result.capabilities).toContain("sessions.noteContext.v1");
  expect((await s.call("commands.dispatch", { ...command, text: "/clear" })).value.error).toMatch(/regular message/);
  expect(s.store.session(created.sessionId)).toEqual(source);
  expect((await s.call("commands.dispatch", command, "invalid")).status).toBe(401);
  const response = await s.call("commands.dispatch", command);
  expect(response.value.error).toBeUndefined();
  expect((await s.call("commands.dispatch", command)).value.result).toEqual(response.value.result);
  await vi.waitFor(() => expect(s.send).toHaveBeenCalledOnce());
  expect(s.turn().text).toContain("Exact note snapshot");
  const user = s.store.session(created.sessionId).session.blocks.find((block) => block.id === command.commandId)!;
  expect(user.noteCard).toEqual({ id: "reviewed-note", slug: "review", title: "Review" });
  expect(JSON.stringify(user)).not.toContain("Exact note snapshot");
  s.finish();
});

it("scopes access-center device identity and revocation to authenticated paired devices", async () => {
  const s = await setup([]);
  const descriptor = (await s.call("environment.describe")).value.result;
  expect(descriptor.capabilities).toContain("host.access.read");
  expect(descriptor.capabilities).toContain("devices.revokeOther");
  const read = vi.spyOn(accessCenter, "readHostAccess").mockImplementation(async (environmentId, dependencies) => ({ environmentId, sampledAt: 1, ...dependencies.devices(), lan: { state: "unavailable" }, privateNetwork: { state: "unavailable" }, tunnels: null }));
  try {
    const report = (await s.call("host.access.read")).value.result;
    expect(report.devices).toHaveLength(2);
    expect(report.devices[0]).toEqual({ id: s.first.id, name: "Laptop", isCurrent: true });
    expect(JSON.stringify(report)).not.toContain(s.second.token);
    expect(JSON.stringify(report)).not.toContain('"hash"');
    expect((await s.call("devices.revokeOther", { id: s.first.id })).value.error).toMatch(/revoke-self/);
    expect((await s.call("devices.revokeOther", { id: s.second.id }, "invalid")).status).toBe(401);
    expect((await s.call("devices.revokeOther", { id: s.second.id })).value.result).toEqual({ revoked: true });
    expect((await s.call("host.access.read", {}, s.second.token)).status).toBe(401);
    expect((await s.call("host.access.read")).value.result.devices).toHaveLength(1);
    expect(s.send).not.toHaveBeenCalled();
  } finally { read.mockRestore(); }
});

it("exposes a safe authenticated provider center and applies only reviewed ACP metadata", async () => {
  const s = await setup([]);
  const center = { revision: "a".repeat(64), agents: [{ id: "agent", name: "Agent", argumentCount: 1, environmentKeyCount: 1 }] };
  const read = vi.spyOn(GenericAcpService.prototype, "center").mockResolvedValue(center);
  const patch = vi.spyOn(GenericAcpService.prototype, "patchMetadata").mockResolvedValue(undefined);
  try {
    const descriptor = (await s.call("environment.describe")).value.result;
    expect(descriptor.capabilities).toContain("providers.center.read");
    expect(descriptor.capabilities).toContain("providers.acp.patchMetadata");
    expect((await s.call("providers.center.read")).value.result).toEqual({ environmentId: s.store.environmentId, sampledAt: expect.any(Number), providers: [], acp: center });
    const update = { id: "agent", name: "Reviewed", expectedRevision: center.revision, contextWindow: 4096 };
    expect((await s.call("providers.acp.patchMetadata", update)).value.result).toBeNull();
    expect(patch).toHaveBeenCalledExactlyOnceWith(update);
    expect((await s.call("providers.center.read", {}, "invalid")).status).toBe(401);
    expect((await s.call("providers.acp.patchMetadata", update, "invalid")).status).toBe(401);
    expect(read).toHaveBeenCalledOnce();
    expect(patch).toHaveBeenCalledOnce();
    expect(s.send).not.toHaveBeenCalled();
  } finally { read.mockRestore(); patch.mockRestore(); }
});

it("binds contextual RPC creation to the reviewed source and reconciles the original receipt after source changes", async () => {
  const s = await setup(["codex", "claude"], true);
  const created = s.engine.command({ type: "create", commandId: "context-rpc-source", projectId: s.project.id, harness: "codex", model: "codex:test", runtimeMode: "supervised" });
  s.engine.command({ type: "send", commandId: "context-rpc-turn", sessionId: created.sessionId, text: "Review search" });
  await vi.waitFor(() => expect(s.send).toHaveBeenCalledOnce());
  s.turn().onEvent({ type: "message.delta", text: "Search review complete." });
  s.finish();
  await vi.waitFor(() => expect(s.store.session(created.sessionId).status).toBe("idle"));
  const source = s.store.session(created.sessionId);
  const reply = source.session.blocks.find((block) => block.role === "assistant")!;
  const input = { sessionId: created.sessionId, sourceBlockId: reply.id, expectedRevision: source.revision, mode: "handoff", harness: "claude", model: "claude:test", modelSettings: {} };
  const response = await s.call("sessions.contextual.preview", input);
  expect(response.value.error).toBeUndefined();
  const preview = response.value.result;
  expect(preview.contextText).toContain("Search review complete.");
  expect(s.store.session(created.sessionId)).toEqual(source);
  expect((await s.call("sessions.contextual.preview", input, "invalid")).status).toBe(401);
  const command = { ...input, type: "contextual", commandId: "context-rpc-handoff", previewDigest: preview.digest };
  expect((await s.call("commands.dispatch", { ...command, model: "changed" })).value.error).toMatch(/context changed/);
  const receipt = (await s.call("commands.dispatch", command)).value.result;
  expect(receipt.sessionId).not.toBe(created.sessionId);
  expect(s.store.session(receipt.sessionId).status).toBe("idle");
  s.engine.updateSession(created.sessionId, { title: "Changed source" });
  expect((await s.call("commands.dispatch", command)).value.result).toEqual(receipt);
  expect((await s.call("commands.dispatch", { ...command, commandId: "stale-context-rpc" })).value.error).toMatch(/source conversation changed/);
  expect(s.send).toHaveBeenCalledOnce();
});

it("previews automation schedules over authenticated RPC without saving or running work", async () => {
  const s = await setup();
  const schedule = { scheduleKind: "daily", time: "09:00", minute: 0, dayOfWeek: 1 };
  const response = await s.call("automations.preview", { schedule });
  expect(response.value.result).toEqual({
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    nextRunAt: expect.any(Number),
  });
  expect((await s.call("automations.list")).value.result).toEqual([]);
  expect(
    (await s.call("automations.preview", { schedule: { ...schedule, time: "25:00" } })).value.error,
  ).toBeTruthy();
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

it("scopes note reads to the authoritative session before accessing notes", async () => {
  const s = await setup();
  const created = s.engine.command({ type: "create", commandId: "notes-session", projectId: s.project.id, harness: "codex", model: "gpt", runtimeMode: "supervised" });
  const list = vi.spyOn(HostNotes.prototype, "list").mockReturnValue({ notes: [], total: 0 });
  const get = vi.spyOn(HostNotes.prototype, "get").mockReturnValue({ id: "foreign", slug: "foreign", title: "Foreign", body: "body", tags: [], sourceSessionId: "another", slugPending: false, createdAt: 1, updatedAt: 1 });
  try {
    expect((await s.call("notes.list", { projectId: s.project.id, sessionId: created.sessionId })).value.result).toEqual({ notes: [], total: 0 });
    expect(list).toHaveBeenCalledExactlyOnceWith(undefined, created.sessionId);
    expect((await s.call("notes.list", { projectId: "another-project", sessionId: created.sessionId })).value.error).toMatch(/another project/);
    expect((await s.call("notes.list", { sessionId: "missing-session" })).value.error).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(1);
    expect((await s.call("notes.get", { id: "foreign", projectId: s.project.id, sessionId: created.sessionId })).value.error).toMatch(/another session/);
    expect(s.send).not.toHaveBeenCalled();
  } finally { list.mockRestore(); get.mockRestore(); }
});

it("serves bounded session usage over authenticated RPC without a provider call", async () => {
  const s = await setup();
  expect((await s.call("environment.describe")).value.result.capabilities).toContain("usage.sessions.read");
  const params = { projectId: s.project.id, sinceMs: 100, untilMs: 200, limit: 10 };
  expect((await s.call("usage.sessions.read", params)).value.result).toMatchObject({
    environmentId: s.store.environmentId, projectId: s.project.id, scope: "host-observed-sessions",
    window: { start: 100, end: 200, timeZone: "UTC", attribution: "turn-start" }, rows: [], nextCursor: null,
  });
  expect((await s.call("usage.sessions.read", { ...params, projectId: "foreign-project" })).value.error).toBeTruthy();
  expect((await s.call("usage.sessions.read", { ...params, untilMs: 100 })).value.error).toBeTruthy();
  expect((await s.call("usage.sessions.read", params, "invalid-device-token")).status).toBe(401);
  expect(s.send).not.toHaveBeenCalled();
});

it("advertises individual Claude stopping only with an installed provider hook", async () => {
  const s = await setup(["codex", "claude"]);
  expect((await s.call("environment.describe")).value.result.capabilities).not.toContain("sessions.stopItem.claude");
  const supported = vi.spyOn(s.engine, "supportsItemStop").mockImplementation((provider) => provider === "claude");
  try {
    expect((await s.call("environment.describe")).value.result.capabilities).toContain("sessions.stopItem.claude");
  } finally { supported.mockRestore(); }
});

describe("scoped Conversation Tools RPC", () => {
  it("routes preview jobs through scoped RPC and rejects foreign ownership and protected input", async () => {
    const spies = [
      vi.spyOn(DeviceHost.prototype, "preflight").mockResolvedValue({
        device: {
          id: "sim",
          name: "iPhone",
          platform: "ios",
          version: "27",
          booted: true,
          physical: false,
        },
        status: {
          running: true,
          installed: true,
          agentInstalled: true,
          platform: "darwin",
          platforms: [],
        },
        devices: [],
        errors: [],
        checks: { sdk: true, device: true, tools: true, agentControl: true },
      }),
      vi.spyOn(DeviceHost.prototype, "status").mockResolvedValue({
        running: true,
        installed: true,
        agentInstalled: true,
        platform: "darwin",
        platforms: [],
      }),
      vi
        .spyOn(DeviceHost.prototype, "prepareExpo")
        .mockResolvedValue({ app: "host.exp.Exponent", version: "57.0.9", installed: false }),
      vi.spyOn(DeviceHost.prototype, "openExpo").mockResolvedValue(undefined),
      vi
        .spyOn(DeviceHost.prototype, "action")
        .mockResolvedValue('{"success":true,"data":{"nodes":[]}}'),
      vi
        .spyOn(DeviceHost.prototype, "capture")
        .mockResolvedValue({ mime: "image/png", base64: "aGVsbG8=", capturedAt: "now" }),
      vi.spyOn(expoGo, "expoManifest").mockResolvedValue({ sdkVersion: "57.0.0" }),
    ];
    try {
      const s = await setup();
      const input = {
        requestId: "r",
        deviceId: "sim",
        url: "exp://localhost:8081",
        previewOwner: "session-a",
      };
      const started = (await s.call("devices.preview", input)).value.result;
      expect(started.id).toBeTruthy();
      await vi.waitFor(async () =>
        expect(
          (await s.call("devices.preview.status", { id: started.id, previewOwner: "session-a" }))
            .value.result.state,
        ).toBe("ready"),
      );
      expect((await s.call("devices.preview", input)).value.result.id).toBe(started.id);
      expect(
        (
          await s.call("devices.preview.status", {
            id: started.id,
            previewOwner: "session-b",
            includeFrame: true,
          })
        ).value.error,
      ).toContain("PREVIEW_SCOPE_MISMATCH");
      expect((await s.call("devices.preview", { ...input, approved: true })).value.error).toContain(
        "protected",
      );
      expect(
        (await s.call("devices.preview", { ...input, projectId: "foreign-project" })).value.error,
      ).toBeTruthy();
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });
  async function sessionTools() {
    const s = await setup();
    const created = s.engine.command({
      type: "create",
      commandId: crypto.randomUUID(),
      projectId: s.project.id,
      harness: "codex",
      model: "gpt",
      runtimeMode: "supervised",
    });
    const grant = (await s.call("conversation.access.issue", { sessionId: created.sessionId }))
      .value.result;
    const tool = (action: string, input: Record<string, unknown> = {}) =>
      s.call("conversation.tools.call", { action, input }, grant.token);
    return { ...s, created, grant, tool };
  }
  it("creates goal plans from a desktop-only conversation without adopting it", async () => {
    const s = await sessionTools();
    const source = s.store.session(s.created.sessionId);
    const id = "desktop-only-goal-caller";
    const snapshot = { ...source, session: { ...source.session, id } };
    const cwd = vi.spyOn(DesktopSessions.prototype, "projectCwd").mockImplementation((sessionId) =>
      sessionId === id ? s.project.cwd : undefined,
    );
    const read = vi.spyOn(DesktopSessions.prototype, "snapshot").mockImplementation((sessionId) =>
      sessionId === id ? snapshot : undefined,
    );
    const create = vi.spyOn(HostGoals.prototype, "create").mockImplementation((raw) => ({
      ...(raw as ReturnType<HostGoals["create"]>), status: "planning", taskIds: [], createdAt: 1, updatedAt: 1,
    }));
    try {
      expect(() => s.store.session(id)).toThrow("Session not found on this machine");
      const issued = await s.call("conversation.access.issue", { sessionId: id });
      expect(issued.value.error).toBeUndefined();
      const result = await s.call("conversation.tools.call", {
        action: "goals.create", input: { goalId: "desktop-plan", title: "Plan", prompt: "Implement safely" },
      }, issued.value.result.token);
      expect(result.value.error).toBeUndefined();
      expect(result.value.result).toMatchObject({
        id: "desktop-plan", projectIds: [s.project.id], harness: source.session.harness,
        model: source.session.model, runtimeMode: source.session.runtimeMode,
        approvePlan: true, manualStart: true, isolate: false, autoMerge: false,
      });
      expect(create).toHaveBeenCalledOnce();
      expect(() => s.store.session(id)).toThrow("Session not found on this machine");
      expect(s.send).not.toHaveBeenCalled();
    } finally {
      create.mockRestore(); read.mockRestore(); cwd.mockRestore();
    }
  });
  it("routes the expanded project catalog through scoped RPC", async () => {
    const s = await sessionTools();
    writeFileSync(join(s.project.cwd, "mcp-parity.txt"), "api_key=private-value\nhello");
    const catalog = (await s.tool("tools.list")).value.result.tools;
    for (const action of ["files.read", "git.index", "crews.agents.list", "servers.list", "goals.list", "providers.list", "checkpoints.status"])
      expect(catalog.some((tool: { action: string }) => tool.action === action)).toBe(true);
    expect((await s.tool("files.read", { path: "mcp-parity.txt" })).value.result.text).toBe("api_key=[REDACTED]\nhello");
    expect((await s.tool("files.read", { path: "../outside" })).value.error).toBeTruthy();
    expect((await s.tool("files.read", { path: "mcp-parity.txt", cwd: "/other" })).value.error).toBeTruthy();
    expect((await s.tool("providers.list")).value.result.providers).toContain("codex");
    expect((await s.tool("goals.list")).value.result.items).toEqual([]);
    expect((await s.tool("stewards.list")).value.result.items).toEqual([]);
    expect((await s.tool("automations.preview", { scheduleKind: "daily" })).value.result.nextRunAt).toEqual(expect.any(Number));
    expect((await s.tool("usage.sessions.read", { sinceMs: 100, untilMs: 200 })).value.result.projectId).toBe(s.project.id);
    expect((await s.tool("crews.agents.list", { limit: 1 })).value.result.items.length).toBeLessThanOrEqual(1);
    expect((await s.tool("checkpoints.status", { sessionId: "foreign" })).value.error).toBeTruthy();
    expect((await s.tool("devServers.logs", { id: "foreign" })).value.error).toBeTruthy();
    expect((await s.tool("devServers.openExternal", { id: "foreign", port: 5173 })).value.error).toBeTruthy();
    expect(s.send).not.toHaveBeenCalled();
  });
  it("reads desktop-only checkpoints and attachments without adopting the conversation", async () => {
    const s = await sessionTools();
    const source = s.store.session(s.created.sessionId);
    const id = "desktop-only-tool-caller";
    const attachmentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    mkdirSync(s.store.attachmentDir, { recursive: true });
    writeFileSync(join(s.store.attachmentDir, attachmentId), "desktop bytes");
    const snapshot: typeof source = {
      ...source,
      session: {
        ...source.session,
        id,
        blocks: [
          {
            id: "accepted",
            role: "user",
            text: "",
            attachments: [
              {
                id: attachmentId,
                name: "accepted.txt",
                kind: "file",
                mimeType: "text/plain",
                size: 13,
              },
            ],
          },
        ],
      },
    };
    const cwd = vi
      .spyOn(DesktopSessions.prototype, "projectCwd")
      .mockImplementation((target) => (target === id ? s.project.cwd : undefined));
    const read = vi
      .spyOn(DesktopSessions.prototype, "snapshot")
      .mockImplementation((target) => (target === id ? snapshot : undefined));
    const relay = vi
      .spyOn(ConversationDesktopRelay.prototype, "call")
      .mockImplementation(async (action) => {
        if (action === "checkpoints.status") return { files: [{ relative: "desktop.txt" }] };
        if (action === "checkpoints.diff")
          return {
            relative: "desktop.txt",
            original: "before",
            current: "after",
            binary: false,
            tooLarge: false,
          };
        throw new Error("Unexpected desktop action");
      });
    try {
      const issued = await s.call("conversation.access.issue", { sessionId: id });
      expect(issued.value.error).toBeUndefined();
      const tool = (action: string, input = {}) =>
        s.call("conversation.tools.call", { action, input }, issued.value.result.token);
      expect((await tool("checkpoints.status")).value.result).toMatchObject({
        total: 1,
        items: [{ relative: "desktop.txt" }],
      });
      expect(
        (await tool("checkpoints.diff", { relative: "desktop.txt" })).value.result,
      ).toMatchObject({ original: "before", current: "after" });
      expect(relay).toHaveBeenCalledWith(
        "checkpoints.diff",
        { sessionId: id, relative: "desktop.txt" },
        s.project.cwd,
        expect.objectContaining({ sessionId: id, projectId: s.project.id }),
        expect.any(Function),
      );
      expect((await tool("attachments.list")).value.result).toMatchObject({
        total: 1,
        items: [{ id: attachmentId, readable: true }],
      });
      expect((await tool("attachments.read", { id: attachmentId })).value.result).toMatchObject({
        data: Buffer.from("desktop bytes").toString("base64"),
        nextOffset: null,
      });
      expect(
        (await tool("attachments.read", { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })).value
          .error,
      ).toMatch(/not found/);
      const count = relay.mock.calls.length;
      expect((await tool("checkpoints.status", { sessionId: "foreign" })).value.error).toBeTruthy();
      expect(relay).toHaveBeenCalledTimes(count);
      relay.mockRejectedValueOnce(new Error("Desktop unavailable"));
      expect((await tool("checkpoints.status")).value.error).toMatch(/Desktop unavailable/);
      expect(() => s.store.session(id)).toThrow("Session not found on this machine");
    } finally {
      relay.mockRestore();
      read.mockRestore();
      cwd.mockRestore();
    }
  });
  it("routes task dependencies, evidence and queue ordering without starting work", async () => {
    const s = await sessionTools();
    const first = (await s.tool("tasks.create", { taskId: "dependency", title: "First", prompt: "first" })).value.result;
    const second = (await s.tool("tasks.create", { taskId: "dependent", title: "Second", prompt: "second", dependsOn: [first.id], verifyCommand: "pnpm test" })).value.result;
    expect(second.dependsOn).toEqual([first.id]);
    expect((await s.tool("tasks.dependencies.list", { taskId: second.id })).value.result.blockingCount).toBe(1);
    expect((await s.tool("tasks.artifacts.list", { taskId: second.id })).value.result.items).toEqual([]);
    expect((await s.tool("tasks.update", { taskId: second.id, dependsOn: [], verifyCommand: "" })).value.result.dependsOn).toEqual([]);
    expect((await s.tool("tasks.update", { taskId: second.id, dependsOn: ["foreign"] })).value.error).toBeTruthy();
    expect((await s.tool("tasks.reorder", { order: [{ taskId: first.id, expectedUpdatedAt: first.updatedAt }] })).value.error).toBeUndefined();
    expect(s.send).not.toHaveBeenCalled();
  });
  it("runs inspected file lifecycle operations through the editor service", async () => {
    const s = await sessionTools();
    mkdirSync(join(s.project.cwd, "destination"));
    mkdirSync(join(s.project.cwd, "tree"));
    writeFileSync(join(s.project.cwd, "tree", "file.txt"), "first");
    const inspect = async (path: string) => (await s.tool("files.inspect", { path })).value.result.hash;
    let hash = await inspect("tree");
    writeFileSync(join(s.project.cwd, "tree", "file.txt"), "changed");
    expect((await s.tool("files.delete", { path: "tree", expectedHash: hash })).value.error).toMatch(/changed/);
    hash = await inspect("tree");
    expect((await s.tool("files.rename", { path: "tree", name: "renamed", expectedHash: hash })).value.result.path).toBe("renamed");
    hash = await inspect("renamed");
    expect((await s.tool("files.copy", { path: "renamed", destinationParent: "destination", expectedHash: hash })).value.result.path).toBe("destination/renamed");
    expect((await s.tool("files.move", { path: "renamed", destinationParent: "destination", expectedHash: hash })).value.error).toMatch(/exists/);
    expect((await s.tool("files.read", { path: "destination/renamed/file.txt" })).value.result.text).toBe("changed");
    hash = await inspect("renamed/file.txt");
    expect((await s.tool("files.move", { path: "renamed/file.txt", destinationParent: "destination", expectedHash: hash })).value.result.path).toBe("destination/file.txt");
    expect((await s.tool("files.delete", { path: "destination/file.txt", expectedHash: hash })).value.result.deleted).toBe(true);
    expect((await s.tool("files.inspect", { path: "." })).value.error).toBeTruthy();
    expect((await s.tool("files.inspect", { path: "../outside" })).value.error).toBeTruthy();
    mkdirSync(join(s.project.cwd, "protected", ".git"), { recursive: true });
    expect((await s.tool("files.inspect", { path: "protected" })).value.error).toBeTruthy();
  });

  it("requires exact owner approval and current revisions for task transfer, notes and deletion", async () => {
    const s = await sessionTools();
    const destination = join(s.directory, "transfer-target");
    mkdirSync(destination);
    const target = s.store.addProject(destination, "Target");
    const task = (await s.tool("tasks.create", { taskId: "transfer", title: "Transfer me", prompt: "Work", status: "todo" })).value.result;
    const relay = vi.spyOn(ConversationDesktopRelay.prototype, "call").mockResolvedValue({ approved: false });
    try {
      const input = { taskId: task.id, expectedUpdatedAt: task.updatedAt, targetProjectId: target.id };
      expect((await s.tool("tasks.transfer", input)).value.error).toMatch(/approval/);
      expect((await s.tool("tasks.get", { taskId: task.id })).value.result.projectId).toBe(s.project.id);
      relay.mockResolvedValue({ approved: true });
      expect((await s.tool("tasks.transfer", input)).value.result).toMatchObject({ id: task.id, projectId: target.id, status: "todo" });
      expect((await s.tool("tasks.get", { taskId: task.id })).value.error).toMatch(/not in this project/);
      const noteTask = (await s.tool("tasks.create", { taskId: "notes-task", title: "Notes", prompt: "Work", status: "todo" })).value.result;
      s.store.db.prepare("UPDATE tasks SET value=json_set(value,'$.reviewNotes',json(?)) WHERE id=?").run(JSON.stringify([{ id: "finding", text: "Verify fix", createdAt: 1 }]), noteTask.id);
      // Existing host API observes external test fixtures through its task lookup.
      expect((await s.tool("tasks.notes.resolve", { taskId: noteTask.id, noteId: "finding", resolved: true, expectedUpdatedAt: noteTask.updatedAt })).value.result.reviewNotes[0].resolvedAt).toBeTypeOf("number");
      const latest = (await s.tool("tasks.get", { taskId: noteTask.id })).value.result;
      expect((await s.tool("tasks.delete", { taskId: latest.id, expectedUpdatedAt: 0 })).value.error).toMatch(/changed/);
      expect((await s.tool("tasks.delete", { taskId: latest.id, expectedUpdatedAt: latest.updatedAt })).value.result.deleted).toBe(true);
      const guarded = (await s.tool("tasks.create", { taskId: "guarded", title: "Guarded", prompt: "Work", status: "todo" })).value.result;
      relay.mockImplementationOnce(async () => {
        // Preserve the same timestamp to prove approval checks the full task,
        // rather than trusting a clock-based revision alone.
        s.store.db.prepare("UPDATE tasks SET value=json_set(value,'$.title',?) WHERE id=?").run("Changed during approval", guarded.id);
        return { approved: true };
      });
      expect((await s.tool("tasks.delete", { taskId: guarded.id, expectedUpdatedAt: guarded.updatedAt })).value.error).toMatch(/changed during approval/i);
    } finally { relay.mockRestore(); }
  });
  it("allows paired owner browser takeover while denying takeover by conversation tools", async () => {
    const s = await sessionTools();
    const agent = (await s.tool("browser.claim")).value.result;
    const blocked = await s.call("browser.claim");
    expect(blocked.value.error).toContain("Another client");
    const owner = (await s.call("browser.claim", { takeover: true })).value.result;
    expect(owner.controlling).toBe(true);
    expect(owner.leaseId).not.toBe(agent.leaseId);
    expect((await s.tool("browser.claim")).value.error).toContain("Another client");
    expect((await s.tool("browser.claim", { takeover: true })).value.error).toBeTruthy();
    expect((await s.call("browser.status")).value.result).toMatchObject({
      controlling: true,
      leaseId: owner.leaseId,
    });
  });

  it("discovers and reads project skills through the scoped RPC without accepting another root", async () => {
    const s = await sessionTools();
    const path = join(s.project.cwd, ".agents/skills/scoped-harness-review");
    mkdirSync(path, { recursive: true });
    writeFileSync(
      join(path, "SKILL.md"),
      "---\ndescription: Harness recovery review\n---\nScoped instructions",
    );
    const found = (await s.tool("skills.search", { query: "scoped-harness-review" })).value.result;
    expect(found.skills.map((entry: { name: string }) => entry.name)).toContain(
      "scoped-harness-review",
    );
    expect(
      (await s.tool("skills.read", { name: "scoped-harness-review" })).value.result.text,
    ).toContain("Scoped instructions");
    expect(
      (await s.tool("skills.read", { name: "scoped-harness-review", cwd: "/other" })).value.error,
    ).toContain("protected");
    const work = join(s.project.cwd, "assigned-workspace");
    const nestedSkill = join(work, ".agents/skills/assigned-skill");
    mkdirSync(nestedSkill, { recursive: true });
    writeFileSync(join(nestedSkill, "SKILL.md"), "Assigned workspace instructions");
    const current = s.store.session(s.created.sessionId);
    s.store.save(
      { ...current, revision: current.revision + 1, session: { ...current.session, cwd: work } },
      { type: "test.workspace" },
    );
    expect((await s.tool("skills.read", { name: "assigned-skill" })).value.result.text).toContain(
      "Assigned workspace",
    );
  });
  it.each([
    ["ui.tools.open", { tab: "devices", placement: "right", machineId: "mac" }],
    ["ui.workspace.open", { view: "settings", section: "connections" }],
  ])(
    "forwards %s with host/project/session identity and waits for the desktop acknowledgement",
    async (action, input) => {
      const s = await sessionTools();
      await s.call("conversation.desktop.take");
      const pending = s.tool(action, input);
      let requests: any[] = [];
      for (let i = 0; i < 20 && !requests.length; i++) {
        await new Promise((done) => setTimeout(done, 10));
        requests = (await s.call("conversation.desktop.take")).value.result;
      }
      expect(requests[0]).toMatchObject({
        action,
        environmentId: s.store.environmentId,
        cwd: s.project.cwd,
        sessionId: s.created.sessionId,
        input,
      });
      const state =
        action === "ui.workspace.open"
          ? { view: "settings", section: "connections", mounted: true }
          : {
              open: true,
              placement: "right",
              panels: [{ id: "pane", tab: "devices", machine: "machine:mac", mounted: true }],
            };
      await s.call("conversation.desktop.finish", { id: requests[0].id, result: state });
      expect((await pending).value.result).toEqual(state);
      expect((await s.tool("ui.tools.open", { sessionId: "foreign" })).value.error).toContain(
        "protected",
      );
      expect((await s.tool("ui.tools.place", { placement: "diagonal" })).value.error).toContain(
        "Invalid",
      );
    },
  );
  it("separates read-only log tokens, conversation grants and native owner operations", async () => {
    const s = await sessionTools();
    expect((await s.tool("tools.list")).value.result).toMatchObject({ projectId: s.project.id });
    expect((await s.tool("tasks.list", { projectId: "foreign" })).value.error).toContain(
      "protected",
    );
    expect((await s.call("projects.list", {}, s.grant.token)).value.error).toContain(
      "Conversation Tools",
    );
    expect((await s.call("conversation.desktop.take", {}, s.grant.token)).value.error).toContain(
      "Conversation Tools",
    );
    const logs = (await s.call("runtimeLogs.access.issue", { sessionId: s.created.sessionId }))
      .value.result;
    expect(
      (await s.call("conversation.tools.call", { action: "tasks.list", input: {} }, logs.token))
        .value.error,
    ).toContain("only permit reading");
    expect(
      (await s.call("conversation.tools.call", { action: "tasks.list", input: {} })).value.error,
    ).toContain("scoped");
    s.store.revokeDevice(s.first.id);
    expect((await s.tool("tasks.list")).status).toBe(401);
  });
  it("reads other project sessions without approval and refuses cross-project reads or sends", async () => {
    const s = await sessionTools();
    const create = (projectId: string) =>
      s.engine.command({
        type: "create",
        commandId: crypto.randomUUID(),
        projectId,
        harness: "codex",
        model: "gpt",
        runtimeMode: "supervised",
      });
    const target = create(s.project.id);
    const foreignProject = s.store.addProject(join(s.project.cwd, "foreign"), "Foreign");
    const foreign = create(foreignProject.id);
    const listed = (await s.tool("sessions.list")).value.result.sessions;
    expect(listed.some((session: { id: string }) => session.id === target.sessionId)).toBe(true);
    expect(listed.some((session: { id: string }) => session.id === foreign.sessionId)).toBe(false);
    expect(
      (await s.tool("sessions.read", { sessionId: target.sessionId })).value.result,
    ).toMatchObject({ sessionId: target.sessionId, turns: [], busy: false });
    expect((await s.tool("sessions.read", { sessionId: foreign.sessionId })).value.error).toContain(
      "another project",
    );
    expect(
      (await s.tool("sessions.send", { sessionId: target.sessionId, prompt: "send" })).value.error,
    ).toContain("Unsupported");
  });
  it("routes Notes, Automations and Inbox through the scoped application APIs", async () => {
    const s = await sessionTools();
    const noteRead = vi.spyOn(HostNotes.prototype, "get").mockReturnValue({
      id: "note",
      slug: "note",
      title: "Plan",
      body: "Text",
      tags: [],
      sourceCwd: s.project.cwd,
      slugPending: false,
      createdAt: 1,
      updatedAt: 1,
    });
    try {
      expect((await s.tool("notes.read", { id: "note" })).value.result.title).toBe("Plan");
      expect(noteRead).toHaveBeenCalledWith("note", s.project.cwd);
    } finally {
      noteRead.mockRestore();
    }
    const created = (
      await s.tool("automations.create", {
        automationId: "daily",
        name: "Daily",
        prompt: "Inspect this project",
        scheduleKind: "daily",
        enabled: false,
      })
    ).value.result;
    expect(created).toMatchObject({
      projectId: s.project.id,
      runtimeMode: "supervised",
      enabled: false,
    });
    expect(
      (await s.tool("automations.list")).value.result.items.map((entry: any) => entry.id),
    ).toEqual(["daily"]);
    expect(
      (
        await s.tool("automations.update", {
          automationId: "daily",
          expectedUpdatedAt: created.updatedAt,
          runtimeMode: "full-access",
        })
      ).value.error,
    ).toContain("protected");
    expect((await s.tool("inbox.list")).value.result.items).toEqual([]);
    expect((await s.tool("inbox.providers.status")).value.result.available).toBe(false);
    expect(
      (
        await s.tool("inbox.comment", {
          requestId: "send",
          item: { provider: "github", kind: "issue", number: 1, repo: "owner/project" },
          body: "comment",
          confirm: "SEND_COMMENT",
        })
      ).value.error,
    ).toContain("protected");
  });
  it("creates tasks with inherited permissions and rejects changed idempotency requests", async () => {
    const s = await sessionTools();
    const input = {
      taskId: "created-task",
      title: "New work",
      prompt: "Implement",
      status: "todo",
    };
    const first = (await s.tool("tasks.create", input)).value.result;
    expect(first).toMatchObject({
      id: input.taskId,
      projectId: s.project.id,
      runtimeMode: "supervised",
      model: "gpt",
      status: "todo",
    });
    expect((await s.tool("tasks.create", input)).value.result).toEqual(first);
    expect((await s.tool("tasks.create", { ...input, status: "queued" })).value.error).toContain(
      "reused",
    );
    expect((await s.tool("tasks.create", { ...input, prompt: "Changed" })).value.error).toContain(
      "reused",
    );
    expect(
      (await s.tool("tasks.create", { ...input, runtimeMode: "auto" })).value.error,
    ).toBeTruthy();
    await s.call("tasks.delete", { taskId: first.id });
    expect((await s.tool("tasks.create", input)).value.error).toBeTruthy();
  });
  it("filters tasks and rejects cross-project recovery, completion, and changes to its own task", async () => {
    const s = await sessionTools();
    const other = s.store.addProject(join(s.project.cwd, "other"), "Other");
    const input = {
      title: "Task",
      prompt: "Fix the issue",
      harness: "codex",
      model: "gpt",
      modelSettings: {},
      runtimeMode: "supervised",
      maxRunMinutes: 0,
      isolate: false,
      review: false,
      status: "todo",
    };
    const own = (
      await s.call("tasks.save", { task: { ...input, id: "own-task", projectId: s.project.id } })
    ).value.result;
    expect(own.id).toBe("own-task");
    await s.call("tasks.save", { task: { ...input, id: "foreign-task", projectId: other.id } });
    expect((await s.tool("tasks.list")).value.result.map((task: any) => task.id)).toEqual([
      "own-task",
    ]);
    expect((await s.tool("tasks.start", { taskId: "foreign-task" })).value.error).toContain(
      "not in this project",
    );
    expect((await s.tool("tasks.retry", { taskId: "own-task" })).value.error).toContain("blocked");
    expect((await s.tool("tasks.move", { taskId: "own-task", to: "done" })).value.error).toContain(
      "Unsupported",
    );
    const spy = vi
      .spyOn(HostTasks.prototype, "list")
      .mockReturnValue([{ ...own, sessionId: s.created.sessionId }]);
    try {
      expect((await s.tool("tasks.start", { taskId: "own-task" })).value.error).toContain(
        "own active task",
      );
      expect(
        (await s.tool("tasks.session.read", { taskId: "own-task" })).value.result,
      ).toMatchObject({
        sessionId: s.created.sessionId,
        status: "idle",
        totalBlocks: 0,
        blocks: [],
      });
    } finally {
      spy.mockRestore();
    }
    expect(
      (
        await s.tool("tasks.update", {
          taskId: "own-task",
          prompt: "New explicit repair instructions",
        })
      ).value.result.prompt,
    ).toBe("New explicit repair instructions");
  });
  it("relays exact Mac targets and terminal bytes only to the claiming owner, with no host fallback", async () => {
    const s = await sessionTools();
    await s.call("conversation.desktop.take");
    const pending = s.tool("devices.boot", { machineId: "mac", deviceId: "ios" });
    let requests: any[] = [];
    for (let i = 0; i < 20 && !requests.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      requests = (await s.call("conversation.desktop.take")).value.result;
    }
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      action: "devices.boot",
      cwd: s.project.cwd,
      input: { machineId: "mac", deviceId: "ios" },
    });
    expect(
      (
        await s.call(
          "conversation.desktop.finish",
          { id: requests[0].id, result: {} },
          s.second.token,
        )
      ).value.error,
    ).toContain("another device");
    await s.call("conversation.desktop.finish", { id: requests[0].id, error: "Mac disconnected" });
    expect((await pending).value.error).toBe("Mac disconnected");
    expect((await s.call("conversation.desktop.take")).value.result).toEqual([]);
  });
  it("reads captured terminal output through bounded project logs and scrubs secrets", async () => {
    const s = await sessionTools();
    const other = s.store.addProject(join(s.project.cwd, "other"), "Other");
    for (const [cwd, id, output] of [
      [s.project.cwd, "own-terminal", "ready\nAuthorization: Bearer secret-value\n"],
      [other.cwd, "other-terminal", "foreign-output\n"],
    ]) {
      await s.call("runtimeLogs.terminals.append", {
        cwd,
        terminalId: id,
        sequence: 0,
        data: Buffer.from(output).toString("base64"),
      });
    }
    const result = (await s.tool("terminals.read", { terminalId: "own-terminal", limit: 10 })).value
      .result;
    expect(JSON.stringify(result)).toContain("ready");
    expect(JSON.stringify(result)).not.toContain("secret-value");
    expect(
      JSON.stringify(
        (await s.tool("terminals.read", { terminalId: "other-terminal" })).value.result,
      ),
    ).not.toContain("foreign-output");
    expect(
      (await s.tool("terminals.write", { terminalId: "own-terminal", data: "pwd\n" })).value.error,
    ).toContain("offline");
  });
});

describe("conversation browser runtime", () => {
  it("advertises explicit setup, reports missing runtime and validates its project before downloading", async () => {
    const s = await setup();
    expect((await s.call("environment.describe")).value.result.capabilities).toContain(
      "browser.shared.setup",
    );
    expect((await s.call("browser.status")).value.result.runtime).toMatchObject({
      installed: false,
      installing: false,
      version: "1.64.0",
    });
    expect((await s.call("browser.setup", { projectId: "missing" })).value.error).toBeTruthy();
    expect((await s.call("browser.status")).value.result.runtime.installing).toBe(false);
  });

  it("supports paired machine tools without borrowing another machine's project", async () => {
    const s = await setup();
    const install = vi.spyOn(BrowserRuntime.prototype, "setup").mockResolvedValue({
      installed: true,
      installing: false,
      version: "1.64.0",
      lastError: undefined,
    });
    try {
      expect((await s.call("environment.describe")).value.result.capabilities).toContain(
        "host.tools.machine-targets",
      );
      expect((await s.call("devices.status")).value.result).toHaveProperty("platform");
      expect(
        (await s.call("devices.status", { projectId: "foreign-project" })).value.error,
      ).toBeTruthy();
      expect((await s.call("devices.status", {}, "invalid")).status).toBe(401);
      expect((await s.call("browser.setup")).value.result).toHaveProperty("runtime");
      expect(install).toHaveBeenCalledOnce();
      expect(
        (await s.call("browser.setup", { projectId: "foreign-project" })).value.error,
      ).toBeTruthy();
      expect((await s.call("browser.setup", {}, "invalid")).status).toBe(401);
      expect(install).toHaveBeenCalledOnce();
      // Conversation-owned data still require a real project/session on this host.
      expect(
        (await s.call("browser.annotation.start", { sessionId: "foreign-session" })).value.error,
      ).toBeTruthy();
    } finally {
      install.mockRestore();
    }
  });
});

it("allows explicit local voice setup only with paired desktop credentials", async () => {
  const s = await setup();
  const start = vi.spyOn(VoiceSetupService.prototype, "start").mockReturnValue({ state: "installing", stage: "environment", requestedConfig: { natural: false } });
  try {
    expect((await s.call("environment.describe")).value.result.capabilities).toContain("voice.local.setup.v1");
    expect((await s.call("voice.local.setupStatus")).value.result).toEqual({ state: "idle" });
    expect(start).not.toHaveBeenCalled();
    expect((await s.call("voice.local.setup", { config: { natural: false } })).value.result.state).toBe("installing");
    expect(start).toHaveBeenCalledExactlyOnceWith({ natural: false });
    expect((await s.call("voice.local.setup", {}, "invalid")).status).toBe(401);
    expect((await s.call("voice.local.setup", {}, s.first.token, {}, { Origin: "http://example.test" })).status).toBe(403);
    const created = s.engine.command({ type: "create", commandId: crypto.randomUUID(), projectId: s.project.id, harness: "codex", model: "gpt", runtimeMode: "supervised" });
    const grant = (await s.call("conversation.access.issue", { sessionId: created.sessionId })).value.result;
    expect((await s.call("voice.local.setup", {}, grant.token)).value.error).toContain("Session conversation credentials");
    expect(start).toHaveBeenCalledOnce();
    expect(s.send).not.toHaveBeenCalled();
  } finally { start.mockRestore(); }
});

it("keeps voice setup and running voice mutually exclusive across desktop windows", async () => {
  const s = await setup();
  const active = vi.spyOn(LocalVoiceService.prototype, "isActive", "get").mockReturnValue(true);
  const startSetup = vi.spyOn(VoiceSetupService.prototype, "start").mockReturnValue({ state: "installing" });
  const status = vi.spyOn(VoiceSetupService.prototype, "status").mockReturnValue({ state: "installing" });
  const startVoice = vi.spyOn(LocalVoiceService.prototype, "start");
  try {
    expect((await s.call("voice.local.setup")).value.error).toContain("Disconnect voice");
    expect(startSetup).not.toHaveBeenCalled();
    expect((await s.call("voice.local.setupStatus")).value.result.state).toBe("installing");
    active.mockReturnValue(false);
    expect((await s.call("voice.local.start")).value.error).toBe("Voice setup is still running.");
    expect(startVoice).not.toHaveBeenCalled();
  } finally { active.mockRestore(); startSetup.mockRestore(); status.mockRestore(); startVoice.mockRestore(); }
});

async function setup(providers: RemoteProvider[] = ["codex"], includeClaude = false) {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-server-test-"));
  const store = new HostStore(join(directory, "host.db"));
  let turn: SendTurnInput | undefined;
  let finish = () => {};
  const send = vi.fn((input: SendTurnInput) => {
    turn = input;
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  const engine = new HostEngine(store, {
    ...(includeClaude ? { claude: { send, stop: async () => finish(), cancel: async () => finish(), bind: () => {}, approve: () => {}, answer: () => {} } } : {}),
    codex: {
      send,
      stop: async () => finish(),
      cancel: async () => finish(),
      bind: () => {},
      approve: () => {},
      answer: () => {},
    },
  });
  // Follow production's canonicalization, including Windows 8.3 paths such
  // as RUNNER~1 in the CI runner's temporary directory.
  const project = await engine.openProject(directory);
  const server = createHostServer(engine, providers);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    store.close();
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
  const first = store.issueDevice("Laptop");
  const second = store.issueDevice("Other computer");
  const call = async (
    method: string,
    params: unknown = {},
    token = first.token,
    overrides: Record<string, unknown> = {},
    headers: Record<string, string> = {},
  ) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, ...headers },
      body: JSON.stringify({
        version: 1,
        environmentId: store.environmentId,
        method,
        params,
        ...overrides,
      }),
    });
    return {
      status: response.status,
      value: (await response.json()) as { result?: any; error?: string },
    };
  };
  cleanups.push(async () => {
    await engine.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    url,
    server,
    directory,
    engine,
    store,
    project,
    call,
    first,
    second,
    send,
    turn: () => turn!,
    finish: () => finish(),
  };
}

describe("shared queued messages", () => {
  it("reads an existing host queue without loading its transcript and rejects missing sessions", async () => {
    const s = await setup();
    const created = s.engine.command({
      type: "create",
      commandId: "metadata-create",
      projectId: s.project.id,
      harness: "codex",
      model: "gpt",
      runtimeMode: "supervised",
    });
    const snapshot = vi.spyOn(s.store, "session").mockImplementation(() => {
      throw new Error("Transcript must not be read for queue access");
    });
    try {
      expect(
        (
          await s.call("sessions.queue.get", {
            sessionId: created.sessionId,
            clientId: "desktop:test",
          })
        ).value.result.messages,
      ).toEqual([]);
      expect(snapshot).not.toHaveBeenCalled();
      expect(
        (await s.call("sessions.queue.get", { sessionId: "missing", clientId: "desktop:test" }))
          .value.error,
      ).toBeTruthy();
    } finally {
      snapshot.mockRestore();
    }
  });
  it("dispatches /clear without opening a session or sending a provider turn", async () => {
    const s = await setup();
    const created = s.engine.command({
      type: "create",
      commandId: "clear-create",
      projectId: s.project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    const current = s.store.session(created.sessionId);
    s.store.save(
      {
        ...current,
        revision: current.revision + 1,
        session: {
          ...current.session,
          providerSessionId: "old-provider",
          blocks: [{ id: "old", role: "user", text: "Old context" }],
        },
      },
      { type: "test.seed" },
    );
    const response = await s.call("commands.dispatch", {
      type: "send",
      commandId: "clear-rpc",
      sessionId: created.sessionId,
      text: "/clear",
    });
    expect(response.value.error).toBeUndefined();
    expect(response.value.result.sessionId).toBe(created.sessionId);
    expect(s.store.session(created.sessionId).session.blocks).toEqual([]);
    expect(s.store.session(created.sessionId).session.providerSessionId).toBeUndefined();
    expect(s.send).not.toHaveBeenCalled();
  });

  it("dispatches rewind through the async host cleanup path", async () => {
    const s = await setup();
    const created = s.engine.command({
      type: "create",
      commandId: "rewind-create",
      projectId: s.project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    const current = s.store.session(created.sessionId);
    s.store.save(
      {
        ...current,
        revision: current.revision + 1,
        session: {
          ...current.session,
          providerSessionId: "old-provider-session",
          blocks: [
            { id: "keep", role: "user", text: "Retained" },
            { id: "remove", role: "user", text: "Removed" },
          ],
        },
      },
      { type: "test.seed" },
    );
    const capabilities = (await s.call("environment.describe")).value.result.capabilities;
    expect(capabilities).toContain("sessions.rewind");
    const response = await s.call("commands.dispatch", {
      type: "rewind",
      commandId: "rewind-rpc",
      sessionId: created.sessionId,
      blockId: "remove",
    });
    expect(response.value.error).toBeUndefined();
    expect(s.store.session(created.sessionId).session.blocks.map((block) => block.id)).toEqual([
      "keep",
    ]);
  });

  it("dispatches an explicitly selected idle row while retaining a paused queue", async () => {
    const s = await setup();
    const created = s.engine.command({
      type: "create",
      commandId: "selected-create",
      projectId: s.project.id,
      harness: "codex",
      model: "gpt",
      runtimeMode: "supervised",
    });
    const sessionId = created.sessionId;
    const clientId = "remote:pc1";
    const messages = [
      { id: "a", text: "retain a", attachments: [] },
      { id: "b", text: "selected b", attachments: [] },
    ];
    const published = await s.call("sessions.queue.change", {
      sessionId,
      clientId,
      before: { messages: [] },
      after: { messages, status: "paused" },
      takeOwnership: true,
    });
    const command = {
      type: "send",
      commandId: "selected-send",
      sessionId,
      text: "selected b",
      queued: { id: "b", clientId, revision: published.value.result.revision, selected: true },
    };
    const rejected = await s.call("commands.dispatch", {
      ...command,
      commandId: "head-only",
      queued: { ...command.queued, selected: false },
    });
    expect(rejected.value.error).toMatch(/queue changed/i);
    expect((await s.call("commands.dispatch", command)).value.error).toBeUndefined();
    const queue = (await s.call("sessions.queue.get", { sessionId, clientId })).value.result;
    expect(queue.messages.map((row: { id: string }) => row.id)).toEqual(["a"]);
    expect(queue.status).toBe("paused");
    await vi.waitFor(() => expect(s.send).toHaveBeenCalledOnce());
  });

  it("tells the owning desktop which shared queues another computer changed through its heartbeat", async () => {
    const s = await setup();
    const created = s.engine.command({
      type: "create",
      commandId: "queue-wake-create",
      projectId: s.project.id,
      harness: "codex",
      model: "gpt",
      runtimeMode: "supervised",
    });
    const sessionId = created.sessionId;
    const beat = async (queueSeq?: number) =>
      (
        await s.call("sessions.desktopLive", {
          clientId: "desktop-window",
          sessions: [],
          ...(queueSeq === undefined ? {} : { queueSeq }),
        })
      ).value.result.queues;
    const first = await beat();
    expect(first).toMatchObject({ ids: [], reset: true });
    expect(await beat(first.seq)).toEqual({ seq: first.seq, ids: [], boot: first.boot });
    const row = { id: "remote-row", text: "from the phone", attachments: [] };
    await s.call("sessions.queue.change", {
      sessionId,
      clientId: "remote:phone",
      before: { messages: [] },
      after: { messages: [row], status: "active" },
      takeOwnership: false,
    });
    const next = await beat(first.seq);
    expect(next.ids).toEqual([sessionId]);
    expect(await beat(next.seq)).toEqual({ seq: next.seq, ids: [], boot: next.boot });
  });

  it("shares unsent rows between paired computers and consumes them with a durable receipt once", async () => {
    const s = await setup();
    const created = s.engine.command({
      type: "create",
      commandId: "queue-create",
      projectId: s.project.id,
      harness: "codex",
      model: "gpt",
      runtimeMode: "supervised",
    });
    const sessionId = created.sessionId;
    const clientId = "remote:pc1";
    const messages = [{ id: "queued", text: "do this after the current task", attachments: [] }];
    expect((await s.call("environment.describe")).value.result.capabilities).toContain(
      "sessions.queue",
    );
    const published = await s.call("sessions.queue.change", {
      sessionId,
      clientId,
      before: { messages: [] },
      after: { messages, status: "active" },
      takeOwnership: true,
    });
    expect(published.value.error).toBeUndefined();
    const read = await s.call(
      "sessions.queue.get",
      { sessionId, clientId: "remote:pc2" },
      s.second.token,
    );
    expect(read.value.result.messages).toEqual(messages);
    const changed = await s.call(
      "sessions.queue.change",
      {
        sessionId,
        clientId: "remote:pc2",
        before: read.value.result,
        after: { ...read.value.result, messages: [{ ...messages[0], text: "edited on pc2" }] },
      },
      s.second.token,
    );
    const command = {
      type: "send",
      commandId: "queue-send",
      sessionId,
      text: "edited on pc2",
      queued: { id: "queued", clientId, revision: changed.value.result.revision },
    };
    const stale = await s.call("commands.dispatch", {
      ...command,
      queued: { ...command.queued, revision: published.value.result.revision },
    });
    expect(stale.value.error).toMatch(/queue changed/i);
    const accepted = await s.call("commands.dispatch", command);
    expect(accepted.value.error).toBeUndefined();
    const repeat = await s.call("commands.dispatch", command, s.second.token);
    expect(repeat.value.result).toEqual(accepted.value.result);
    expect(
      (await s.call("sessions.queue.get", { sessionId, clientId })).value.result.messages,
    ).toEqual([]);
    await vi.waitFor(() => expect(s.send).toHaveBeenCalledOnce());
    expect(
      (await s.call("sessions.queue.get", { sessionId: "foreign-session", clientId })).value.error,
    ).toBeTruthy();
    expect((await s.call("sessions.queue.get", { sessionId, clientId }, "invalid")).status).toBe(
      401,
    );
  });

  describe("drain lease", () => {
    const create = (s: Awaited<ReturnType<typeof setup>>, commandId: string) =>
      s.engine.command({
        type: "create",
        commandId,
        projectId: s.project.id,
        harness: "codex",
        model: "gpt",
        runtimeMode: "supervised",
      }).sessionId;
    const aware = { leaseAware: true };
    const rows = (...ids: string[]) =>
      ids.map((id) => ({ id, text: `send ${id}`, attachments: [] }));

    it("advertises the capability and answers an aware client with the lease, an older one with a consumer", async () => {
      const s = await setup();
      const sessionId = create(s, "lease-cap");
      expect((await s.call("environment.describe")).value.result.capabilities).toContain(
        "sessions.queue.lease",
      );
      s.send.mockClear();
      const running = s.engine.command({
        type: "send",
        commandId: "lease-cap-turn",
        sessionId,
        text: "busy",
      });
      expect(running.sessionId).toBe(sessionId);
      const queued = await s.call("sessions.queue.change", {
        sessionId,
        clientId: "desktop:win1",
        ...aware,
        before: { messages: [] },
        after: { messages: rows("a"), status: "active" },
      });
      expect(queued.value.result).toMatchObject({ leased: true });
      expect(typeof queued.value.result.hostTime).toBe("number");
      expect(queued.value.result.drain).toBeUndefined();
      const granted = await s.call("sessions.queue.lease", {
        sessionId,
        clientId: "desktop:win1",
        ...aware,
      });
      expect(granted.value.result.drain).toMatchObject({ holder: "desktop:win1", epoch: 1 });
      // Another window is refused; a remote computer can never hold the lease.
      expect(
        (
          await s.call("sessions.queue.lease", {
            sessionId,
            clientId: "desktop:win2",
            ...aware,
          })
        ).value.error,
      ).toMatch(/drain lease/);
      expect(
        (await s.call("sessions.queue.lease", { sessionId, clientId: "remote:mac", ...aware }))
          .value.error,
      ).toMatch(/desktop/);
      const takeover = await s.call("sessions.queue.lease", {
        sessionId,
        clientId: "desktop:win2",
        takeover: true,
        ...aware,
      });
      expect(takeover.value.result.drain).toMatchObject({ holder: "desktop:win2", epoch: 2 });
      // The old holder is fenced out of claiming; the new one claims at its epoch.
      const read = (
        await s.call("sessions.queue.get", { sessionId, clientId: "desktop:win1", ...aware })
      ).value.result;
      expect(
        (
          await s.call("sessions.queue.claim", {
            sessionId,
            clientId: "desktop:win1",
            id: "a",
            revision: read.revision,
            epoch: 1,
            ...aware,
          })
        ).value.error,
      ).toMatch(/drain lease/);
      // An older client reading the same queue sees the live holder as its consumer.
      const legacy = await s.call("sessions.queue.get", { sessionId, clientId: "desktop:old" });
      expect(legacy.value.result.consumer).toBe("desktop:win2");
      expect(legacy.value.result.leased).toBeUndefined();
      s.finish();
    });

    it("keeps a desktop's leases alive on its heartbeat and tells it which one it lost", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        const s = await setup();
        const sessionId = create(s, "lease-beat");
        s.engine.command({ type: "send", commandId: "lease-beat-turn", sessionId, text: "busy" });
        await s.call("sessions.queue.change", {
          sessionId,
          clientId: "desktop:win1",
          ...aware,
          before: { messages: [] },
          after: { messages: rows("a"), status: "active" },
        });
        const first = (
          await s.call("sessions.queue.lease", { sessionId, clientId: "desktop:win1", ...aware })
        ).value.result.drain;
        const beat = async (clientId: string, epoch: number) =>
          (
            await s.call("sessions.desktopLive", {
              clientId,
              sessions: [],
              queueLeases: [{ sessionId, epoch }],
            })
          ).value.result.queueLeases;
        // Early in the lease nothing needs to be written, the lease is simply confirmed.
        vi.setSystemTime(Date.now() + QUEUE_LEASE_TTL_MS * 0.15);
        expect((await beat("win1", 1))[sessionId]).toEqual(first);
        // Past half of the lease the beat extends it.
        vi.setSystemTime(Date.now() + QUEUE_LEASE_TTL_MS * 0.4);
        const renewed = (await beat("win1", 1))[sessionId];
        expect(renewed.expiresAt).toBeGreaterThan(first.expiresAt);
        // A wrong epoch or another window's beat renews nothing.
        expect((await beat("win1", 5))[sessionId]).toBeNull();
        expect((await beat("win2", 1))[sessionId]).toBeNull();
        const read = (
          await s.call("sessions.queue.get", { sessionId, clientId: "desktop:win1", ...aware })
        ).value.result;
        expect(read.drain.expiresAt).toBe(renewed.expiresAt);
        expect(read.revision).toBeGreaterThan(0);
        s.finish();
      } finally {
        vi.useRealTimers();
      }
    });

    it("sends the queue itself once the holder's lease ran out, and not while it is alive", async () => {
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      try {
        const s = await setup();
        const sessionId = create(s, "lease-drain");
        s.engine.command({ type: "send", commandId: "lease-drain-turn", sessionId, text: "busy" });
        await vi.waitFor(() => expect(s.send).toHaveBeenCalledOnce());
        await s.call("sessions.queue.change", {
          sessionId,
          clientId: "remote:mac",
          ...aware,
          before: { messages: [] },
          after: { messages: rows("a", "b"), status: "active" },
        });
        await s.call("sessions.queue.lease", { sessionId, clientId: "desktop:win1", ...aware });
        // The turn ends while the desktop holds the queue: the host leaves it alone.
        s.finish();
        await vi.waitFor(() => expect(s.store.sessionStatus(sessionId)).toBe("idle"));
        await vi.advanceTimersByTimeAsync(QUEUE_LEASE_TTL_MS / 2);
        expect(s.send).toHaveBeenCalledOnce();
        // The desktop is gone: at the end of its lease the host sends the head itself.
        await vi.advanceTimersByTimeAsync(QUEUE_LEASE_TTL_MS / 2 + 2_000);
        await vi.waitFor(() => expect(s.send).toHaveBeenCalledTimes(2));
        expect(s.turn().text).toBe("send a");
        const queue = (
          await s.call("sessions.queue.get", { sessionId, clientId: "remote:mac", ...aware })
        ).value.result;
        expect(queue.messages.map((row: { id: string }) => row.id)).toEqual(["b"]);
        // The turn it started settles and the host sends the next one, once.
        s.finish();
        await vi.waitFor(() => expect(s.send).toHaveBeenCalledTimes(3));
        expect(s.turn().text).toBe("send b");
        s.finish();
        await vi.waitFor(() => expect(s.store.sessionStatus(sessionId)).toBe("idle"));
        expect(
          (await s.call("sessions.queue.get", { sessionId, clientId: "remote:mac", ...aware }))
            .value.result.messages,
        ).toEqual([]);
        expect(s.send).toHaveBeenCalledTimes(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps an older client's queue its own while it keeps asking, and drains it when it goes quiet", async () => {
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      try {
        const s = await setup();
        const sessionId = create(s, "lease-legacy");
        s.engine.command({ type: "send", commandId: "lease-legacy-turn", sessionId, text: "busy" });
        await vi.waitFor(() => expect(s.send).toHaveBeenCalledOnce());
        const clientId = "remote:old-mac";
        // No `leaseAware`: it asks to own the queue the way it always did.
        const published = await s.call("sessions.queue.change", {
          sessionId,
          clientId,
          before: { messages: [] },
          after: { messages: rows("a"), status: "active" },
          takeOwnership: true,
        });
        expect(published.value.result.consumer).toBe(clientId);
        s.finish();
        await vi.waitFor(() => expect(s.store.sessionStatus(sessionId)).toBe("idle"));
        // It polls like it always did: still its queue, the host stays out.
        for (let i = 0; i < 4; i++) {
          await vi.advanceTimersByTimeAsync(QUEUE_LEASE_TTL_MS / 5);
          expect(
            (await s.call("sessions.queue.get", { sessionId, clientId })).value.result.consumer,
          ).toBe(clientId);
        }
        expect(s.send).toHaveBeenCalledOnce();
        // It stops (its window closed): after the lease the host sends the row.
        await vi.advanceTimersByTimeAsync(QUEUE_LEASE_TTL_MS + 5_000);
        await vi.waitFor(() => expect(s.send).toHaveBeenCalledTimes(2));
        expect(s.turn().text).toBe("send a");
        s.finish();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("run lease and claims", () => {
    const create = (s: Awaited<ReturnType<typeof setup>>, commandId: string) =>
      s.engine.command({
        type: "create",
        commandId,
        projectId: s.project.id,
        harness: "codex",
        model: "gpt",
        runtimeMode: "supervised",
      }).sessionId;
    const aware = { leaseAware: true };
    const acquire = async (
      s: Awaited<ReturnType<typeof setup>>,
      sessionId: string,
      clientId: string,
    ) => await s.call("sessions.runLease", { sessionId, clientId, action: "acquire" });
    const beat = async (
      s: Awaited<ReturnType<typeof setup>>,
      sessionId: string,
      instance: string,
      epoch: number,
    ) =>
      (
        await s.call("sessions.desktopLive", {
          clientId: instance,
          sessions: [{ id: sessionId, busy: true }],
          runLeases: [{ sessionId, epoch }],
        })
      ).value.result.runLeases;

    it("asks for a conversation the host knows, like the queue calls", async () => {
      const s = await setup();
      expect((await acquire(s, "no-such-session", "desktop:win1")).value.error).toBeTruthy();
      expect((await acquire(s, "", "desktop:win1")).value.error).toBeTruthy();
      const sessionId = create(s, "run-lease-known");
      expect((await acquire(s, sessionId, "desktop:win1")).value.result.lease).toMatchObject({
        holder: "desktop:win1",
      });
    });

    it("keeps a throttled hidden window's lease across its longest gap between beats", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        const s = await setup();
        const sessionId = create(s, "run-lease-gap");
        const lease = (await acquire(s, sessionId, "desktop:win1")).value.result.lease;
        // A hidden window beats about once a minute: the lease outlives the gap.
        vi.setSystemTime(Date.now() + 60_000);
        const refused = await s.call("commands.dispatch", {
          type: "send",
          commandId: "run-lease-gap-send",
          sessionId,
          text: "from the other computer",
        });
        expect(refused.value.error).toMatch(/LEASE_HELD/);
        expect((await beat(s, sessionId, "win1", lease.epoch))[sessionId]).toMatchObject({
          holder: "desktop:win1",
          epoch: lease.epoch,
        });
        s.finish();
      } finally {
        vi.useRealTimers();
      }
    });

    it("tells a window its run lease is lost when another side runs the conversation", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        const s = await setup();
        const sessionId = create(s, "run-lease-lost");
        const mine = (await acquire(s, sessionId, "desktop:win1")).value.result.lease;
        expect((await beat(s, sessionId, "win1", mine.epoch))[sessionId]).toMatchObject({
          epoch: mine.epoch,
        });
        // Another window runs the conversation after this one's lease ran out.
        vi.setSystemTime(Date.now() + RUN_LEASE_TTL_MS + 30_000);
        const other = (await acquire(s, sessionId, "desktop:win2")).value.result.lease;
        expect(other.holder).toBe("desktop:win2");
        expect((await beat(s, sessionId, "win1", mine.epoch))[sessionId]).toBeNull();
        expect((await beat(s, sessionId, "win2", other.epoch))[sessionId]).toMatchObject({
          holder: "desktop:win2",
        });
        s.finish();
      } finally {
        vi.useRealTimers();
      }
    });

    it("grants a lapsed lease again when nobody took the conversation, and refuses it while the host runs a turn", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        const s = await setup();
        const sessionId = create(s, "run-lease-regrant");
        const first = (await acquire(s, sessionId, "desktop:win1")).value.result.lease;
        vi.setSystemTime(Date.now() + RUN_LEASE_TTL_MS + 30_000);
        const again = (await beat(s, sessionId, "win1", first.epoch))[sessionId];
        expect(again).toMatchObject({ holder: "desktop:win1" });
        expect(again.epoch).toBeGreaterThan(first.epoch);
        // The lease lapses again and the host starts a turn of its own meanwhile.
        vi.setSystemTime(Date.now() + RUN_LEASE_TTL_MS + 30_000);
        s.engine.command({ type: "send", commandId: "run-lease-host-turn", sessionId, text: "go" });
        await vi.waitFor(() => expect(s.store.sessionStatus(sessionId)).toBe("running"));
        expect((await beat(s, sessionId, "win1", again.epoch))[sessionId]).toBeNull();
        s.finish();
      } finally {
        vi.useRealTimers();
      }
    });

    it("lets a send through once the claim of a queue send that never settled is past its grace", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        const s = await setup();
        const sessionId = create(s, "stale-claim");
        const queue = (
          await s.call("sessions.queue.change", {
            sessionId,
            clientId: "desktop:win1",
            ...aware,
            before: { messages: [] },
            after: {
              messages: [{ id: "a", text: "send a", attachments: [] }],
              status: "paused",
            },
          })
        ).value.result;
        // A "send now" claim: no lease behind it.
        const claim = await s.call("sessions.queue.claim", {
          sessionId,
          clientId: "desktop:win1",
          id: "a",
          revision: queue.revision,
          steer: true,
          ...aware,
        });
        expect(claim.value.result.claim).toBeDefined();
        const send = (commandId: string) =>
          s.call("commands.dispatch", { type: "send", commandId, sessionId, text: "hello" });
        // Within the grace the sender is believed: this is a wait.
        expect((await send("stale-claim-1")).value.error).toMatch(/LEASE_HELD/);
        vi.setSystemTime(Date.now() + CLAIM_GRACE_MS + 1_000);
        // Past it the claim is given up on, and the conversation is not blocked for good.
        expect((await send("stale-claim-2")).value.error).toBeUndefined();
        const after = (
          await s.call("sessions.queue.get", { sessionId, clientId: "desktop:win1", ...aware })
        ).value.result;
        expect(after.claim).toBeUndefined();
        expect(after.messages[0]).toMatchObject({ id: "a", deliveryUnknown: true });
        s.finish();
      } finally {
        vi.useRealTimers();
      }
    });

    it("sends a queue that waited on a usage limit as soon as the limit is dismissed", async () => {
      const s = await setup();
      const sessionId = create(s, "usage-wake");
      const current = s.store.session(sessionId);
      s.store.save(
        {
          ...current,
          revision: current.revision + 1,
          session: { ...current.session, usageLimit: { resetsAt: Date.now() + 3_600_000 } },
        },
        { type: "test.usageLimit" },
      );
      s.send.mockClear();
      await s.call("sessions.queue.change", {
        sessionId,
        clientId: "remote:mac",
        ...aware,
        before: { messages: [] },
        after: { messages: [{ id: "a", text: "send a", attachments: [] }], status: "active" },
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(s.send).not.toHaveBeenCalled();
      const dismissed = await s.call("commands.dispatch", {
        type: "usageLimit",
        commandId: "usage-wake-dismiss",
        sessionId,
        action: "dismiss",
      });
      expect(dismissed.value.error).toBeUndefined();
      await vi.waitFor(() => expect(s.send).toHaveBeenCalledOnce());
      expect(s.turn().text).toBe("send a");
      s.finish();
    });


    it("answers the queue and adopted cursors with the host's boot, so a restart resets a client", async () => {
      const first = await setup();
      const second = await setup();
      const beatOf = async (s: Awaited<ReturnType<typeof setup>>, cursors: object = {}) =>
        (await s.call("sessions.desktopLive", { clientId: "win1", sessions: [], ...cursors }))
          .value.result;
      const one = await beatOf(first);
      const two = await beatOf(second);
      expect(one.queues.boot).not.toBe(two.queues.boot);
      expect(one.adopted.boot).not.toBe(two.adopted.boot);
      // The cursor one host run issued means nothing to another.
      const stale = await beatOf(second, { queueSeq: one.queues.seq, adoptedSeq: one.adopted.seq });
      expect(stale.queues.reset).toBe(true);
      expect(stale.adopted.reset).toBe(true);
      const own = await beatOf(second, { queueSeq: two.queues.seq, adoptedSeq: two.adopted.seq });
      expect(own.queues.reset).toBeUndefined();
      expect(own.adopted.reset).toBeUndefined();
    });
  });
});

describe("project directory endpoint", () => {
  it("advertises the version and returns only the desktop's visible group projection", async () => {
    const s = await setup();
    expect((await s.call("environment.describe")).value.result.capabilities).toContain(
      "projects.directory.v1",
    );
    expect((await s.call("projects.directory", {}, "invalid")).status).toBe(401);
    expect((await s.call("projects.directory")).value.result).toMatchObject({
      privacyReady: false,
      groups: [],
      projects: [],
    });
    const one = s.store.addProject("G:/Work/shared", "One");
    // Existing databases can contain aliases from before project deduplication.
    s.store.db
      .prepare("INSERT INTO projects VALUES (?, ?, ?)")
      .run("legacy-shared-alias", "g:\\work\\shared", "Two");
    const two = s.store.project("legacy-shared-alias");
    s.store.addProject("G:/Private", "Private client");
    expect(
      (
        await s.call("sessions.desktopLive", {
          clientId: "desktop",
          sessions: [],
          projectDirectory: {
            version: 1,
            groups: [{ id: "work", name: "Work" }],
            projects: [{ cwd: "g:/work/shared", name: "Shared", groupId: "work" }],
            excludedPaths: ["g:/private"],
            excludedGroupIds: ["private"],
          },
        })
      ).status,
    ).toBe(200);
    const result = (await s.call("projects.directory")).value.result;
    expect(result.groups).toEqual([{ id: "work", name: "Work" }]);
    expect(
      result.projects.filter((project: { id: string }) => [one.id, two.id].includes(project.id)),
    ).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain("Private client");
  });
});

describe("runtime log access", () => {
  it("captures authenticated native terminal output in its owning project", async () => {
    const s = await setup();
    const packet = {
      cwd: s.project.cwd,
      terminalId: "test-terminal",
      sequence: 0,
      data: Buffer.from("✓ Ready in 10ms\nGET / 200 in 2ms\n").toString("base64"),
    };
    expect((await s.call("runtimeLogs.terminals.append", packet, "invalid")).status).toBe(401);
    expect((await s.call("runtimeLogs.terminals.append", packet)).status).toBe(200);
    const snapshot = (
      await s.call("runtimeLogs.read", { projectId: s.project.id, source: "server" })
    ).value.result;
    expect(snapshot.entries.map((entry: { message: string }) => entry.message)).toEqual([
      "✓ Ready in 10ms",
      "GET / 200 in 2ms",
    ]);
    expect(snapshot.sources).toContainEqual(
      expect.objectContaining({ kind: "server", available: true, projectId: s.project.id }),
    );
  });
  it("advertises log capture and rejects foreign project/session scopes", async () => {
    const s = await setup();
    expect((await s.call("environment.describe")).value.result.capabilities).toContain(
      "runtime.logs",
    );
    expect((await s.call("runtimeLogs.read", { projectId: "foreign" })).status).toBe(400);
    expect((await s.call("runtimeLogs.read", { sessionId: "missing" })).status).toBe(400);
    expect((await s.call("runtimeLogs.read", {}, "invalid")).status).toBe(401);
    expect(
      (await s.call("runtimeLogs.read", { projectId: s.project.id })).value.result,
    ).toMatchObject({
      entries: [],
      cursor: 0,
      dropped: 0,
    });
  });

  it("derives agent project identity and keeps log grants independent from social access", async () => {
    const s = await setup();
    const session = s.engine.command({
      type: "create",
      commandId: "log-session",
      projectId: s.project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    const social = s.server.social.issueSessionGrant(session.sessionId);
    const issued = await s.call("runtimeLogs.access.issue", { sessionId: session.sessionId });
    expect(issued.status).toBe(200);
    const grant = issued.value.result;
    expect(s.server.social.principalForToken(social.token)).toBeTruthy();
    const read = vi.spyOn(RuntimeLogsService.prototype, "read");
    try {
      expect(
        (
          await s.call(
            "runtimeLogs.tools.call",
            {
              action: "read",
              input: { search: "failure", limit: 20 },
            },
            grant.token,
          )
        ).status,
      ).toBe(200);
      expect(read).toHaveBeenLastCalledWith(
        expect.objectContaining({ projectId: s.project.id, search: "failure", limit: 20 }),
      );
      expect(
        (
          await s.call(
            "runtimeLogs.tools.call",
            {
              action: "read",
              input: { projectId: "foreign" },
            },
            grant.token,
          )
        ).status,
      ).toBe(400);
      for (const method of [
        "runtimeLogs.read",
        "runtimeLogs.terminals.append",
        "runtimeLogs.monitors.list",
        "runtimeLogs.monitors.start",
        "runtimeLogs.monitors.stop",
        "runtimeLogs.access.issue",
        "social.tools.call",
        "projects.list",
      ])
        expect((await s.call(method, {}, grant.token)).status).toBe(400);
      expect(
        (await s.call("runtimeLogs.tools.call", { action: "read", input: {} }, social.token))
          .status,
      ).toBe(400);
      expect((await s.call("runtimeLogs.tools.call", { action: "read", input: {} })).status).toBe(
        400,
      );
      s.store.revokeDevice(s.first.id);
      expect(
        (await s.call("runtimeLogs.tools.call", { action: "read", input: {} }, grant.token)).status,
      ).toBe(401);
    } finally {
      read.mockRestore();
    }
  });
});

describe("remote host API", () => {
  it("keeps mobile pairing and access RPCs limited to authenticated paired devices", async () => {
    const s = await setup();
    const session = s.engine.command({
      type: "create",
      commandId: "mobile-session-auth",
      projectId: s.project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    const grant = s.server.social.issueSessionGrant(session.sessionId);
    const methods = [
      "mobile.pairing.create",
      "mobile.pairing.status",
      "mobile.pairing.cancel",
      "mobile.access.status",
      "mobile.access.enable",
      "mobile.access.disable",
    ];
    const params = { name: "Test phone", pairingId: "11111111-1111-4111-8111-111111111111" };
    for (const method of methods) {
      expect((await s.call(method, params, "invalid")).status).toBe(401);
      const social = await s.call(method, params, grant.token);
      expect(social.status).toBe(400);
      expect(social.value.error).toContain("Session social credentials cannot access");
      expect(
        (await s.call(method, params, s.first.token, {}, { Origin: "https://untrusted.example" }))
          .status,
      ).toBe(403);
    }
    s.store.revokeDevice(s.first.id);
    for (const method of methods) expect((await s.call(method, params)).status).toBe(401);
    expect(
      (await s.call("mobile.pairing.create", { name: "Other desktop phone" }, s.second.token))
        .status,
    ).toBe(200);
  });

  it("redeems a mobile QR through the narrow public route once and rechecks issuer revocation", async () => {
    const s = await setup();
    const before = Number(s.store.db.prepare("SELECT count(*) AS count FROM devices").get()!.count);
    const created = await s.call("mobile.pairing.create", { name: "My phone" });
    expect(created.status).toBe(200);
    const ticket = created.value.result;
    expect(
      (await s.call("mobile.pairing.status", { pairingId: ticket.pairingId }, s.second.token)).value
        .result,
    ).toEqual({ state: "expired" });
    expect(
      (await s.call("mobile.pairing.cancel", { pairingId: ticket.pairingId }, s.second.token)).value
        .result,
    ).toEqual({ state: "expired" });
    const input = {
      version: 1,
      environmentId: s.store.environmentId,
      ticket: ticket.ticket,
      claimId: randomBytes(32).toString("base64url"),
      deviceName: "Test Android phone",
    };
    const redeem = async (params = input) => {
      const response = await fetch(new URL("/mobile/pairing/redeem", s.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      return { status: response.status, value: await response.json() };
    };
    const first = await redeem();
    expect(first.status).toBe(200);
    expect(await redeem()).toEqual(first);
    const paired = first.value.result;
    expect(Number(s.store.db.prepare("SELECT count(*) AS count FROM devices").get()!.count)).toBe(
      before + 1,
    );
    expect(s.store.authenticated(paired.token)).toBe(true);
    expect(
      (await s.call("environment.describe", {}, paired.token)).value.result.environmentId,
    ).toBe(s.store.environmentId);
    expect(
      (await s.call("mobile.pairing.status", { pairingId: ticket.pairingId })).value.result,
    ).toEqual({ state: "paired", deviceName: "Test Android phone" });
    expect(
      (await redeem({ ...input, claimId: randomBytes(32).toString("base64url") })).status,
    ).toBe(400);
    s.store.revokeDevice(s.first.id);
    expect((await redeem()).status).toBe(400);
    expect(Number(s.store.db.prepare("SELECT count(*) AS count FROM devices").get()!.count)).toBe(
      before,
    );
    // Revoking the issuer does not revoke a phone that was already paired.
    expect((await s.call("environment.describe", {}, paired.token)).status).toBe(200);
  });

  it("returns bounded machine change cursors and command receipt status", async () => {
    const s = await setup();
    const created = s.engine.command({
      type: "create",
      commandId: "status-create",
      projectId: s.project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    const reset = await s.call("machine.changes", {
      sessions: [{ sessionId: created.sessionId, revision: 0 }],
      projects: [{ projectId: s.project.id }],
      tasksKnown: "",
    });
    expect(reset.value.result).toMatchObject({
      reset: true,
      instanceId: expect.any(String),
      sessions: [{ sessionId: created.sessionId, revision: created.revision }],
      projects: [
        {
          projectId: s.project.id,
          etag: expect.any(String),
          sessions: expect.any(Array),
        },
      ],
    });
    expect(reset.value.result.tasks).toEqual({ etag: expect.any(String) });
    const steady = await s.call("machine.changes", {
      instanceId: reset.value.result.instanceId,
      sessions: [{ sessionId: created.sessionId, revision: created.revision }],
      projects: [{ projectId: s.project.id, known: reset.value.result.projects[0].etag }],
      tasksKnown: reset.value.result.tasks.etag,
    });
    expect(steady.value.result).toMatchObject({
      reset: false,
      sessions: [],
      projects: [],
    });
    const summaries = vi.spyOn(s.store, "summaries");
    await s.call("machine.changes", {
      instanceId: reset.value.result.instanceId,
      waitMs: 400,
      sessions: [{ sessionId: created.sessionId, revision: created.revision }],
      projects: [{ projectId: s.project.id, known: reset.value.result.projects[0].etag }],
    });
    expect(summaries.mock.calls.length).toBeLessThanOrEqual(1);
    expect(
      (await s.call("commands.status", { commandId: "status-create" })).value.result,
    ).toMatchObject({
      commandId: "status-create",
      sessionId: created.sessionId,
    });
    expect((await s.call("commands.status", { commandId: "missing" })).value.result).toBeNull();
    expect(
      (await s.call("machine.changes", { sessions: [], projects: [] }, "invalid")).status,
    ).toBe(401);
  });

  it("keeps partial sync bounded to the loaded transcript tail", async () => {
    const s = await setup();
    const created = s.engine.command({
      type: "create",
      commandId: "partial-create",
      projectId: s.project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    const base = s.store.session(created.sessionId);
    const original = {
      id: "loaded",
      role: "assistant" as const,
      text: "first",
    };
    const loaded = s.store.save(
      {
        ...base,
        revision: base.revision + 1,
        updatedAt: base.updatedAt + 1,
        session: { ...base.session, blocks: [original] },
      },
      { type: "test" },
    );
    const appended = {
      id: "appended",
      role: "assistant" as const,
      text: "second",
    };
    const current = s.store.save(
      {
        ...loaded,
        revision: loaded.revision + 1,
        updatedAt: loaded.updatedAt + 1,
        session: {
          ...loaded.session,
          blocks: [...loaded.session.blocks, appended],
        },
      },
      { type: "test" },
    );
    const loadedBlockIds = loaded.session.blocks.map((block) => block.id);
    const delta = await s.call("sessions.sync", {
      sessionId: created.sessionId,
      revision: base.revision,
      partial: true,
      loadedBlockIds,
    });
    expect(delta.status).toBe(200);
    expect(delta.value.result).toMatchObject({
      kind: "delta",
      partial: true,
      value: {
        history: {
          revision: current.revision,
          totalBlocks: current.session.blocks.length,
        },
      },
    });
    expect(delta.value.result.blockIds).toEqual(
      current.session.blocks.map((block: { id: string }) => block.id),
    );
    expect(
      (
        await s.call("sessions.sync", {
          sessionId: created.sessionId,
          partial: true,
          loadedBlockIds: ["not-present"],
        })
      ).value.result,
    ).toMatchObject({
      kind: "snapshot",
      value: { history: { revision: current.revision } },
    });
  });

  it("previews an oversized tail block and serves its full revision-pinned content on demand", async () => {
    const s = await setup();
    const created = s.engine.command({
      type: "create",
      commandId: "large-block-create",
      projectId: s.project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    const before = s.store.session(created.sessionId);
    const large = {
      id: "large-tail",
      role: "assistant" as const,
      text: "x".repeat(2_000_000),
    };
    const current = s.store.save(
      {
        ...before,
        revision: before.revision + 1,
        updatedAt: before.updatedAt + 1,
        session: { ...before.session, blocks: [large] },
      },
      { type: "test" },
    );
    const page = await s.call("sessions.page", {
      sessionId: created.sessionId,
      preview: true,
    });
    const preview = page.value.result.sync.value.session.blocks[0];
    expect(preview).toMatchObject({
      id: "large-tail",
      remoteContent: { revision: current.revision, bytes: expect.any(Number) },
    });
    expect(preview.text.length).toBeLessThan(64 * 1024);
    const legacy = await s.call("sessions.page", {
      sessionId: created.sessionId,
    });
    expect(legacy.value.result.sync.value.session.blocks[0]).toMatchObject({
      id: "large-tail",
      text: large.text,
    });
    expect(legacy.value.result.sync.value.session.blocks[0]).not.toHaveProperty("remoteContent");
    const full = await s.call("sessions.block", {
      sessionId: created.sessionId,
      blockId: "large-tail",
      revision: current.revision,
    });
    expect(full.value.result).toMatchObject({
      kind: "snapshot",
      value: {
        revision: current.revision,
        session: {
          blocks: [{ id: "large-tail", text: "x".repeat(2_000_000) }],
        },
      },
    });
    expect(
      (
        await s.call("sessions.block", {
          sessionId: created.sessionId,
          blockId: "large-tail",
          revision: current.revision - 1,
        })
      ).status,
    ).not.toBe(200);
  });

  it("accepts a command while a revision long-poll is pending", async () => {
    const s = await setup();
    const created = s.engine.command({
      type: "create",
      commandId: "longpoll-create",
      projectId: s.project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    const waiting = s.call("sessions.sync", {
      sessionId: created.sessionId,
      revision: created.revision,
      waitMs: 10_000,
    });
    const sent = await s.call("commands.dispatch", {
      type: "send",
      commandId: "longpoll-send",
      sessionId: created.sessionId,
      text: "go",
    });
    expect(sent.status).toBe(200);
    const update = await waiting;
    expect(update.value.result.kind).toBe("delta");
    expect(
      update.value.result.blocks.filter((block: { role: string }) => block.role === "user"),
    ).toHaveLength(1);
  });
  it("returns metadata for chat folder paths, including the workspace root", async () => {
    const s = await setup();
    const root = s.project.cwd.replace(/\\/g, "/");
    mkdirSync(join(s.directory, "assets"));
    writeFileSync(join(s.directory, "guide.md"), "guide");
    const response = await s.call("workspace.run", {
      command: "stat_files",
      args: {
        paths: [root, `${root}/assets`, `${root}/guide.md`, `${root}/missing`],
      },
    });
    expect(response.value.result).toEqual([
      { path: root, mtimeMs: null, isDir: true },
      { path: `${root}/assets`, mtimeMs: null, isDir: true },
      { path: `${root}/guide.md`, mtimeMs: expect.any(Number), isDir: false },
      { path: `${root}/missing`, mtimeMs: null, isDir: false },
    ]);
  });

  it("rejects a credential revoked while its request body is arriving", async () => {
    const s = await setup();
    const authenticated = vi.spyOn(s.store, "authenticated");
    const body = JSON.stringify({
      version: 1,
      environmentId: s.store.environmentId,
      method: "commands.dispatch",
      params: {
        type: "create",
        commandId: "revoked-create",
        projectId: s.project.id,
        harness: "codex",
        model: "codex:test",
        runtimeMode: "supervised",
      },
    });
    let req: ReturnType<typeof request>;
    const response = new Promise<number | undefined>((resolve, reject) => {
      req = request(
        s.url,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${s.first.token}`,
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        },
      );
      req.on("error", reject);
      req.write(body.slice(0, 1));
    });
    await vi.waitFor(() => expect(authenticated).toHaveBeenCalledTimes(1));
    s.store.revokeToken(s.first.token);
    req!.end(body.slice(1));
    expect(await response).toBe(401);
    expect(s.store.summaries(s.project.id)).toEqual([]);
  });

  it("uploads an authenticated attachment and sends its host path to the provider", async () => {
    const s = await setup();
    const id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const upload = {
      id,
      offset: 0,
      size: 5,
      data: Buffer.from("hello").toString("base64"),
    };
    expect((await s.call("attachments.upload", upload, "invalid")).status).toBe(401);
    expect((await s.call("attachments.upload", upload)).value.result).toEqual({
      offset: 5,
    });
    const created = await s.call("commands.dispatch", {
      type: "create",
      commandId: "upload-create",
      projectId: s.project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    const sessionId = created.value.result.sessionId;
    const sent = await s.call("commands.dispatch", {
      type: "send",
      commandId: "upload-send",
      sessionId,
      text: "Read this",
      attachments: [
        {
          id,
          name: "notes.txt",
          mimeType: "text/plain",
          kind: "file",
          size: 5,
        },
      ],
    });
    expect(sent.status).toBe(200);
    await vi.waitFor(() => expect(s.send).toHaveBeenCalledTimes(1));
    expect(s.turn().attachments?.[0].path).toContain(id);
    s.finish();
  });
  it("applies card actions to the owning project and lists their saved state", async () => {
    const s = await setup();
    const create = await s.call("commands.dispatch", {
      type: "create",
      commandId: "card-session",
      projectId: s.project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    const sessionId = create.value.result.sessionId;
    const changed = await s.call("sessions.update", {
      projectId: s.project.id,
      sessionId,
      title: "Codex · Card title",
      pinned: true,
    });
    expect(changed.status).toBe(200);
    expect(
      (await s.call("sessions.list", { projectId: s.project.id })).value.result[0],
    ).toMatchObject({
      id: sessionId,
      title: "Codex · Card title",
      pinned: true,
      model: "codex:test",
    });
    expect(
      (
        await s.call("sessions.update", {
          projectId: "wrong-project",
          sessionId,
          archived: true,
        })
      ).status,
    ).not.toBe(200);
    expect(
      (
        await s.call("sessions.delete", {
          projectId: "wrong-project",
          sessionId,
        })
      ).status,
    ).not.toBe(200);
    expect(
      (
        await s.call("sessions.delete", {
          projectId: s.project.id,
          sessionId,
        })
      ).status,
    ).toBe(200);
    expect((await s.call("sessions.list", { projectId: s.project.id })).value.result).toEqual([]);
  });

  it("lists, creates, and selects registered remote worktrees through RPC", async () => {
    const s = await setup();
    const git = (...args: string[]) => execFileSync("git", args, { cwd: s.project.cwd });
    git("init", "-q");
    git("config", "core.autocrlf", "false");
    git("checkout", "-q", "-b", "main");
    writeFileSync(join(s.project.cwd, ".gitignore"), "host.db*\n");
    writeFileSync(join(s.project.cwd, "file.txt"), "initial\n");
    git("add", ".gitignore", "file.txt");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-q",
      "-m",
      "initial",
    );

    const branch = await s.call("git.createBranch", {
      projectId: s.project.id,
      branch: "feature",
    });
    expect(branch.value.result.current).toBe("feature");
    expect(
      (await s.call("git.switch", { projectId: s.project.id, branch: "main" })).value.result
        .current,
    ).toBe("main");
    // Prime the allowed-root cache before creating a checkout.
    expect(
      (
        await s.call("workspace.run", {
          command: "list_dir",
          args: { path: s.project.cwd },
        })
      ).status,
    ).toBe(200);
    const created = await s.call("git.worktreeCreate", {
      projectId: s.project.id,
      branch: "feature",
      base: "HEAD",
      existing: true,
    });
    expect(created.status).toBe(200);
    const tree = created.value.result;
    cleanups.push(async () =>
      rmSync(join(s.project.cwd, "..", `${s.project.name}-worktrees`), {
        recursive: true,
        force: true,
      }),
    );
    expect(tree.branch).toBe("feature");
    expect(
      (
        await s.call("workspace.run", {
          command: "read_text_file",
          args: {
            path: join(tree.path, "file.txt"),
          },
        })
      ).value.result,
    ).toBe("initial\n");
    expect(
      (await s.call("git.worktrees", { projectId: s.project.id })).value.result.worktrees,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: tree.path, branch: "feature" })]),
    );

    const opened = await s.call("commands.dispatch", {
      type: "create",
      commandId: "in-worktree",
      projectId: s.project.id,
      worktreeCwd: tree.path,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    expect(opened.status).toBe(200);
    expect(s.store.session(opened.value.result.sessionId).session.cwd).toBe(tree.path);
    expect(
      (await s.call("sessions.list", { projectId: s.project.id })).value.result[0],
    ).toMatchObject({
      id: opened.value.result.sessionId,
      branch: "feature",
      worktreeCwd: tree.path,
      repo: s.project.name,
    });
    expect(
      (
        await s.call("commands.dispatch", {
          type: "create",
          commandId: "outside-worktree",
          projectId: s.project.id,
          worktreeCwd: tmpdir(),
          harness: "codex",
          model: "codex:test",
          runtimeMode: "supervised",
        })
      ).value.error,
    ).toContain("available worktree");

    writeFileSync(join(tree.path, "file.txt"), "changed\n");
    expect(
      (await s.call("git.diff", { projectId: s.project.id, cwd: tree.path })).value.result,
    ).toContain("changed");
  });
  it("retries model discovery after a provider becomes available", async () => {
    const s = await setup();
    modelProbe.mockClear();
    modelProbe.mockRejectedValueOnce(new Error("Login required"));
    modelProbe.mockResolvedValueOnce([{ id: "codex:test", name: "Test" }]);
    const first = await s.call("models.list", { projectId: s.project.id });
    expect(first.value.result.errors.codex).toBe("Login required");
    // A failed provider backs off between ordinary reads, so a refresh storm
    // cannot re-run a failing login probe; an explicit refresh retries at once.
    const backedOff = await s.call("models.list", { projectId: s.project.id });
    expect(backedOff.value.result.errors.codex).toBe("Login required");
    expect(modelProbe).toHaveBeenCalledTimes(1);
    const second = await s.call("models.list", { projectId: s.project.id, refresh: true });
    expect(second.value.result.models.codex).toEqual([{ id: "codex:test", name: "Test" }]);
    expect(modelProbe).toHaveBeenCalledTimes(2);
  });
  it("retries failed model discovery on an ordinary read once the backoff elapses", async () => {
    const s = await setup();
    modelProbe.mockClear();
    modelProbe.mockRejectedValueOnce(new Error("Login required"));
    modelProbe.mockResolvedValueOnce([{ id: "codex:test", name: "Test" }]);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const first = await s.call("models.list", { projectId: s.project.id });
      expect(first.value.result.errors.codex).toBe("Login required");
      vi.setSystemTime(Date.now() + 30_000);
      const second = await s.call("models.list", { projectId: s.project.id });
      expect(second.value.result.models.codex).toEqual([{ id: "codex:test", name: "Test" }]);
    } finally {
      vi.useRealTimers();
    }
    expect(modelProbe).toHaveBeenCalledTimes(2);
  });
  it("advertises newer providers only to desktops that request them", async () => {
    const s = await setup(["codex", "cursor"]);
    expect((await s.call("environment.describe")).value.result.providers).toEqual(["codex"]);
    expect(
      (
        await s.call("environment.describe", {
          supportedProviders: ["codex", "cursor"],
        })
      ).value.result.providers,
    ).toEqual(["codex", "cursor"]);
  });
  it("re-probes models after the provider CLI is updated", async () => {
    const s = await setup();
    cleanups.push(async () => {
      delete binaries.codex;
    });
    writeFileSync(join(s.directory, "codex-1"), "");
    writeFileSync(join(s.directory, "codex-2"), "");
    binaries.codex = join(s.directory, "codex-1");
    modelProbe.mockClear();
    modelProbe.mockResolvedValueOnce([{ id: "codex:old", name: "Old" }]);
    modelProbe.mockResolvedValueOnce([{ id: "codex:new", name: "New" }]);
    const list = async () =>
      (await s.call("models.list", { projectId: s.project.id })).value.result.models.codex;
    expect(await list()).toEqual([{ id: "codex:old", name: "Old" }]);
    expect(await list()).toEqual([{ id: "codex:old", name: "Old" }]);
    binaries.codex = join(s.directory, "codex-2");
    expect(await list()).toEqual([{ id: "codex:new", name: "New" }]);
    expect(modelProbe).toHaveBeenCalledTimes(2);
  });
  it("re-probes models once the catalog is five minutes old", async () => {
    const s = await setup();
    modelProbe.mockClear();
    modelProbe.mockResolvedValueOnce([{ id: "codex:old", name: "Old" }]);
    modelProbe.mockResolvedValueOnce([{ id: "codex:new", name: "New" }]);
    const list = async () =>
      (await s.call("models.list", { projectId: s.project.id })).value.result.models.codex;
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      expect(await list()).toEqual([{ id: "codex:old", name: "Old" }]);
      vi.setSystemTime(Date.now() + 4 * 60_000);
      expect(await list()).toEqual([{ id: "codex:old", name: "Old" }]);
      vi.setSystemTime(Date.now() + 60_000);
      expect(await list()).toEqual([{ id: "codex:new", name: "New" }]);
    } finally {
      vi.useRealTimers();
    }
    expect(modelProbe).toHaveBeenCalledTimes(2);
  });
  it("lets an authenticated desktop browse host folders without reading files", async () => {
    const s = await setup();
    mkdirSync(join(s.directory, "checkout"));
    writeFileSync(join(s.directory, "private.txt"), "secret");
    const listed = await s.call("projects.browse", { path: s.directory });
    expect(listed.status).toBe(200);
    expect(listed.value.result.entries).toEqual([
      { name: "checkout", path: join(s.directory, "checkout") },
    ]);
    expect((await s.call("projects.browse", { path: s.directory }, "invalid")).status).toBe(401);
  });
  it("allows a different client to recover work completed while the laptop was disconnected", async () => {
    const s = await setup();
    const create = await s.call("commands.dispatch", {
      type: "create",
      commandId: "create",
      projectId: s.project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    const id = create.value.result.sessionId;
    const command = {
      type: "send",
      commandId: "send",
      sessionId: id,
      text: "Work without this client",
    };
    await s.call("commands.dispatch", command);
    await vi.waitFor(() => expect(s.send).toHaveBeenCalledTimes(1));
    s.turn().onEvent({ type: "message.delta", text: "Finished on the host" });
    s.finish();
    await vi.waitFor(() => expect(s.store.session(id).status).toBe("idle"));
    const recovered = await s.call("sessions.get", { sessionId: id }, s.second.token);
    expect(recovered.value.result.session.blocks.at(-1).text).toBe("Finished on the host");
    await s.call("commands.dispatch", command, s.second.token);
    expect(s.send).toHaveBeenCalledTimes(1);
  });

  it("rejects revoked devices, browser origins, and changed host identities", async () => {
    const s = await setup();
    expect((await s.call("environment.describe", {}, "invalid")).status).toBe(401);
    expect(
      (
        await s.call(
          "environment.describe",
          {},
          s.first.token,
          {},
          { Origin: "https://untrusted.example" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await s.call("projects.list", {}, s.first.token, {
          environmentId: "different-host",
        })
      ).value.error,
    ).toContain("identity changed");
    // Revoked from a separate connection, as the CLI does.
    const other = new DatabaseSync(s.store.db.location()!);
    other.prepare("DELETE FROM devices WHERE id=?").run(s.first.id);
    other.close();
    expect((await s.call("environment.describe")).status).toBe(401);
    expect((await s.call("environment.describe", {}, s.second.token)).status).toBe(200);
  });

  it("lets a desktop revoke only its own credential, keeping sessions", async () => {
    const s = await setup();
    const create = await s.call("commands.dispatch", {
      type: "create",
      commandId: "create",
      projectId: s.project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    const id = create.value.result.sessionId;
    expect((await s.call("devices.revokeSelf")).value.result).toEqual({
      revoked: true,
    });
    expect((await s.call("environment.describe")).status).toBe(401);
    const other = await s.call("sessions.sync", { sessionId: id }, s.second.token);
    expect(other.value.result.value.session.id).toBe(id);
  });

  it("reads host files while rejecting traversal and symlink escapes", async () => {
    const s = await setup();
    writeFileSync(join(s.directory, "hello.txt"), "from host");
    expect(
      await s.call("files.read", {
        projectId: s.project.id,
        cwd: s.project.cwd,
        path: "hello.txt",
      }),
    ).toEqual({ status: 200, value: { result: "from host" } });
    expect(
      await s.call("files.write", {
        projectId: s.project.id,
        path: "hello.txt",
        expected: "from host",
        content: "edited",
      }),
    ).toEqual({ status: 200, value: { result: null } });
    expect(
      (
        await s.call("files.read", {
          projectId: s.project.id,
          path: "hello.txt",
        })
      ).value.result,
    ).toBe("edited");
    symlinkSync(
      tmpdir(),
      join(s.directory, "outside"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(
      (await s.call("files.read", { projectId: s.project.id, path: "outside" })).value.error,
    ).toContain("outside");
    const sibling = `${s.directory}-outside.txt`;
    writeFileSync(sibling, "must not be exposed");
    try {
      expect(
        (await s.call("files.read", { projectId: s.project.id, path: sibling })).value.error,
      ).toContain("outside");
    } finally {
      rmSync(sibling);
    }
    expect(
      (await s.call("files.read", { projectId: s.project.id, path: ".." })).value.error,
    ).toContain("outside");
  });

  it("browses folders outside projects without granting content or mutation access", async () => {
    const s = await setup();
    const outside = mkdtempSync(join(tmpdir(), "bycoda-artifacts-"));
    cleanups.push(async () => rmSync(outside, { recursive: true, force: true }));
    mkdirSync(join(outside, "archive"));
    const file = join(outside, "installer.exe");
    writeFileSync(file, "private binary contents");
    const run = async (command: string, args: Record<string, unknown>) =>
      (await s.call("workspace.run", { command, args })).value;
    const folder = (await run("browse_dir", { path: file, containing: true })).result;
    expect(folder).toMatchObject({ path: outside, canOpenFiles: false });
    expect(folder.entries.map((entry: { name: string }) => entry.name)).toEqual([
      "archive",
      "installer.exe",
    ]);
    expect(JSON.stringify(folder)).not.toContain("private binary contents");
    expect((await run("browse_dir", { path: join(outside, "archive") })).result.parent).toBe(
      outside,
    );
    for (const command of [
      "list_dir",
      "read_text_file",
      "read_binary_file",
      "read_file_preview",
      "delete_path",
    ])
      expect((await run(command, { path: file })).error).toContain("outside");
    expect((await run("write_text_file", { path: file, content: "changed" })).error).toContain(
      "outside",
    );
    expect(
      (await run("create_path", { parent: outside, name: "new.txt", isDir: false })).error,
    ).toContain("outside");
    expect(
      (
        await s.call(
          "workspace.run",
          { command: "browse_dir", args: { path: outside } },
          "invalid-token",
        )
      ).status,
    ).toBe(401);
    expect((await run("browse_dir", { path: s.project.cwd })).result.canOpenFiles).toBe(true);
    const linked = join(s.project.cwd, "artifacts");
    symlinkSync(outside, linked, process.platform === "win32" ? "junction" : "dir");
    expect((await run("browse_dir", { path: linked })).result.canOpenFiles).toBe(false);
    expect(
      (await run("read_binary_file", { path: join(linked, "installer.exe") })).error,
    ).toContain("outside");
  });

  it("answers this app's file commands inside host projects only", async () => {
    const s = await setup();
    const outside = mkdtempSync(join(tmpdir(), "bycoda-outside-"));
    cleanups.push(async () => rmSync(outside, { recursive: true, force: true }));
    const checkout = join(s.directory, "checkout");
    mkdirSync(join(checkout, "src"), { recursive: true });
    writeFileSync(join(checkout, "src", "app.ts"), "before\n");
    const project = await s.engine.openProject(checkout);
    const root = project.cwd.replace(/\\/g, "/");
    const run = async (command: string, args: Record<string, unknown>) =>
      (await s.call("workspace.run", { command, args })).value;

    expect((await run("list_dir", { path: root })).result).toEqual([
      { name: "src", path: `${root}/src`, isDir: true, ignored: false },
    ]);
    expect((await run("read_text_file", { path: `${root}/src/app.ts` })).result).toBe("before\n");
    expect((await run("read_binary_file", { path: `${root}/src/app.ts` })).result).toBe(
      Buffer.from("before\n").toString("base64"),
    );
    await run("write_text_file", {
      path: `${root}/src/app.ts`,
      content: "after\n",
    });
    expect((await run("read_text_file", { path: `${root}/src/app.ts` })).result).toBe("after\n");
    const [stat] = (await run("stat_files", { paths: [`${root}/src/app.ts`, `${root}/nope`] }))
      .result;
    expect(stat).toMatchObject({ path: `${root}/src/app.ts` });
    expect(typeof stat.mtimeMs).toBe("number");

    expect(
      (
        await run("create_path", {
          parent: root,
          name: "docs/a.md",
          isDir: false,
        })
      ).result,
    ).toBe(`${root}/docs/a.md`);
    expect(
      (
        await run("create_path", {
          parent: root,
          name: "docs/a.md",
          isDir: false,
        })
      ).error,
    ).toContain("already exists");
    expect((await run("rename_path", { path: `${root}/docs/a.md`, name: "b.md" })).result).toBe(
      `${root}/docs/b.md`,
    );
    expect(
      (
        await run("copy_path", {
          from: `${root}/docs/b.md`,
          destParent: `${root}/docs`,
        })
      ).result,
    ).toBe(`${root}/docs/b copy.md`);
    expect(
      (
        await run("move_path", {
          from: `${root}/docs/b.md`,
          destParent: `${root}/src`,
        })
      ).result,
    ).toBe(`${root}/src/b.md`);
    await run("delete_path", { path: `${root}/docs` });
    expect(
      (await run("list_project_files", { cwd: root })).result
        .map((file: { relative: string }) => file.relative)
        .sort(),
    ).toEqual(["src/app.ts", "src/b.md"]);
    expect(
      (await s.call("files.index", { projectId: project.id, cwd: root })).value.result,
    ).toEqual(["src/app.ts", "src/b.md"]);

    const git = (...args: string[]) => execFileSync("git", args, { cwd: root });
    git("init", "-q");
    git("config", "user.name", "Host Test");
    git("config", "user.email", "host@example.test");
    git("add", "src");
    git("commit", "-qm", "initial");
    writeFileSync(join(root, "src", "app.ts"), "changed\n");
    expect(
      (
        await run("search_project", {
          options: { cwd: root, query: "changed" },
        })
      ).result.matches,
    ).toContainEqual(
      expect.objectContaining({
        path: `${root}/src/app.ts`,
        relative: "src/app.ts",
        line: 1,
      }),
    );
    const gitIndex = (await run("git_diff_index", { cwd: root })).result;
    expect(gitIndex.files).toContainEqual(
      expect.objectContaining({
        path: "src/app.ts",
        relative: "src/app.ts",
        unstaged: true,
      }),
    );
    expect(
      (
        await run("git_file_diff", {
          cwd: root,
          relative: "src/app.ts",
          staged: false,
        })
      ).result,
    ).toMatchObject({ original: "after\n", current: "changed\n" });
    await run("git_stage_file", { cwd: root, relative: "src/app.ts" });
    expect((await run("git_diff_index", { cwd: root })).result.files).toContainEqual(
      expect.objectContaining({ relative: "src/app.ts", staged: true }),
    );
    expect(
      (await run("git_unstage_files", { cwd: root, relatives: ["src/app.ts"] })).error,
    ).toBeFalsy();
    expect((await run("git_diff_index", { cwd: root })).result.files).toContainEqual(
      expect.objectContaining({ relative: "src/app.ts", staged: false, unstaged: true }),
    );
    expect(
      (await run("git_stage_files", { cwd: root, relatives: ["src/app.ts"] })).error,
    ).toBeFalsy();
    expect((await run("git_diff_index", { cwd: root })).result.files).toContainEqual(
      expect.objectContaining({ relative: "src/app.ts", staged: true }),
    );
    const history = (await run("git_history", { cwd: root, limit: 10 })).result;
    expect(history.commits[0]).toMatchObject({
      subject: "initial",
      head: true,
    });
    expect(history.commits[0].timestamp).toBeLessThan(10_000_000_000);
    expect((await run("git_commit_files", { cwd: root, sha: history.head })).result).toContainEqual(
      expect.objectContaining({ relative: "src/app.ts", additions: 1 }),
    );
    expect(
      (
        await run("git_commit_file_diff", {
          cwd: root,
          sha: history.head,
          relative: "src/app.ts",
        })
      ).result,
    ).toMatchObject({ original: "", current: "after\n", status: "added" });
    expect((await run("git_worktrees", { cwd: root })).result.worktrees).toContainEqual(
      expect.objectContaining({ path: project.cwd, isMain: true }),
    );

    for (const path of [outside, `${root}/../outside`, `${root}/.git/config`])
      expect((await run("read_text_file", { path })).error).toBeTruthy();
    expect(
      (await run("write_text_file", { path: join(outside, "x"), content: "x" })).error,
    ).toContain("outside");
    expect((await run("delete_path", { path: root })).error).toBeTruthy();
    expect((await run("rm_rf", { path: root })).error).toContain("Unsupported");
  });

  it("browses and commits changes in the host checkout", async () => {
    const s = await setup();
    const checkout = join(s.directory, "checkout");
    mkdirSync(checkout);
    const project = await s.engine.openProject(checkout);
    const git = (...args: string[]) => execFileSync("git", args, { cwd: checkout });
    git("init", "-q");
    git("config", "user.name", "Host Test");
    git("config", "user.email", "host@example.test");
    mkdirSync(join(checkout, "src"));
    writeFileSync(join(checkout, "src", "app.ts"), "before\n");
    git("add", "--", ".");
    git("commit", "-qm", "initial");
    writeFileSync(join(checkout, "src", "app.ts"), "after\n");
    writeFileSync(join(checkout, "new.ts"), "new\n");

    const root = await s.call("files.list", {
      projectId: project.id,
      path: "",
    });
    expect(root.status).toBe(200);
    expect(root.value.result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "src", isDir: true }),
        expect.objectContaining({ name: "new.ts", isDir: false }),
      ]),
    );
    expect(
      (
        await s.call("files.search", {
          projectId: project.id,
          query: "app",
        })
      ).value.result,
    ).toEqual([expect.objectContaining({ path: "src/app.ts" })]);
    expect(
      (
        await s.call("files.searchContent", {
          projectId: project.id,
          query: "after",
        })
      ).value.result,
    ).toMatchObject({
      matches: [expect.objectContaining({ relative: "src/app.ts", line: 1 })],
      truncated: false,
    });
    expect(
      (await s.call("files.list", { projectId: project.id, path: "src" })).value.result[0].name,
    ).toBe("app.ts");
    expect(
      (await s.call("files.list", { projectId: project.id, path: ".." })).value.error,
    ).toContain("outside");
    expect(
      (
        await s.call("files.list", {
          projectId: project.id,
          cwd: s.directory,
          path: "",
        })
      ).value.error,
    ).toContain("worktree");

    const index = await s.call("git.index", { projectId: project.id });
    expect(index.value.result.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relative: "src/app.ts",
          status: "modified",
          unstaged: true,
        }),
        expect.objectContaining({
          relative: "new.ts",
          status: "untracked",
          unstaged: true,
        }),
      ]),
    );
    const diff = await s.call("git.fileDiff", {
      projectId: project.id,
      path: "src/app.ts",
      staged: false,
    });
    expect(diff.value.result).toMatchObject({
      original: "before\n",
      current: "after\n",
    });
    expect(
      (
        await s.call("git.action", {
          projectId: project.id,
          action: "stage",
          path: "../escape",
        })
      ).value.error,
    ).toContain("outside");
    expect(
      (
        await s.call("git.action", {
          projectId: project.id,
          action: "stageContents",
          path: "src/app.ts",
          content: "selected\n",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await s.call("git.fileDiff", {
          projectId: project.id,
          path: "src/app.ts",
          staged: true,
        })
      ).value.result.current,
    ).toBe("selected\n");
    expect(
      (
        await s.call("git.action", {
          projectId: project.id,
          action: "stageAll",
        })
      ).status,
    ).toBe(200);
    const staged = await s.call("git.index", { projectId: project.id });
    expect(staged.value.result.files.every((file: { staged: boolean }) => file.staged)).toBe(true);
    expect(
      (
        await s.call("git.action", {
          projectId: project.id,
          action: "commit",
          message: "remote commit",
        })
      ).status,
    ).toBe(200);
    expect((await s.call("git.index", { projectId: project.id })).value.result.files).toEqual([]);
  });
  it("answers the git.actions commands, advertised as a capability", async () => {
    const s = await setup();
    expect((await s.call("environment.describe")).value.result.capabilities).toEqual(
      expect.arrayContaining(["git.actions", "git.conflicts"]),
    );
    const checkout = join(s.directory, "actions");
    mkdirSync(checkout);
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: checkout, encoding: "utf8" }).trim();
    git("init", "-q");
    git("checkout", "-q", "-b", "main");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.test");
    git("config", "commit.gpgsign", "false");
    writeFileSync(join(checkout, "a.txt"), "one\n");
    git("add", "a.txt");
    git("commit", "-q", "-m", "first");
    const head = git("rev-parse", "HEAD");
    const project = await s.engine.openProject(checkout);
    const cwd = project.cwd.replace(/\\/g, "/");
    const run = async (command: string, args: Record<string, unknown> = {}) =>
      (await s.call("workspace.run", { command, args: { cwd, ...args } })).value;

    expect((await run("git_tags")).result).toEqual([]);
    expect((await run("git_create_tag", { name: "v1", sha: head })).error).toBeUndefined();
    expect((await run("git_tags")).result).toEqual(["v1"]);
    expect((await run("git_operation_status")).result).toEqual({
      operation: null,
      conflicts: [],
    });
    expect((await run("git_blame", { relative: "a.txt" })).result).toHaveLength(1);
    // Nothing is conflicted: the index says so, and there is nothing to compare.
    expect((await run("git_diff_index")).result).toMatchObject({
      conflicts: [],
      operation: null,
    });
    expect((await run("git_conflict_stages", { relative: "a.txt" })).error).toContain(
      "no merge conflict",
    );
    expect((await run("git_reset", { sha: "--hard", mode: "hard" })).error).toBe("Invalid commit");
    expect((await run("git_blame", { relative: "../a.txt" })).error).toContain("outside");

    // History: the default graph follows HEAD; `all` adds other branches.
    git("checkout", "-q", "-b", "side");
    writeFileSync(join(checkout, "b.txt"), "side\n");
    git("add", "b.txt");
    git("commit", "-q", "-m", "side work");
    git("checkout", "-q", "main");
    const subjects = async (all: boolean) =>
      (await run("git_history", { all })).result.commits.map(
        (commit: { subject: string }) => commit.subject,
      );
    expect(await subjects(false)).toEqual(["first"]);
    expect(await subjects(true)).toEqual(["side work", "first"]);

    // Commit sign-off.
    writeFileSync(join(checkout, "a.txt"), "two\n");
    git("add", "a.txt");
    expect(
      (
        await run("git_commit", {
          message: "signed",
          amend: false,
          signoff: true,
        })
      ).error,
    ).toBeUndefined();
    expect(git("log", "-1", "--format=%B")).toContain("Signed-off-by: Test <test@example.test>");

    // Only folders of this host's projects are served.
    const outside = mkdtempSync(join(tmpdir(), "bycoda-outside-"));
    cleanups.push(async () => rmSync(outside, { recursive: true, force: true }));
    const refused = (
      await s.call("workspace.run", {
        command: "git_tags",
        args: { cwd: outside.replace(/\\/g, "/") },
      })
    ).value;
    expect(refused.error).toContain("outside");

    // Like a branch switch, rewriting history waits for running sessions.
    await expect(
      s.engine.withIdleProject(
        project.id,
        async () => (await run("git_reset", { sha: head, mode: "soft" })).error,
      ),
    ).resolves.toBe("A branch switch is already in progress");
    expect((await run("git_reset", { sha: head, mode: "soft" })).error).toBeUndefined();
  });

  it("accepts sync pushes and pulls, rejecting a stale push", async () => {
    const s = await setup();
    const pushed = await s.call("sync.push", {
      ops: [
        {
          table: "group",
          id: "g1",
          baseRev: 0,
          value: { id: "g1", name: "Work", collapsed: false },
        },
      ],
    });
    expect(pushed.value.result.applied).toEqual([
      { table: "group", id: "g1", rev: pushed.value.result.rev },
    ]);

    const pulled = await s.call("sync.pull", { sinceRev: 0 });
    expect(pulled.value.result.records).toEqual([
      {
        table: "group",
        id: "g1",
        rev: pushed.value.result.rev,
        value: { id: "g1", name: "Work", collapsed: false },
      },
    ]);

    const stale = await s.call("sync.push", {
      ops: [
        {
          table: "group",
          id: "g1",
          baseRev: 0,
          value: { id: "g1", name: "Renamed", collapsed: false },
        },
      ],
    });
    expect(stale.value.result.applied).toEqual([]);
    expect(stale.value.result.rejected).toHaveLength(1);
  });

  it("skips a malformed sync op without failing the rest of the push", async () => {
    const s = await setup();
    const pushed = await s.call("sync.push", {
      ops: [
        {
          table: "group",
          id: "g9",
          baseRev: 0,
          value: { id: "g9", name: "Kept", collapsed: false },
        },
        null,
      ],
    });
    expect(pushed.status).toBe(200);
    expect(pushed.value.result.applied).toHaveLength(1);
    expect(pushed.value.result.rejected).toEqual([]);

    const pulled = await s.call("sync.pull", { sinceRev: 0 });
    expect(JSON.stringify(pulled.value.result.records)).toContain("g9");
  });

  it("advertises the sync capability", async () => {
    const s = await setup();
    const described = await s.call("environment.describe");
    expect(described.value.result.capabilities).toContain("sync");
  });

  it("two desktops converge on the same group after a disconnect with edits on both sides", async () => {
    const s = await setup();
    // Desktop A pushes a new group.
    const a = await s.call("sync.push", {
      ops: [
        {
          table: "group",
          id: "g1",
          baseRev: 0,
          value: { id: "g1", name: "From A", collapsed: false },
        },
      ],
    });
    expect(a.value.result.rejected).toEqual([]);

    // Desktop B, still at revision 0, pulls and catches up.
    const bPull = await s.call("sync.pull", { sinceRev: 0 });
    expect(bPull.value.result.records).toHaveLength(1);
    const bRev = bPull.value.result.rev;

    // Both edit the same group while "disconnected" from each other (each
    // still believes the revision it last pulled).
    const bPush = await s.call("sync.push", {
      ops: [
        {
          table: "group",
          id: "g1",
          baseRev: bRev,
          value: { id: "g1", name: "From B", collapsed: false },
        },
      ],
    });
    expect(bPush.value.result.applied).toHaveLength(1);

    // A, still at the revision from its own first push, tries to edit too —
    // this is the "concurrent edit" case: A's base revision is now stale.
    const aRetry = await s.call("sync.push", {
      ops: [
        {
          table: "group",
          id: "g1",
          baseRev: a.value.result.applied[0].rev,
          value: { id: "g1", name: "From A again", collapsed: false },
        },
      ],
    });
    expect(aRetry.value.result.rejected).toHaveLength(1);
    const winning = aRetry.value.result.rejected[0].current;

    // Both sides pull and land on the same value: whichever write actually
    // reached the host last (B's).
    const finalPull = await s.call("sync.pull", { sinceRev: 0 });
    const finalGroup = finalPull.value.result.records.find((r: any) => r.id === "g1");
    expect(finalGroup.value).toEqual(winning.value);
    expect(finalGroup.value.name).toBe("From B");
  });

  it("answers the task board commands, advertised as a capability", async () => {
    const s = await setup();
    expect((await s.call("environment.describe")).value.result.capabilities).toContain("tasks");
    expect((await s.call("environment.describe")).value.result.capabilities).toContain(
      "tasks.todo",
    );
    const task = {
      id: "main",
      title: "Ship the report",
      prompt: "Write the weekly report",
      projectId: s.project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "auto",
    };
    const saved = await s.call("tasks.save", { task });
    expect(saved.value.result).toMatchObject({ id: "main", status: "queued" });
    expect((await s.call("tasks.list")).value.result).toEqual([saved.value.result]);
    const refused = await s.call("tasks.move", { taskId: "main", to: "done" });
    expect(refused.value.error).toBe("A queued task cannot be moved to done.");
    const todo = await s.call("tasks.save", {
      task: { ...task, id: "idea", prompt: "", status: "todo" },
    });
    expect(todo.value.result).toMatchObject({ id: "idea", status: "todo" });
    expect((await s.call("tasks.move", { taskId: "idea", to: "queued" })).value.error).toBe(
      "Add a description before starting this task with an agent.",
    );
    await s.call("tasks.delete", { taskId: "idea" });
    expect((await s.call("tasks.delete", { taskId: "main" })).value.result).toEqual({
      deleted: true,
    });
    expect((await s.call("tasks.list")).value.result).toEqual([]);
  });

  it("routes review note read and resolve updates without completing the task", async () => {
    const s = await setup();
    expect((await s.call("environment.describe")).value.result.capabilities).toContain(
      "tasks.notes",
    );
    expect((await s.call("environment.describe")).value.result.capabilities).toContain(
      "tasks.review-recheck",
    );
    const saved = (
      await s.call("tasks.save", {
        task: {
          id: "notes",
          title: "Ship the report",
          prompt: "Write it",
          projectId: s.project.id,
          harness: "codex",
          model: "codex:test",
          runtimeMode: "auto",
          status: "todo",
        },
      })
    ).value.result;
    const reviewNotes = ["seen", "newer"].map((id) => ({
      id,
      finding: id,
      kind: "finding",
      createdAt: 1,
      updatedAt: 1,
      occurrences: 1,
    }));
    s.store.db
      .prepare("UPDATE tasks SET value=? WHERE id=?")
      .run(JSON.stringify({ ...saved, reviewNotes }), saved.id);
    const read = (await s.call("tasks.notes.read", { taskId: saved.id, noteIds: ["seen"] })).value
      .result;
    expect(read.reviewNotes[0].readAt).toEqual(expect.any(Number));
    expect(read.reviewNotes[1].readAt).toBeUndefined();
    const fixed = (
      await s.call("tasks.notes.resolve", {
        taskId: saved.id,
        noteId: "seen",
        resolved: true,
      })
    ).value.result;
    expect(fixed.status).toBe("todo");
    expect(fixed.reviewNotes[0].resolvedAt).toEqual(expect.any(Number));
    expect(
      (
        await s.call("tasks.notes.resolve", {
          taskId: saved.id,
          noteId: "missing",
          resolved: true,
        })
      ).value.error,
    ).toBe("Review note not found.");
    const reopened = (
      await s.call("tasks.notes.resolve", {
        taskId: saved.id,
        noteId: "seen",
        resolved: false,
      })
    ).value.result;
    expect(reopened.reviewNotes[0].resolvedAt).toBeUndefined();
    expect((await s.call("tasks.list")).value.result[0].reviewNotes).toEqual(reopened.reviewNotes);
    expect((await s.call("tasks.review.recheck", { taskId: saved.id })).value.error).toContain(
      "Only a blocked task",
    );
  });

  it("answers the goal commands, advertised as a capability", async () => {
    const s = await setup();
    expect((await s.call("environment.describe")).value.result.capabilities).toContain("goals");
    expect((await s.call("environment.describe")).value.result.capabilities).toContain(
      "goals.direct-checkout",
    );
    const goal = {
      id: "launch",
      title: "Launch the beta",
      prompt: "Ship the beta",
      projectIds: [s.project.id],
      leadProjectId: s.project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "auto",
    };
    const created = await s.call("goals.create", { goal });
    expect((await s.call("environment.describe")).value.result.capabilities).toContain(
      "goals.settings",
    );
    const edited = await s.call("goals.update", {
      goalId: "launch",
      expectedUpdatedAt: created.value.result.updatedAt,
      settings: { autoMerge: true, continueUntilDone: true, maxRunningTasks: 1, maxRunMinutes: 0 },
    });
    expect(edited.value.result).toMatchObject({
      autoMerge: true,
      continueUntilDone: true,
      maxRunningTasks: 1,
    });
    expect(created.value.result).toMatchObject({
      id: "launch",
      status: "planning",
      taskIds: [],
    });
    expect((await s.call("goals.list")).value.result).toMatchObject([
      { id: "launch", status: "planning" },
    ]);
    const refused = await s.call("goals.approve", { goalId: "launch" });
    expect(refused.value.error).toBe("Only a plan waiting for approval can be approved.");
    expect((await s.call("goals.replan", { goalId: "launch" })).value.error).toBe(
      "Only a goal whose plan was not started can be planned again.",
    );
    expect((await s.call("goals.cancel", { goalId: "launch" })).value.result).toMatchObject({
      status: "cancelled",
    });
    expect((await s.call("goals.delete", { goalId: "launch" })).value.result).toEqual({
      deleted: true,
    });
    expect((await s.call("goals.list")).value.result).toEqual([]);
  });
});

describe("host settings commands", () => {
  it("answers host.settings.get and save, advertised as a capability", async () => {
    const s = await setup();
    expect((await s.call("environment.describe")).value.result.capabilities).toContain(
      "host.settings",
    );
    expect((await s.call("host.settings.get")).value.result).toEqual({
      maxRunningTasks: 2,
      dailyAgentMinutes: 0,
      usedMinutes: 0,
      limitReached: false,
    });
    const saved = await s.call("host.settings.save", {
      settings: { maxRunningTasks: 4, dailyAgentMinutes: 240 },
    });
    expect(saved.value.result).toMatchObject({
      maxRunningTasks: 4,
      dailyAgentMinutes: 240,
      limitReached: false,
    });
    expect((await s.call("host.settings.get")).value.result).toMatchObject({
      maxRunningTasks: 4,
      dailyAgentMinutes: 240,
    });
    expect(
      (await s.call("host.settings.save", { settings: { maxRunningTasks: 9 } })).value.error,
    ).toBe("Invalid concurrent task limit");
  });
});

it("previews a transcript above 16 MiB with revision-only unchanged polls and bounded summaries", async () => {
  const s = await setup();
  const created = s.engine.command({
    type: "create",
    commandId: "large-task-preview",
    projectId: s.project.id,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
  });
  const before = s.store.session(created.sessionId);
  const blocks = Array.from({ length: 200 }, (_, at) => ({
    id: String(at),
    role: "assistant" as const,
    text: "x".repeat(100000),
  }));
  blocks.unshift({ id: "note", role: "system" as never, text: "Retained early note" });
  const current = s.store.save(
    { ...before, revision: before.revision + 1, session: { ...before.session, blocks } },
    { type: "test" },
  );
  expect(Buffer.byteLength(JSON.stringify(current))).toBeGreaterThan(16 * 1024 * 1024);
  const page = (await s.call("sessions.page", { sessionId: current.session.id, preview: true }))
    .value.result;
  const result = (await s.call("sessions.get", { sessionId: current.session.id, preview: true }))
    .value.result;
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(1024 * 1024);
  expect(result.history.totalBlocks).toBe(201);
  expect(
    (
      await s.call("sessions.get", {
        sessionId: current.session.id,
        preview: true,
        revision: current.revision,
      })
    ).value.result,
  ).toBeNull();
  const summary = (
    await s.call("sessions.get", { sessionId: current.session.id, preview: true, summary: true })
  ).value.result;
  expect(summary.session.blocks.map((block: { id: string }) => block.id)).toEqual(["199", "note"]);
  expect(Buffer.byteLength(JSON.stringify(summary))).toBeLessThan(140000);
  const history = (
    await s.call("sessions.page", {
      sessionId: current.session.id,
      before: page.before,
      revision: current.revision,
      preview: true,
    })
  ).value.result;
  expect(history.sync.value.session.blocks.length).toBeGreaterThan(2);
  const approval = {
    id: "approval",
    role: "tool" as const,
    text: "Approve command",
    approval: { decided: false },
  };
  s.store.save(
    {
      ...current,
      revision: current.revision + 1,
      status: "running",
      session: { ...current.session, blocks: [approval as never, ...blocks] },
    },
    { type: "test" },
  );
  const waiting = (
    await s.call("sessions.get", { sessionId: current.session.id, preview: true, summary: true })
  ).value.result;
  expect(
    waiting.session.blocks.some(
      (block: { approval?: { decided?: boolean } }) => block.approval && !block.approval.decided,
    ),
  ).toBe(true);
});

it("advertises durable attachment ownership and scopes release to the authenticated claim generation", async () => {
  const s = await setup();
  const descriptor = (await s.call("environment.describe")).value.result;
  expect(descriptor.capabilities).toContain("attachments.ownership.v1");
  const id = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const owner = { ids: [id], ownerId: "composer-session", claimId: "generation-A" };
  expect((await s.call("attachments.claim", owner)).value.result).toEqual({ claimed: true });
  const bytes = Buffer.from("attachment");
  expect(
    (
      await s.call("attachments.upload", {
        id,
        ownerId: owner.ownerId,
        claimId: owner.claimId,
        offset: 0,
        size: bytes.length,
        data: bytes.toString("base64"),
      })
    ).value.result.offset,
  ).toBe(bytes.length);
  expect(
    s.store.db.prepare("SELECT complete FROM attachment_ownership_files WHERE id=?").get(id)
      ?.complete,
  ).toBe(1);
  await s.call("attachments.release", owner, s.second.token);
  expect(
    s.store.db
      .prepare("SELECT count(*) AS count FROM attachment_ownership_claims WHERE id=?")
      .get(id)?.count,
  ).toBe(1);
  await s.call("attachments.claim", { ...owner, claimId: "generation-B" });
  await s.call("attachments.release", owner);
  const remaining = s.store.db
    .prepare("SELECT principal,claim_id FROM attachment_ownership_claims WHERE id=?")
    .all(id);
  expect(remaining).toHaveLength(1);
  expect(remaining[0].claim_id).toBe("generation-B");
  expect(String(remaining[0].principal)).toMatch(/^[0-9a-f]{64}$/);
  expect(
    (await s.call("attachments.claim", { ...owner, ownerId: "x".repeat(129) })).value.error,
  ).toBe("Invalid attachment owner ID");
});

it("claims host queue attachment exports before returning an offline-editable snapshot", async () => {
  const s = await setup();
  const created = s.engine.command({
    type: "create",
    commandId: "owned-queue",
    projectId: s.project.id,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
  });
  const id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  await s.call("attachments.upload", {
    id,
    ownerId: "composer",
    claimId: "source-generation",
    offset: 0,
    size: 3,
    data: Buffer.from("abc").toString("base64"),
  });
  const messages = [
    {
      id: "queued",
      text: "Later",
      attachments: [{ id, name: "file.txt", mimeType: "text/plain", kind: "file", size: 3 }],
    },
  ];
  s.store.db
    .prepare("INSERT INTO session_queues VALUES(?,?)")
    .run(created.sessionId, JSON.stringify({ messages, revision: 1 }));
  const response = await s.call(
    "sessions.queue.get",
    {
      sessionId: created.sessionId,
      clientId: "reader",
      ownerId: "queue-view",
      claimId: "view-generation",
    },
    s.second.token,
  );
  expect(response.value.result.messages).toEqual(messages);
  expect((await s.call("attachments.claims", { ownerId: "queue-view" })).value.result).toEqual({
    claims: [],
  });
  expect(
    (await s.call("attachments.claims", { ownerId: "queue-view" }, s.second.token)).value.result,
  ).toEqual({ claims: [{ id, claimId: "view-generation" }] });
  expect(
    (
      await s.call(
        "attachments.claims",
        { ownerId: "queue-view", after: { id: "invalid", claimId: "" } },
        s.second.token,
      )
    ).value.error,
  ).toBe("Invalid attachment claims cursor");
  expect(
    s.store.db
      .prepare(
        "SELECT claim_id FROM attachment_ownership_claims WHERE id=? AND owner_id='queue-view'",
      )
      .get(id)?.claim_id,
  ).toBe("view-generation");
  expect(
    s.store.db.prepare("SELECT legacy FROM attachment_ownership_files WHERE id=?").get(id)?.legacy,
  ).toBe(0);
  const changed = await s.call(
    "sessions.queue.change",
    {
      sessionId: created.sessionId,
      clientId: "reader",
      ownerId: "queue-view",
      claimId: "view-generation",
      before: response.value.result,
      after: response.value.result,
    },
    s.second.token,
  );
  expect(changed.value.error).toBeUndefined();
  expect(
    s.store.db.prepare("SELECT legacy FROM attachment_ownership_files WHERE id=?").get(id)?.legacy,
  ).toBe(0);
  await s.call("sessions.queue.get", { sessionId: created.sessionId, clientId: "legacy-reader" });
  expect(
    s.store.db.prepare("SELECT legacy FROM attachment_ownership_files WHERE id=?").get(id)?.legacy,
  ).toBe(1);
});

describe("host turns in an adopted conversation and desktop-only queue blocks", () => {
  /** A host whose desktop database knows every conversation (adopted): the queue status then follows the desktop's flag, not the host's run. */
  async function adopted() {
    const directory = mkdtempSync(join(tmpdir(), "bycoda-adopted-queue-"));
    const store = new HostStore(join(directory, "host.db"));
    let finish = () => {};
    const send = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const engine = new HostEngine(store, {
      codex: { send, stop: async () => finish(), cancel: async () => finish(), bind: () => {}, approve: () => {}, answer: () => {} },
    } as never);
    const project = await engine.openProject(directory);
    const desktop = new DesktopSessions();
    vi.spyOn(desktop, "metadata").mockImplementation(
      () => ({ cwd: project.cwd, harness: "codex", running: false }) as never,
    );
    const server = createHostServer(engine, ["codex"], undefined, undefined, undefined, desktop);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
    const device = store.issueDevice("Laptop");
    const call = async (method: string, params: unknown = {}) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${device.token}` },
        body: JSON.stringify({ version: 1, environmentId: store.environmentId, method, params }),
      });
      return (await response.json()) as { result?: any; error?: string };
    };
    cleanups.push(async () => {
      await engine.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
      rmSync(directory, { recursive: true, force: true });
    });
    const sessionId = engine.command({
      type: "create",
      commandId: "adopted-create",
      projectId: project.id,
      harness: "codex",
      model: "gpt",
      runtimeMode: "supervised",
    } as never).sessionId;
    return { engine, store, call, send, sessionId, finish: () => finish(), desktop };
  }
  const aware = { leaseAware: true };
  const row = (id: string, extra: object = {}) => ({ id, text: id, attachments: [], ...extra });

  it("leaves a queued row that needs a configure alone while the host runs a turn of the adopted conversation", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      const s = await adopted();
      s.engine.command({ type: "send", commandId: "mac-turn", sessionId: s.sessionId, text: "mac turn" } as never);
      await vi.waitFor(() => expect(s.send).toHaveBeenCalledOnce());
      await s.call("sessions.queue.change", {
        sessionId: s.sessionId,
        clientId: "remote:mac",
        ...aware,
        before: { messages: [] },
        after: {
          messages: [row("a", { modelTarget: { harness: "codex", model: "other-model", modelSettings: {} } })],
          status: "active",
        },
      });
      await vi.advanceTimersByTimeAsync(50);
      // Not held for "Wait for the current turn before changing settings": it just waits.
      const waiting = (await s.call("sessions.queue.get", { sessionId: s.sessionId, clientId: "remote:mac", ...aware })).result;
      expect(waiting).toMatchObject({ status: "active" });
      expect(waiting.holdReason).toBeUndefined();
      expect(waiting.messages).toHaveLength(1);
      s.finish();
      await vi.waitFor(async () => {
        await vi.advanceTimersByTimeAsync(100);
        expect(s.send).toHaveBeenCalledTimes(2);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not take the lease from a holder that waits for a host turn of the adopted conversation", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      const s = await adopted();
      s.engine.command({ type: "send", commandId: "mac-turn", sessionId: s.sessionId, text: "mac turn" } as never);
      await vi.waitFor(() => expect(s.send).toHaveBeenCalledOnce());
      await s.call("sessions.queue.change", {
        sessionId: s.sessionId,
        clientId: "desktop:win1",
        ...aware,
        before: { messages: [] },
        after: { messages: [row("a")], status: "active" },
      });
      const lease = (await s.call("sessions.queue.lease", { sessionId: s.sessionId, clientId: "desktop:win1", ...aware })).result.drain;
      let lost = 0;
      for (let waited = 0; waited < 100_000; waited += 1_500) {
        await vi.advanceTimersByTimeAsync(1_500);
        const beat = (
          await s.call("sessions.desktopLive", {
            clientId: "win1",
            sessions: [],
            queueLeases: [{ sessionId: s.sessionId, epoch: lease.epoch }],
          })
        ).result;
        if (beat.queueLeases?.[s.sessionId] === null) lost++;
      }
      expect(lost).toBe(0);
      expect(s.send).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("neither replaces a holder that reports it cannot send nor sends on the host's own copy meanwhile", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      const s = await adopted();
      s.engine.command({ type: "send", commandId: "mac-turn", sessionId: s.sessionId, text: "mac turn" } as never);
      await vi.waitFor(() => expect(s.send).toHaveBeenCalledOnce());
      await s.call("sessions.queue.change", {
        sessionId: s.sessionId,
        clientId: "desktop:win1",
        ...aware,
        before: { messages: [] },
        after: { messages: [row("a")], status: "active" },
      });
      const lease = (await s.call("sessions.queue.lease", { sessionId: s.sessionId, clientId: "desktop:win1", ...aware })).result.drain;
      s.finish();
      await vi.waitFor(async () => {
        await vi.advanceTimersByTimeAsync(100);
        expect(s.store.sessionStatus(s.sessionId)).toBe("idle");
      });
      s.send.mockClear();
      const beat = async (blocked: boolean) =>
        (
          await s.call("sessions.desktopLive", {
            clientId: "win1",
            sessions: [],
            queueLeases: [{ sessionId: s.sessionId, epoch: lease.epoch, ...(blocked ? { blocked: true } : {}) }],
          })
        ).result.queueLeases?.[s.sessionId];
      // Blocked for three minutes of beats: the lease stays, the host sends nothing.
      for (let waited = 0; waited < 180_000; waited += 5_000) {
        await vi.advanceTimersByTimeAsync(5_000);
        expect(await beat(true)).toMatchObject({ holder: "desktop:win1", epoch: lease.epoch });
      }
      expect(s.send).not.toHaveBeenCalled();
      // The conflict is resolved but the window still does not send: after the stall limit the host does.
      let released = false;
      for (let waited = 0; waited < 90_000 && !released; waited += 5_000) {
        await vi.advanceTimersByTimeAsync(5_000);
        released = (await beat(false)) === null;
      }
      expect(released).toBe(true);
      await vi.waitFor(() => expect(s.send).toHaveBeenCalledOnce());
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds a queue behind a turn the host restart cut short instead of sending its next row", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bycoda-restart-queue-"));
    const store = new HostStore(join(directory, "host.db"));
    const send = vi.fn(async () => {});
    const provider = { send, stop: async () => {}, cancel: async () => {}, bind: () => {}, approve: () => {}, answer: () => {} } as never;
    const first = new HostEngine(store, { codex: provider });
    const project = await first.openProject(directory);
    const sessionId = first.command({
      type: "create",
      commandId: "restart-create",
      projectId: project.id,
      harness: "codex",
      model: "gpt",
      runtimeMode: "supervised",
    } as never).sessionId;
    const value = store.session(sessionId);
    store.transaction(() =>
      store.save(
        { ...value, revision: value.revision + 1, status: "running", runId: "old-run", session: { ...value.session, busy: true } },
        { type: "accepted" },
      ),
    );
    // A queue that was waiting on that turn.
    new SessionQueues(store.db).change(sessionId, { messages: [] }, { messages: [row("a")], status: "active" } as never);
    const restarted = new HostEngine(store, { codex: provider });
    const server = createHostServer(restarted, ["codex"]);
    cleanups.push(async () => {
      await restarted.close();
      await first.close();
      server.closeAllConnections();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(send).not.toHaveBeenCalled();
    expect(new SessionQueues(store.db).get(sessionId)).toMatchObject({
      status: "paused",
      holdReason: expect.stringContaining("Host restarted"),
    });
  });
});
