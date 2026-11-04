import { expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
const model = vi.hoisted(() => ({ replies: [] as string[], prompts: [] as string[], respond: undefined as undefined | ((prompt: string) => string) }));
vi.mock("../core/assistant-text", async original => ({
  ...(await original<typeof import("../core/assistant-text")>()),
  assistantText: () => async (_profile: unknown, prompt: string) => { model.prompts.push(prompt); return { text: model.respond ? model.respond(prompt) : model.replies.shift()!, tokens: 20 }; },
}));
import { HostStore } from "../../store";
import { HostEngine } from "../../engine";
import { createHostServer } from "../../server";

it("discovers only granted accounts and reads the exact account from a projectless Room over HTTP", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-room-account-"));
  const store = new HostStore(join(directory, "host.db"));
  const engine = new HostEngine(store, {});
  const server = await createHostServer(engine, ["codex"]);
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const owner = await store.issueDevice("Account fixture owner");
    const call = async (method: string, params: Record<string, unknown>) => {
      const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`, {
        method: "POST", headers: { Authorization: `Bearer ${owner.token}` },
        body: JSON.stringify({ version: 1, environmentId: store.environmentId, method, params }),
      });
      return await response.json() as { result?: any; error?: string };
    };
    const social = (action: string, input: Record<string, unknown>) => call("social.request", { action, input });
    const allowed = await social("accounts.create", { platform: "x", name: "Allowed", accountType: "member", projectIds: [] });
    expect(allowed.error).toBeUndefined();
    const accountId = allowed.result.id;
    const privateAccount = await social("accounts.create", { platform: "x", name: "Private", accountType: "member", projectIds: [] });
    const initialGrant = await social("accounts.assistantGrant", { accountId, permissions: ["read"], expectedVersion: null });
    expect(initialGrant.error).toBeUndefined();
    const snapshot = await call("assistant.request", { op: "snapshot" });
    expect((await call("assistant.request", { op: "profile.update", expectedVersion: snapshot.result.snapshot.profile.version,
      patch: { name: "Assistant", setupComplete: true, enabled: true, dailyTokenBudget: 100000, execution: { harness: "codex", model: "fixture", modelSettings: {}, runtimeMode: "supervised", maxRunMinutes: 60 } } })).error).toBeUndefined();
    const thread = (await call("assistant.request", { op: "threads.open" })).result.thread;
    const catalog = await call("voice.tools.list", { threadId: thread.id });
    expect(catalog.result.tools.some((tool: { action: string }) => tool.action === "observations.read")).toBe(true);
    for (const [sourceId, scopedAccount, projectIds] of [["allowed-event", accountId, []], ["private-event", privateAccount.result.id, []], ["project-event", accountId, ["another-project"]]] as [string, string, string[]][]) {
      await server.observationJournal.recordMutation({ source: "social", sourceId, sourceRevision: "fixture:1", change: "created", projectIds, accountId: scopedAccount, occurredAt: Date.now() }, async () => {});
    }
    const observation = await call("voice.tools.call", { threadId: thread.id, accountId, family: "conversation", action: "observations.read", input: {}, requestId: "read-observations" });
    expect(observation.error).toContain("active voice generation can be revoked");
    for (const socialCall of [{ action: "accounts.list", input: {} }, { action: "policy.get", accountId, input: { accountId } }]) {
      const deniedVoice = await call("voice.tools.call", { threadId: thread.id, family: "social", requestId: `voice-${socialCall.action}`, ...socialCall });
      expect(deniedVoice.error).toContain("active voice generation can be revoked");
      expect(JSON.stringify(deniedVoice)).not.toContain("Allowed");
    }
    const privateObservation = await call("voice.tools.call", { threadId: thread.id, accountId: privateAccount.result.id, family: "conversation", action: "observations.read", input: {}, requestId: "read-private-observations" });
    expect(privateObservation.error).toContain("active voice generation can be revoked");
    model.replies = [JSON.stringify({ type: "tool", family: "conversation", action: "observations.read", accountId, input: {} }), JSON.stringify({ type: "final", text: "Observation checked." })];
    const observed = await call("assistant.request", { op: "threads.send", threadId: thread.id, via: "text", text: "Check observations", idempotencyKey: "observation-account-http" });
    expect(observed.error).toBeUndefined();
    expect(observed.result.messages.at(-1).text).toBe("Observation checked.");
    await store.transaction(async () => {
      await store.db.prepare("UPDATE assistant_observation_floor SET sequence=(SELECT COALESCE(MAX(sequence),0) FROM assistant_observation_events) WHERE id=1").run();
      for (let index = 0; index < 31; index++) await store.db.prepare("INSERT INTO social_records(kind,id,value) VALUES('thread',?,?)").run(`paged-${index}`, JSON.stringify({ accountId }));
    });
    let continuation: { id: string; offset: number } | undefined;
    let continuing = false;
    model.respond = (prompt) => {
      if (prompt.includes('"state":"resnapshotted"')) return JSON.stringify({ type: "final", text: "Baseline recovered." });
      const pages = [...prompt.matchAll(/"snapshotId":"([^"]+)".*?"nextOffset":(\d+)/g)];
      const page = pages.at(-1);
      if (!continuing && page && Number(page[2]) === 16) {
        continuation = { id: page[1], offset: Number(page[2]) };
        return JSON.stringify({ type: "final", text: `Continue baseline ${page[1]} at ${page[2]}.` });
      }
      const input = page ? { snapshotId: page[1], offset: Number(page[2]) } : continuing && continuation ? { snapshotId: continuation.id, offset: continuation.offset } : {};
      return JSON.stringify({ type: "tool", family: "conversation", action: "observations.resnapshot", accountId, input });
    };
    const paged = await call("assistant.request", { op: "threads.send", threadId: thread.id, via: "text", text: "Recover observations", idempotencyKey: "observation-paged" });
    expect(paged.error).toBeUndefined();
    expect(continuation).toBeDefined();
    continuing = true;
    const continued = await call("assistant.request", { op: "threads.send", threadId: thread.id, via: "text", text: paged.result.messages.at(-1).text, idempotencyKey: "observation-paged-continue" });
    model.respond = undefined;
    expect(continued.error).toBeUndefined();
    expect(continued.result.messages.at(-1).text).toBe("Baseline recovered.");
    await store.db.prepare("DELETE FROM social_records WHERE kind='thread' AND id LIKE 'paged-%'").run();
    const ownerVoice = await call("assistant.request", { op: "threads.append", threadId: thread.id, role: "user", via: "voice", text: "Read my account", idempotencyKey: "voice-owner" });
    const openedVoice = await call("assistant.request", { op: "voice.context.open", threadId: thread.id, requestId: "voice-open", generationKey: "fixture-generation", seedMessageIds: [], ownerMessageId: ownerVoice.result.message.id, contextProjectIds: [], summaryUsed: false });
    expect(openedVoice.error).toBeUndefined();
    const voiceList = await call("voice.tools.call", { threadId: thread.id, family: "social", action: "accounts.list", input: {}, requestId: "voice-discovery", causalContextId: openedVoice.result.voiceContext.id });
    expect(voiceList.error).toBeUndefined();
    expect(JSON.stringify(voiceList.result.value)).toContain("Allowed");
    expect(JSON.stringify(voiceList.result.value)).not.toContain("Private");
    const voicePolicy = await call("voice.tools.call", { threadId: thread.id, accountId, family: "social", action: "policy.get", input: { accountId }, requestId: "voice-policy", causalContextId: openedVoice.result.voiceContext.id });
    expect(voicePolicy.error).toBeUndefined();
    const activeLeases = await store.db.prepare("SELECT account_id,version FROM social_assistant_voice_leases WHERE thread_id=? AND generation_key=?").all(thread.id, "fixture-generation");
    expect(activeLeases).toEqual([{ account_id: accountId, version: initialGrant.result.assistantGrant.version }]);
    // This HTTP fixture has no native relay; keep the grant until retirement proof exists.
    const heldGrant = await social("accounts.assistantGrant", { accountId, permissions: [], expectedVersion: initialGrant.result.assistantGrant.version });
    expect(heldGrant.error).toBeDefined();
    const heldList = await social("snapshot", {});
    expect(heldList.result.accounts.find((item: { id: string }) => item.id === accountId).assistantGrantPending).toEqual({ permissions: [] });
    const heldDiscovery = await call("voice.tools.call", { threadId: thread.id, family: "social", action: "accounts.list", input: {}, requestId: "voice-held-discovery", causalContextId: openedVoice.result.voiceContext.id });
    expect(heldDiscovery.error).toBeUndefined();
    expect(JSON.stringify(heldDiscovery.result.value)).not.toContain("Allowed");
    await store.db.prepare("DELETE FROM social_assistant_voice_leases WHERE thread_id=? AND generation_key=?").run(thread.id, "fixture-generation");
    await store.db.prepare("DELETE FROM social_assistant_revocations WHERE account_id=?").run(accountId);
    model.replies = [
      JSON.stringify({ type: "tool", family: "social", action: "accounts.list", input: {} }),
      JSON.stringify({ type: "tool", family: "social", action: "policy.get", accountId, input: { accountId } }),
      JSON.stringify({ type: "final", text: "Read the allowed account." }),
    ];
    const reply = await call("assistant.request", { op: "threads.send", threadId: thread.id, via: "text", text: "Read my granted account", idempotencyKey: "account-http" });
    expect(reply.error).toBeUndefined();
    expect(reply.result.messages.at(-1).text).toBe("Read the allowed account.");
    expect(model.prompts.join("\n")).not.toContain('"name":"Private"');
    model.replies = [JSON.stringify({ type: "tool", family: "social", action: "policy.get", accountId: privateAccount.result.id, input: { accountId: privateAccount.result.id } })];
    const denied = await call("assistant.request", { op: "threads.send", threadId: thread.id, via: "text", text: "Read an ungranted account", idempotencyKey: "denied-account-http" });
    expect(denied.error).toContain("not granted");
    const turns = await store.db.prepare("SELECT value FROM assistant_runtime WHERE id LIKE 'room-turn:%'").all();
    expect(JSON.stringify(turns)).not.toContain('"name":"Private"');
    const beforeRevoke = await call("assistant.request", { op: "threads.messages", threadId: thread.id });
    expect(beforeRevoke.result.messages.some((message: { text: string }) => message.text === "Read the allowed account.")).toBe(true);
    model.prompts = [];
    model.replies = [JSON.stringify({ type: "final", text: "Follow-up complete." })];
    const followup = await call("assistant.request", { op: "threads.send", threadId: thread.id, via: "text", text: "Continue", idempotencyKey: "account-followup" });
    expect(followup.error).toBeUndefined();
    expect(model.prompts.join("\n")).toContain("Read the allowed account.");
    const revoked = await social("accounts.assistantGrant", { accountId, permissions: [], expectedVersion: initialGrant.result.assistantGrant.version });
    expect(revoked.error).toBeUndefined();
    const revokedObservation = await call("voice.tools.call", { threadId: thread.id, accountId, family: "conversation", action: "observations.read", input: {}, requestId: "revoked-observations" });
    expect(revokedObservation.error).toContain("active voice generation can be revoked");
    const afterRevoke = await call("assistant.request", { op: "threads.messages", threadId: thread.id });
    expect(afterRevoke.result.messages.some((message: { text: string }) => message.text === "Read the allowed account.")).toBe(false);
    expect(afterRevoke.result.messages.some((message: { text: string }) => message.text === "Observation checked.")).toBe(false);
    expect(afterRevoke.result.messages.some((message: { text: string }) => message.text.includes("source access changed"))).toBe(true);
    const deniedSearch = await call("assistant.request", { op: "conversations.search", threadId: thread.id, query: "allowed" });
    expect(deniedSearch.error).toBeUndefined();
    expect(deniedSearch.result.messages).toEqual([]);
    const regrant = await social("accounts.assistantGrant", { accountId, permissions: ["read"], expectedVersion: revoked.result.assistantGrant.version });
    expect(regrant.error).toBeUndefined();
    const afterRegrant = await call("assistant.request", { op: "threads.messages", threadId: thread.id });
    expect(afterRegrant.result.messages.some((message: { text: string }) => message.text === "Read the allowed account.")).toBe(false);
    expect(afterRegrant.result.messages.some((message: { text: string }) => message.text === "Follow-up complete.")).toBe(false);
    model.prompts = [];
    model.replies = [JSON.stringify({ type: "final", text: "Fresh answer." })];
    const fresh = await call("assistant.request", { op: "threads.send", threadId: thread.id, via: "text", text: "Start again", idempotencyKey: "account-after-revoke" });
    expect(fresh.error).toBeUndefined();
    expect(model.prompts.join("\n")).not.toContain("Read the allowed account.");
    expect(model.prompts.join("\n")).not.toContain("Follow-up complete.");
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await server.closeResources(); await engine.close(); await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 15000);


