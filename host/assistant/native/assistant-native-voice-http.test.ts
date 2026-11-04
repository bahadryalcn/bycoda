import { expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { nativeAdmissionBytes, nativeAdmissionDigest, nativeAdmissionFingerprint } from "./assistant-native-admission";
import { HostStore } from "../../store";
import { HostEngine } from "../../engine";
import { createHostServer } from "../../server";

// Fixture Native relay signs with a temporary key; it is not device or acoustic acceptance.
it("registers a Native-seeded generation through HTTP and fences privacy until its exact retirement", async () => {
  const directory = mkdtempSync(join(tmpdir(), "native-voice-http-"));
  const store = new HostStore(join(directory, "host.db")); await store.ready;
  const key = generateKeyPairSync("ed25519"), registry = join(directory, "registry.json");
  writeFileSync(registry, JSON.stringify({ version: 1, generation: "a".repeat(64), entries: [{ installationId: "desktop", hostId: store.environmentId, publicKey: key.publicKey.export({ type: "spki", format: "pem" }).toString(), fingerprint: nativeAdmissionFingerprint(key.publicKey) }] }));
  const previous = process.env.BYCODA_NATIVE_ADMISSION_REGISTRY;
  process.env.BYCODA_NATIVE_ADMISSION_REGISTRY = registry;
  let engine = new HostEngine(store, {});
  let server = await createHostServer(engine, ["codex"]);
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const device = await store.issueDevice("owner"), other = await store.issueDevice("other");
    let endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
    const call = async (method: string, params: Record<string, unknown>, token = device.token) => (await (await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ version: 1, environmentId: store.environmentId, method, params }) })).json()) as { result?: any; error?: string };
    const signed = async (action: string, value: unknown) => {
      const operationJson = JSON.stringify(value);
      const response = await call("native.services.assistant.delegation.nativeChallenge", { input: { installationId: "desktop", hostId: store.environmentId, action, requestDigest: nativeAdmissionDigest(operationJson) } });
      if (!response.result) throw new Error(`Challenge failed: ${response.error}`);
      return { operationJson, proof: { challenge: response.result, signature: sign(null, nativeAdmissionBytes(response.result), key.privateKey).toString("base64url") } };
    };
    const reopen = await signed("assistant.visibility.reopen", { epoch: 0, projection: { version: 1, revision: 1, operationId: "projection", actor: "window", snapshot: { schemaVersion: 1, policyDigest: "a".repeat(64), issuer: "window", privacyRevision: 1, visibleProjects: [] } } });
    expect((await call("native.services.assistant.visibility.reopen", { input: reopen })).error).toBeUndefined();
    const snapshot = (await call("assistant.request", { op: "snapshot" })).result.snapshot;
    expect((await call("assistant.request", { op: "profile.update", expectedVersion: snapshot.profile.version, patch: { name: "Assistant", enabled: true, setupComplete: true, dailyTokenBudget: 100000 } })).error).toBeUndefined();
    const threadId = (await call("assistant.request", { op: "threads.open" })).result.thread.id;
    const user = (await call("assistant.request", { op: "threads.append", threadId, role: "user", via: "voice", text: "Read my notes", idempotencyKey: "owner" })).result.message;
    const context = (await call("assistant.request", { op: "voice.context.open", threadId, requestId: "context", generationKey: "original-generation", seedMessageIds: [], ownerMessageId: user.id, contextProjectIds: [], summaryUsed: false })).result.voiceContext;
    await call("conversation.desktop.take", {});
    let sequence = 0;
    let corrupt: "generation" | "issuer" | "signature" | undefined;
    const answer = async (request: any) => {
      expect((await call("native.services.conversation.desktop.authorize", { id: request.id, action: request.action }, other.token)).result).toEqual({ authorized: false });
      let action: string, body: Record<string, unknown>;
      if (request.action === "privacy.account.capture") {
        action = "assistant.account.capture";
        body = { environmentId: store.environmentId, threadId, issuer: "window", relayId: request.id, requestId: request.input.requestId, operationHash: request.input.operationHash, projectionRevision: 1, policyDigest: "a".repeat(64), privacyRevision: 1, sequence: ++sequence };
      } else if (request.action === "observations.native.baseline") {
        action = "assistant.observations.baseline";
        body = { environmentId: store.environmentId, threadId, issuer: "window", relayId: request.id, requestId: request.input.requestId, operationHash: request.input.operationHash, projectionRevision: 1, policyDigest: "a".repeat(64), privacyRevision: 1, source: "note", page: { fingerprint: "c".repeat(64), offset: 0, nextOffset: 0, total: 0, watermark: 0, sourceGap: false, entries: [] } };
      } else if (request.action === "voice.generation.source" || request.action === "voice.generation.retire") {
        action = request.action === "voice.generation.source" ? "assistant.voice.generation.source" : "assistant.voice.generation.retired";
        body = { environmentId: store.environmentId, threadId, issuer: "window", relayId: request.id, generationKey: request.input.generationKey, requestId: request.input.requestId, operationHash: request.input.operationHash };
      } else throw new Error(`Unexpected relay: ${request.action}`);
      if (request.action === "voice.generation.source" && corrupt === "generation") body.generationKey = "wrong-generation";
      if (request.action === "voice.generation.source" && corrupt === "issuer") body.issuer = "wrong-window";
      const envelope = await signed(action, body);
      if (request.action === "voice.generation.source" && corrupt === "signature") envelope.proof.signature = sign(null, Buffer.from("wrong"), key.privateKey).toString("base64url");
      expect((await call("conversation.desktop.finish", { id: request.id, result: envelope })).error).toBeUndefined();
    };
    const pump = async <T>(pending: Promise<T>): Promise<T> => {
      let settled = false; void pending.finally(() => { settled = true; }).catch(() => {});
      for (let i = 0; i < 1000 && !settled; i++) {
        for (const request of (await call("conversation.desktop.take", {})).result ?? []) await answer(request);
        if (!settled) await new Promise(resolve => setTimeout(resolve, 5));
      }
      if (!settled) throw new Error("Fixture Native relay timed out");
      return pending;
    };
    const observation = await pump(call("voice.tools.call", { threadId, family: "conversation", action: "observations.read", input: { nativeLibrary: true, source: "note" }, requestId: "observe", causalContextId: context.id }));
    expect(observation.error).toBeUndefined();
    expect(observation.result, JSON.stringify(observation.result)).toHaveProperty("voiceContext");
    expect(observation.result.voiceDisclosure, JSON.stringify(observation.result)).toMatchObject({ verified: true, source: { nativeLibrary: true } });
    expect(observation.result.voiceContext, JSON.stringify(observation.result)).toMatchObject({ status: "known" });
    const observedContext = observation.result.voiceContext;
    const reread = await pump(call("assistant.request", { op: "voice.context.get", id: observedContext.id }));
    expect(reread.result?.voiceContext, JSON.stringify(reread)).toMatchObject({ status: "known" });
    const spoken = await pump(call("assistant.request", { op: "threads.append", threadId, role: "assistant", via: "voice", text: "Native observation", causalContextId: observedContext.id, idempotencyKey: "spoken" }));
    expect(spoken.error).toBeUndefined();
    const capturedScope = await store.db.prepare("SELECT value FROM assistant_runtime WHERE id=?").get(`messageScopeVoice:${spoken.result.message.id}`);
    expect(capturedScope, JSON.stringify(spoken)).toBeTruthy();
    for (const invalid of ["generation", "issuer", "signature"] as const) {
      corrupt = invalid;
      const rejected = await pump(call("assistant.request", { op: "voice.runtime.register", threadId, generationKey: `bad-${invalid}`, seedMessageIds: [spoken.result.message.id] }));
      expect(rejected.error).toBeTruthy();
    }
    corrupt = undefined;
    const registered = await pump(call("assistant.request", { op: "voice.runtime.register", threadId, generationKey: "preconnect-generation", seedMessageIds: [spoken.result.message.id] }));
    expect(registered).toMatchObject({ result: { ok: true } });
    const rows = await store.db.prepare("SELECT value FROM assistant_native_voice_leases").all();
    expect(rows.some(row => JSON.parse(String(row.value)).lease.generationKey === "preconnect-generation")).toBe(true);
    let settled = false;
    const revoke = call("native.services.assistant.visibility.revoke", {}).finally(() => { settled = true; });
    let retire: any;
    for (let i = 0; i < 500 && !retire && !settled; i++) {
      const requests = (await call("conversation.desktop.take", {})).result ?? [];
      retire = requests.find((request: any) => request.action === "voice.generation.retire");
      for (const request of requests) if (request !== retire) await answer(request);
      if (!retire) await new Promise(resolve => setTimeout(resolve, 5));
    }
    if (!retire && settled) throw new Error(`Privacy revoke settled before retirement: ${JSON.stringify(await revoke)}`);
    expect(retire).toBeTruthy();
    expect(settled).toBe(false);
    expect((await call("conversation.desktop.finish", { id: retire.id, error: "Fixture retirement acknowledgement lost" })).error).toBeUndefined();
    expect((await revoke).error).toBeTruthy();
    expect((await store.db.prepare("SELECT value FROM assistant_native_voice_leases").all()).some(row => JSON.parse(String(row.value)).state === "active")).toBe(true);
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await server.closeResources();
    await engine.close();
    engine = new HostEngine(store, {});
    server = await createHostServer(engine, ["codex"]);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
    expect((await store.db.prepare("SELECT value FROM assistant_native_voice_leases").all()).some(row => JSON.parse(String(row.value)).state === "active")).toBe(true);
    await call("conversation.desktop.take", {});
    const retry = call("native.services.assistant.visibility.revoke", {});
    const outcome = await pump(retry);
    expect(outcome.error).toBeUndefined();
    const closed = await store.db.prepare("SELECT value FROM assistant_native_voice_leases").all();
    expect(closed.every(row => JSON.parse(String(row.value)).state === "closed")).toBe(true);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await server.closeResources(); await engine.close(); await store.close();
    if (previous === undefined) delete process.env.BYCODA_NATIVE_ADMISSION_REGISTRY; else process.env.BYCODA_NATIVE_ADMISSION_REGISTRY = previous;
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  }
}, 30000);
