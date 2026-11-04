import { expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

const fixture = vi.hoisted(() => ({ replies: [] as string[] }));
vi.mock("../core/assistant-text", async (original) => ({
  ...(await original<typeof import("../core/assistant-text")>()),
  assistantText: () => async () => ({ text: fixture.replies.shift() ?? JSON.stringify({ type: "final", text: "Done" }), tokens: 20 }),
}));
import { HostStore } from "../../store";
import { HostEngine } from "../../engine";
import { createHostServer } from "../../server";

it("executes a Room text turn through native review and retains its result without a coding session", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-room-http-"));
  const store = new HostStore(join(directory, "host.db"));
  const engine = new HostEngine(store, { codex: { send: async () => {}, stop: async () => {}, cancel: async () => {}, bind: () => {}, approve: () => {}, answer: () => {} } });
  const server = await createHostServer(engine, ["codex"]);
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const owner = await store.issueDevice("Room test owner");
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
    const call = async (method: string, params: Record<string, unknown>) => {
      const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${owner.token}` }, body: JSON.stringify({ version: 1, environmentId: store.environmentId, method, params }) });
      return await response.json() as { result?: any; error?: string };
    };
    const publicKey = await call("native.services.assistant.delegation.publicKey", {});
    expect(publicKey.result).toMatchObject({ environmentId: store.environmentId });
    expect(publicKey.result.publicKey).toContain("BEGIN PUBLIC KEY");
    expect((await call("native.services.assistant.delegation.attest", { input: {} })).error).toBeTruthy();
    const snapshot = await call("assistant.request", { op: "snapshot" });
    const configured = await call("assistant.request", { op: "profile.update", expectedVersion: snapshot.result.snapshot.profile.version, patch: { name: "Assistant", autonomy: "report", dailyTokenBudget: 100000, setupComplete: true, enabled: true, execution: { harness: "codex", model: "fixture", modelSettings: {}, runtimeMode: "supervised", maxRunMinutes: 60 } } });
    expect(configured.error).toBeUndefined();
    const opened = await call("assistant.request", { op: "threads.open" });
    const threadId = opened.result.thread.id;
    fixture.replies = [
      JSON.stringify({ type: "tool", family: "conversation", action: "servers.list", input: {} }),
      JSON.stringify({ type: "tool", family: "conversation", action: "servers.ssh.remove", input: { id: "fixture-server", expectedInventoryRevision: "a".repeat(64) } }),
      JSON.stringify({ type: "final", text: "Server removed." }),
    ];
    await call("conversation.desktop.take", {});
    const pending = call("assistant.request", { op: "threads.send", threadId, via: "text", text: "Remove the saved server", idempotencyKey: "room-http" });
    for (const action of ["servers.list", "management.write.authorize", "servers.ssh.remove"]) {
      let requests: any[] = [];
      for (let attempt = 0; attempt < 200 && !requests.length; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        requests = (await call("conversation.desktop.take", {})).result ?? [];
      }
      expect(requests).toHaveLength(1);
      const request = requests[0];
      expect(request).toMatchObject({ action, threadId });
      expect(request).not.toHaveProperty("sessionId");
      const result = action === "servers.list" ? { items: [{ id: "fixture-server" }], total: 1, inventoryRevision: "a".repeat(64) }
        : action === "management.write.authorize" ? { approved: true, operationHash: request.input.operation.operationHash }
        : { removed: true };
      await call("conversation.desktop.finish", { id: request.id, result });
    }
    const result = await pending;
    expect(result.error).toBeUndefined();
    expect(result.result.messages.at(-1).text).toBe("Server removed.");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await server.closeResources();
    await engine.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 15000);

it("writes the real notebook and fails closed on unqualified native workspace submission", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const directory = mkdtempSync(join(tmpdir(), "bycoda-room-ops-"));
  const desktopPath = join(directory, "desktop.db");
  const desktopDb = new DatabaseSync(desktopPath);
  desktopDb.exec("CREATE TABLE notes(id TEXT PRIMARY KEY,slug TEXT NOT NULL UNIQUE,title TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',tags_json TEXT NOT NULL DEFAULT '[]',source_session_id TEXT,source_cwd TEXT,slug_pending INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,content_updated_at INTEGER NOT NULL DEFAULT 0)");
  desktopDb.close();
  const previousPath = process.env.BYCODA_DESKTOP_DB;
  process.env.BYCODA_DESKTOP_DB = desktopPath;
  const store = new HostStore(join(directory, "host.db"));
  const engine = new HostEngine(store, { codex: { send: async () => {}, stop: async () => {}, cancel: async () => {}, bind: () => {}, approve: () => {}, answer: () => {} } });
  const project = await engine.openProject(directory);
  const server = await createHostServer(engine, ["codex"]);
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const owner = await store.issueDevice("Room fixture owner");
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
    const call = async (method: string, params: Record<string, unknown>) => {
      const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${owner.token}` }, body: JSON.stringify({ version: 1, environmentId: store.environmentId, method, params }) });
      return await response.json() as { result?: any; error?: string };
    };
    const snapshot = await call("assistant.request", { op: "snapshot" });
    const configured = await call("assistant.request", { op: "profile.update", expectedVersion: snapshot.result.snapshot.profile.version, patch: { name: "Assistant", autonomy: "report", dailyTokenBudget: 100000, setupComplete: true, enabled: true, execution: { harness: "codex", model: "fixture", modelSettings: {}, runtimeMode: "supervised", maxRunMinutes: 60 } } });
    expect(configured.error).toBeUndefined();
    const opened = await call("assistant.request", { op: "threads.open" });
    const threadId = opened.result.thread.id;
    fixture.replies = [
      JSON.stringify({ type: "tool", family: "conversation", action: "notebook.create", input: { title: "Fixture note", body: "Private fixture" } }),
      JSON.stringify({ type: "tool", family: "conversation", action: "workspace.sessions.submit", projectId: project.id, input: { sessionId: "desktop-session", text: "Exact work" } }),
    ];
    await call("conversation.desktop.take", {});
    const params = { op: "threads.send", threadId, via: "text", text: "Save a note and submit work", idempotencyKey: "room-fixture-operations" };
    let settled = false;
    const pending = call("assistant.request", params).finally(() => { settled = true; });
    let submissions = 0;
    let approvals = 0;
    for (let attempt = 0; attempt < 1500 && !settled; attempt++) {
      const requests = (await call("conversation.desktop.take", {})).result ?? [];
      for (const request of requests) {
        expect(request.threadId).toBe(threadId);
        expect(request).not.toHaveProperty("sessionId");
        let result: unknown;
        if (request.action === "organization.read") result = { items: [{ cwd: project.cwd }], nextOffset: null };
        else if (request.action === "management.write.authorize") {
          approvals++;
          if (request.input.operation.action === "notebook.create") expect(request).not.toHaveProperty("projectId");
          else { expect(request.input.operation.action).toBe("workspace.sessions.submit"); expect(request.projectId).toBe(project.id); }
          result = { approved: true, operationHash: request.input.operation.operationHash };
        } else if (request.action === "privacy.scope.capture") { result = {}; }
        else if (request.action === "workspace.sessions.submit") { submissions++; throw new Error("Unqualified desktop submission escaped the fence"); }
        else throw new Error(`Unexpected desktop request: ${request.action}`);
        expect((await call("conversation.desktop.finish", { id: request.id, result })).error).toBeUndefined();
      }
      if (!settled) await new Promise(resolve => setTimeout(resolve, 10));
    }
    const result = await pending;
    expect(result.error).toBeTruthy();
    expect({ approvals, submissions }).toEqual({ approvals: 2, submissions: 0 });
    const notes = new DatabaseSync(desktopPath, { readOnly: true });
    expect(notes.prepare("SELECT title,body,source_cwd,source_session_id FROM notes").all()).toMatchObject([{ title: "Fixture note", body: "Private fixture", source_cwd: null, source_session_id: null }]);
    notes.close();
    const replay = await call("assistant.request", params);
    expect(replay.error).toContain("uncertain outcome");
    expect((await call("conversation.desktop.take", {})).result ?? []).toHaveLength(0);
    expect(submissions).toBe(0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await server.closeResources();
    await engine.close();
    await store.close();
    if (previousPath === undefined) delete process.env.BYCODA_DESKTOP_DB; else process.env.BYCODA_DESKTOP_DB = previousPath;
    rmSync(directory, { recursive: true, force: true });
  }
}, 30000);

it("qualifies real Host session create, submit and status over Room HTTP", async () => {
  const toolLogs = vi.spyOn(console, "info").mockImplementation(() => {});
  const { generateKeyPairSync, sign, createHash } = await import("node:crypto");
  const { writeFileSync, readFileSync } = await import("node:fs");
  const { execFileSync } = await import("node:child_process");
  const { nativeAdmissionBytes, nativeAdmissionDigest, nativeAdmissionFingerprint } = await import("../native/assistant-native-admission");
  const directory = mkdtempSync(join(tmpdir(), "room-qualified-http-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: directory, windowsHide: true, stdio: "pipe" });
  git("init", "-q", "-b", "main"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.test");
  writeFileSync(join(directory, "fixture.txt"), "fixture\n"); git("add", "fixture.txt"); git("commit", "-q", "-m", "fixture");
  const store = new HostStore(join(directory, "host.db"));
  const project = await store.addProject(directory, "Fixture");
  const pair = generateKeyPairSync("ed25519");
  const registry = join(directory, "native-registry.json");
  writeFileSync(registry, JSON.stringify({ version: 1, generation: "a".repeat(64), entries: [{ installationId: "fixture-desktop", hostId: store.environmentId, publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(), fingerprint: nativeAdmissionFingerprint(pair.publicKey) }] }));
  const previous = process.env.BYCODA_NATIVE_ADMISSION_REGISTRY;
  const previousDesktop = process.env.BYCODA_DESKTOP_DB;
  const desktopPath = join(directory, "fixture-desktop.db");
  const { DatabaseSync } = await import("node:sqlite");
  const desktopDb = new DatabaseSync(desktopPath);
  desktopDb.exec("CREATE TABLE notes(id TEXT PRIMARY KEY,slug TEXT NOT NULL UNIQUE,title TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',tags_json TEXT NOT NULL DEFAULT '[]',source_session_id TEXT,source_cwd TEXT,slug_pending INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,content_updated_at INTEGER NOT NULL DEFAULT 0)");
  desktopDb.prepare("INSERT INTO notes(id,slug,title,body,source_cwd,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run("fixture-note", "fixture-note", "Project fixture note", "Private fixture body", project.cwd, 1, 1);
  desktopDb.close();
  process.env.BYCODA_DESKTOP_DB = desktopPath;
  process.env.BYCODA_NATIVE_ADMISSION_REGISTRY = registry;
  let finishProvider!: () => void;
  const providerDone = new Promise<void>(resolve => { finishProvider = resolve; });
  const provider = { send: vi.fn(async () => { await providerDone; }), stop: vi.fn(async () => { finishProvider(); }), cancel: vi.fn(async () => { finishProvider(); }), bind: vi.fn(), approve: vi.fn(), answer: vi.fn() };
  const engine = new HostEngine(store, { codex: provider });
  vi.spyOn(engine.checkpoints, "begin").mockResolvedValue(); vi.spyOn(engine.checkpoints, "finish").mockResolvedValue();
  const server = await createHostServer(engine, ["codex"]);
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const owner = await store.issueDevice("Fixture owner");
    const other = await store.issueDevice("Other fixture device");
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
    const call = async (method: string, params: Record<string, unknown>) => {
      const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${owner.token}` }, body: JSON.stringify({ version: 1, environmentId: store.environmentId, method, params }) });
      return await response.json() as { result?: any; error?: string };
    };
    const signed = async (action: string, value: unknown) => {
      const operationJson = JSON.stringify(value);
      const request = { installationId: "fixture-desktop", hostId: store.environmentId, action, requestDigest: nativeAdmissionDigest(operationJson) };
      const challenge = (await call("native.services.assistant.delegation.nativeChallenge", { input: request })).result;
      if (!challenge) throw new Error("Fixture native challenge unavailable");
      return { operationJson, proof: { challenge, signature: sign(null, nativeAdmissionBytes(challenge), pair.privateKey).toString("base64url") } };
    };
    const reopen = await signed("assistant.visibility.reopen", { epoch: 0, projection: { version: 1, revision: 1, operationId: "fixture-projection", actor: "fixture-window", snapshot: { schemaVersion: 1, policyDigest: "a".repeat(64), issuer: "fixture-window", privacyRevision: 1, visibleProjects: [{ cwd: project.cwd }] } } });
    expect((await call("native.services.assistant.visibility.reopen", { input: reopen })).error).toBeUndefined();
    const snapshot = await call("assistant.request", { op: "snapshot" });
    expect((await call("assistant.request", { op: "profile.update", expectedVersion: snapshot.result.snapshot.profile.version, patch: { name: "Assistant", autonomy: "report", dailyTokenBudget: 100000, setupComplete: true, enabled: true, execution: { harness: "codex", model: "fixture", modelSettings: {}, runtimeMode: "supervised", maxRunMinutes: 60 } } })).error).toBeUndefined();
    const threadId = (await call("assistant.request", { op: "threads.open" })).result.thread.id;
    await call("conversation.desktop.take", {});
    let sequence = 0;
    let workspaceAuthorization: { threadId: string; requestId: string; operationHash: string } | undefined;
    const run = async (tool: Record<string, unknown>, key: string, voice = false) => {
      fixture.replies = [JSON.stringify(tool), JSON.stringify({ type: "final", text: "Done" })];
      let settled = false;
      const { type: _type, ...voiceTool } = tool;
      const pending = (voice
        ? call("voice.tools.call", { ...voiceTool, threadId, requestId: key })
        : call("assistant.request", { op: "threads.send", threadId, via: "text", text: key, idempotencyKey: key })).finally(() => { settled = true; });
      for (let i = 0; i < 2000 && !settled; i++) {
        for (const request of (await call("conversation.desktop.take", {})).result ?? []) {
          expect(request.threadId).toBe(threadId);
          expect(request).not.toHaveProperty("sessionId");
          const authorizeParams = { id: request.id, action: request.action };
          expect((await call("native.services.conversation.desktop.authorize", authorizeParams)).result).toEqual({ authorized: true });
          const otherResponse = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${other.token}` }, body: JSON.stringify({ version: 1, environmentId: store.environmentId, method: "native.services.conversation.desktop.authorize", params: authorizeParams }) });
          expect((await otherResponse.json() as { result?: unknown }).result).toEqual({ authorized: false });
          let result: unknown;
          if (request.action === "organization.read") result = { items: [{ cwd: project.cwd }], nextOffset: null };
          else if (request.action === "management.write.authorize") { expect(request.projectId).toBe(project.id); result = { approved: true, operationHash: request.input.operation.operationHash }; }
          else if (request.action === "privacy.scope.capture") {
            expect(request).toMatchObject({ projectId: project.id, targetProjectCwd: project.cwd });
            result = await signed("assistant.visibility.capture", { environmentId: store.environmentId, threadId, issuer: "fixture-window", relayId: request.id, projectId: project.id, targetCwd: project.cwd, action: request.input.action, requestId: request.input.requestId, operationHash: request.input.operationHash, projectionRevision: 1, policyDigest: "a".repeat(64), privacyRevision: 1, visibleCwds: [project.cwd], sequence: ++sequence });
          } else if (request.action === "workspace.operation.status") {
            result = await signed("assistant.workspace.receipt", { environmentId: store.environmentId, threadId, issuer: "fixture-window", relayId: request.id, projectId: project.id, targetCwd: project.cwd, operationId: request.input.operationId, action: request.input.action, originalInput: request.input.originalInput, result: { state: "unknown" } });
          } else if (request.action === "workspace.operation.execute") {
            const [action, cwd, originalInput] = JSON.parse(request.input.operationJson);
            expect(cwd).toBe(project.cwd);
            expect(request.projectId).toBe(project.id);
            workspaceAuthorization = { threadId, requestId: request.input.requestId, operationHash: request.input.operationHash };
            result = await signed("assistant.workspace.receipt", { environmentId: store.environmentId, threadId, issuer: "fixture-window", relayId: request.id, projectId: project.id, targetCwd: cwd, operationId: request.input.requestId, action, originalInput, result: { state: "ownerAccepted" } });
          } else if (request.action === "workspace.sessions.submit.status") {
            expect(request).toMatchObject({ projectId: project.id, targetProjectCwd: project.cwd, input: { sessionId: "desktop-original", submissionId: "original-request" } });
            result = { state: "unknown", sessionId: "desktop-original", submissionId: "original-request" };
          } else throw new Error(`Unexpected fixture relay: ${request.action}`);
          expect((await call("conversation.desktop.finish", { id: request.id, result })).error).toBeUndefined();
          expect((await call("native.services.conversation.desktop.authorize", authorizeParams)).result).toEqual({ authorized: false });
        }
        if (!settled) await new Promise(resolve => setTimeout(resolve, 5));
      }
      return pending;
    };
    expect((await run({ type: "tool", family: "conversation", action: "sessions.create", projectId: project.id, input: { harness: "codex", model: "codex:fixture", modelSettings: {}, runtimeMode: "supervised" } }, "create")).error).toBeUndefined();
    const session = (await store.sessions(project.id))[0];
    expect(session).toBeTruthy();
    expect((await run({ type: "tool", family: "conversation", action: "sessions.submit", projectId: project.id, input: { sessionId: session.session.id, expectedRevision: session.revision, text: "Explicit fixture work" } }, "submit")).error).toBeUndefined();
    await vi.waitFor(() => expect(provider.send).toHaveBeenCalledOnce());
    const saved = await store.session(session.session.id);
    const block = saved.session.blocks.find(item => item.role === "user");
    expect(block?.author).toMatchObject({ kind: "assistant-room", threadId });
    expect(block?.author?.operationId).toBeTruthy();
    expect((await run({ type: "tool", family: "conversation", action: "sessions.submit.status", projectId: project.id, input: { sessionId: session.session.id, submissionId: block!.author!.operationId } }, "status")).error).toBeUndefined();
    expect(provider.send).toHaveBeenCalledOnce();
    const voiceStatus = await run({ type: "tool", family: "conversation", action: "sessions.submit.status", projectId: project.id, input: { sessionId: session.session.id, submissionId: "unknown-original" } }, "voice-status", true);
    expect(voiceStatus.error).toBeUndefined();
    expect(voiceStatus.result).toMatchObject({ state: "unknown", submissionId: "unknown-original" });
    const voiceTasks = await run({ type: "tool", family: "conversation", action: "tasks.list", projectId: project.id, input: {} }, "voice-tasks", true);
    expect(voiceTasks.error).toBeUndefined();
    expect(voiceTasks.result).toMatchObject({ items: [], total: 0 });
    const voiceCrews = await run({ type: "tool", family: "conversation", action: "crews.list", projectId: project.id, input: {} }, "voice-crews", true);
    expect(voiceCrews.error).toBeUndefined();
    expect(voiceCrews.result).toMatchObject({ value: { runs: { items: [] } } });
    const noteWrite = await run({ type: "tool", family: "conversation", action: "notes.create", projectId: project.id, input: { id: "voice-project-note", title: "Reviewed voice note", body: "Written in exact project" } }, "voice-note-create", true);
    expect(noteWrite.error).toBeUndefined();
    expect(noteWrite.result).toMatchObject({ state: "completed" });
    const voiceNotes = await run({ type: "tool", family: "conversation", action: "notes.list", projectId: project.id, input: {} }, "voice-notes", true);
    expect(voiceNotes.error).toBeUndefined();
    expect(JSON.stringify(voiceNotes.result)).toContain("Project fixture note");
    expect(JSON.stringify(voiceNotes.result)).toContain("Reviewed voice note");
    const voiceInbox = await run({ type: "tool", family: "conversation", action: "inbox.list", projectId: project.id, input: {} }, "voice-inbox", true);
    expect(voiceInbox.error).toBeUndefined();
    expect(voiceInbox.result).toMatchObject({ socialIncluded: false, externalProviderInboxAvailable: false });
    const desktopStatus = await run({ type: "tool", family: "conversation", action: "workspace.sessions.submit.status", projectId: project.id, input: { sessionId: "desktop-original", submissionId: "original-request" } }, "desktop-status", true);
    expect(desktopStatus.error).toBeUndefined();
    expect(desktopStatus.result).toMatchObject({ state: "unknown", submissionId: "original-request" });
    const receiptStatus = await run({ type: "tool", family: "conversation", action: "workspace.operation.status", projectId: project.id, input: { operationId: "original-create", action: "workspace.sessions.create", originalInput: { requestId: "original-create", submit: false } } }, "desktop-receipt-status", true);
    expect(receiptStatus.error).toBeUndefined();
    expect(receiptStatus.result).toEqual({ state: "unknown" });
    const nativeSelect = await run({ type: "tool", family: "conversation", action: "workspace.projects.select", projectId: project.id, input: { requestId: "native-select" } }, "native-select", true);
    expect(nativeSelect.error).toBeUndefined();
    expect(nativeSelect.result).toMatchObject({ state: "accepted", ownerState: "ownerAccepted" });
    expect(workspaceAuthorization).toBeDefined();
    expect((await call("native.services.assistant.workspace.authorize", { input: workspaceAuthorization })).result).toEqual({ authorized: true });
    expect((await call("native.services.assistant.workspace.authorize", { input: { ...workspaceAuthorization, operationHash: "f".repeat(64) } })).result).toEqual({ authorized: false });
    const otherWorkspace = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${other.token}` }, body: JSON.stringify({ version: 1, environmentId: store.environmentId, method: "native.services.assistant.workspace.authorize", params: { input: workspaceAuthorization } }) });
    expect((await otherWorkspace.json() as { result?: unknown }).result).toEqual({ authorized: false });
    const nativeSelectStatus = await run({ type: "tool", family: "conversation", action: "workspace.operation.status", projectId: project.id, input: { operationId: "native-select", action: "workspace.projects.select", originalInput: { requestId: "native-select" } } }, "native-select-status", true);
    expect(nativeSelectStatus.result).toEqual({ state: "unknown" });
    let panelDone = false;
    const panel = call("native.services.assistant.browser.panel", { environmentId: store.environmentId, projectId: project.id, threadId, projectCwd: project.cwd, action: "browser.status", input: {}, requestId: "panel-status" }).finally(() => { panelDone = true; });
    for (let i = 0; i < 500 && !panelDone; i++) {
      for (const request of (await call("conversation.desktop.take", {})).result ?? []) {
        expect(request.action).toBe("privacy.scope.capture");
        expect(request.threadId).toBe(threadId);
        expect(request.projectId).toBe(project.id);
        expect(request.targetProjectCwd).toBe(project.cwd);
        expect((await call("native.services.conversation.desktop.authorize", { id: request.id, action: request.action })).result).toEqual({ authorized: true });
        const result = await signed("assistant.visibility.capture", { environmentId: store.environmentId, threadId, issuer: "fixture-window", relayId: request.id, projectId: project.id, targetCwd: project.cwd, action: request.input.action, requestId: request.input.requestId, operationHash: request.input.operationHash, projectionRevision: 1, policyDigest: "a".repeat(64), privacyRevision: 1, visibleCwds: [project.cwd], sequence: ++sequence });
        expect((await call("conversation.desktop.finish", { id: request.id, result })).error).toBeUndefined();
      }
      if (!panelDone) await new Promise(resolve => setTimeout(resolve, 10));
    }
    const panelStatus = await panel;
    expect(panelStatus.error).toBeUndefined();
    expect(panelStatus.result).toBeTruthy();
    const wrongPanel = await call("native.services.assistant.browser.panel", { environmentId: store.environmentId, projectId: project.id, threadId, projectCwd: `${project.cwd}-other`, action: "browser.status", input: {}, requestId: "wrong-panel" });
    expect(wrongPanel.error).toContain("project changed");
    const runtime = await run({ type: "tool", family: "conversation", action: "environment.describe", projectId: project.id, input: {} }, "voice-environment", true);
    expect(runtime.error).toBeUndefined();
    expect(runtime.result.environmentId).toBe(store.environmentId);
    const sync = await run({ type: "tool", family: "conversation", action: "sync.status", projectId: project.id, input: {} }, "voice-sync", true);
    expect(sync.error).toBeUndefined();
    expect(sync.result).toMatchObject({ state: "host-sync-metadata" });
    const events = await run({ type: "tool", family: "conversation", action: "events.subscribe", projectId: project.id, input: { waitMs: 0 } }, "voice-events", true);
    expect(events.error).toBeUndefined();
    expect(events.result).toMatchObject({ transport: "long-poll", durableReplay: false, coverage: "bounded-project-snapshot" });
    expect(events.result.items).toHaveLength(1);
    expect(events.result.items[0]).toMatchObject({ kind: "session", id: session.session.id });
    const globalRuntime = await run({ type: "tool", family: "conversation", action: "environment.describe", input: {} }, "global-environment", true);
    expect(globalRuntime.error).toBeUndefined();
    expect(globalRuntime.result.environmentId).toBe(store.environmentId);
    expect(globalRuntime.result).not.toHaveProperty("projectId");
    expect((await run({ type: "tool", family: "conversation", action: "sync.status", input: {} }, "global-sync-text")).error).toBeUndefined();
    const file = await run({ type: "tool", family: "conversation", action: "files.read", projectId: project.id, input: { path: "fixture.txt" } }, "voice-file-read", true);
    expect(file.error).toBeUndefined();
    expect(file.result.text).toBe("fixture\n");
    const fileInput = { path: "fixture.txt", expectedHash: createHash("sha256").update("fixture\n").digest("hex"), content: "Reviewed Room file change\n" };
    const written = await run({ type: "tool", family: "conversation", action: "files.write", projectId: project.id, input: fileInput }, "voice-file-write", true);
    expect(written.error).toBeUndefined();
    expect(written.result).toMatchObject({ state: "completed", requestId: "voice-file-write" });
    expect(readFileSync(join(directory, "fixture.txt"), "utf8")).toBe(fileInput.content);
    const fileStatus = await run({ type: "tool", family: "conversation", action: "files.operation.status", projectId: project.id, input: { operationId: "voice-file-write", action: "files.write", originalInput: fileInput } }, "voice-file-status", true);
    expect(fileStatus.error).toBeUndefined();
    expect(fileStatus.result).toMatchObject({ state: "completed", operationId: "voice-file-write" });
    expect((await run({ type: "tool", family: "conversation", action: "files.read", projectId: project.id, input: { path: "../outside" } }, "voice-file-escape", true)).error).toBeTruthy();
    const servers = await run({ type: "tool", family: "conversation", action: "devServers.list", projectId: project.id, input: {} }, "voice-dev-servers", true);
    expect(servers.error).toBeUndefined();
    expect(Array.isArray(servers.result.items)).toBe(true);
    const voiceLogs = await run({ type: "tool", family: "runtime-logs", action: "sources", projectId: project.id, input: {} }, "voice-logs", true);
    expect(voiceLogs.error).toBeUndefined();
    expect(Array.isArray(voiceLogs.result)).toBe(true);
    await vi.waitFor(() => expect(toolLogs.mock.calls).toContainEqual(["Voice tool", expect.objectContaining({ requestId: "voice-events", outcome: "response" })]));
    expect(provider.send).toHaveBeenCalledOnce();
  } finally {
    toolLogs.mockRestore();
    finishProvider(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await server.closeResources(); await engine.close(); await store.close();
    if (previous === undefined) delete process.env.BYCODA_NATIVE_ADMISSION_REGISTRY; else process.env.BYCODA_NATIVE_ADMISSION_REGISTRY = previous;
    if (previousDesktop === undefined) delete process.env.BYCODA_DESKTOP_DB; else process.env.BYCODA_DESKTOP_DB = previousDesktop;
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  }
}, 45000);
