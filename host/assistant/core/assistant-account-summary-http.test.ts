import { expect, it, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

const model = vi.hoisted(() => ({
  replies: [] as string[],
  pause: undefined as undefined | (() => Promise<void>),
}));
vi.mock("./assistant-text", async (original) => ({
  ...(await original<typeof import("./assistant-text")>()),
  assistantText: () => async () => {
    const text = model.replies.shift() ?? "Qualified account summary";
    if (text === "Qualified account summary" && model.pause) await model.pause();
    return { text, tokens: 10 };
  },
}));
import { HostStore } from "../../store";
import { HostEngine } from "../../engine";
import { createHostServer } from "../../server";
import {
  nativeAdmissionBytes,
  nativeAdmissionDigest,
  nativeAdmissionFingerprint,
} from "../native/assistant-native-admission";
import type { HostAssistantThreadSummaries } from "../summary/assistant-thread-summary";

it("summarizes a granted account through the projectless native Room and fences revocation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "assistant-account-summary-"));
  const store = new HostStore(join(directory, "host.db"));
  await store.ready;
  const key = generateKeyPairSync("ed25519"),
    registry = join(directory, "native.json");
  writeFileSync(
    registry,
    JSON.stringify({
      version: 1,
      generation: "a".repeat(64),
      entries: [
        {
          installationId: "desktop",
          hostId: store.environmentId,
          publicKey: key.publicKey.export({ type: "spki", format: "pem" }).toString(),
          fingerprint: nativeAdmissionFingerprint(key.publicKey),
        },
      ],
    }),
  );
  const previous = process.env.BYCODA_NATIVE_ADMISSION_REGISTRY;
  process.env.BYCODA_NATIVE_ADMISSION_REGISTRY = registry;
  const engine = new HostEngine(store, {}),
    server = await createHostServer(engine, ["codex"]);
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const device = await store.issueDevice("Owner"),
      endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
    const call = async (method: string, params: Record<string, unknown>) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${device.token}` },
        body: JSON.stringify({ version: 1, environmentId: store.environmentId, method, params }),
      });
      return (await response.json()) as { result?: any; error?: string };
    };
    const signed = async (action: string, value: unknown) => {
      const operationJson = JSON.stringify(value);
      const challenge = (
        await call("native.services.assistant.delegation.nativeChallenge", {
          input: {
            installationId: "desktop",
            hostId: store.environmentId,
            action,
            requestDigest: nativeAdmissionDigest(operationJson),
          },
        })
      ).result;
      if (!challenge) throw new Error("Fixture challenge unavailable.");
      return {
        operationJson,
        proof: {
          challenge,
          signature: sign(null, nativeAdmissionBytes(challenge), key.privateKey).toString(
            "base64url",
          ),
        },
      };
    };
    const reopen = await signed("assistant.visibility.reopen", {
      epoch: 0,
      projection: {
        version: 1,
        revision: 1,
        operationId: "projection",
        actor: "window",
        snapshot: {
          schemaVersion: 1,
          policyDigest: "a".repeat(64),
          issuer: "window",
          privacyRevision: 1,
          visibleProjects: [],
        },
      },
    });
    expect(
      (await call("native.services.assistant.visibility.reopen", { input: reopen })).error,
    ).toBeUndefined();
    const social = (action: string, input: Record<string, unknown>) =>
      call("social.request", { action, input });
    const account = await social("accounts.create", {
      platform: "x",
      name: "Allowed",
      accountType: "member",
      projectIds: [],
    });
    expect(account.error).toBeUndefined();
    const grant = await social("accounts.assistantGrant", {
      accountId: account.result.id,
      permissions: ["read"],
      expectedVersion: null,
    });
    expect(grant.error).toBeUndefined();
    const version = grant.result.assistantGrant.version;
    const snapshot = (await call("assistant.request", { op: "snapshot" })).result.snapshot;
    expect(
      (
        await call("assistant.request", {
          op: "profile.update",
          expectedVersion: snapshot.profile.version,
          patch: {
            name: "Assistant",
            enabled: true,
            setupComplete: true,
            autonomy: "report",
            dailyTokenBudget: 100000,
            summaryRefreshMessages: 20,
            execution: {
              harness: "codex",
              model: "fixture",
              modelSettings: {},
              runtimeMode: "supervised",
              maxRunMinutes: 60,
            },
          },
        })
      ).error,
    ).toBeUndefined();
    const thread = (await call("assistant.request", { op: "threads.open" })).result.thread.id;
    model.replies = [
      JSON.stringify({
        type: "tool",
        family: "social",
        action: "policy.get",
        accountId: account.result.id,
        input: { accountId: account.result.id },
      }),
      JSON.stringify({ type: "final", text: "Account checked." }),
    ];
    const turn = await call("assistant.request", {
      op: "threads.send",
      threadId: thread,
      via: "text",
      text: "Read my account",
      idempotencyKey: "account-turn",
    });
    expect(turn.error).toBeUndefined();
    expect(turn.result.messages.at(-1).text).toBe("Account checked.");
    for (let i = 0; i < 18; i++)
      await server.assistant.request(
        {
          op: "threads.append",
          threadId: thread,
          role: "user",
          via: "voice",
          text: `Fixture ${i}`,
          idempotencyKey: `message-${i}`,
        },
        "owner",
      );
    const summaries = (
      server.assistant as unknown as { threadSummaries: HostAssistantThreadSummaries }
    ).threadSummaries;
    let sequence = 0,
      settled = false;
    const pending = summaries.drain().finally(() => {
      settled = true;
    });
    for (let i = 0; i < 1000 && !settled; i++) {
      for (const request of (await call("conversation.desktop.take", {})).result ?? []) {
        expect(request).toMatchObject({ action: "privacy.account.capture", threadId: thread });
        expect(request).not.toHaveProperty("projectId");
        expect(request).not.toHaveProperty("targetProjectCwd");
        expect(
          (
            await call("native.services.conversation.desktop.authorize", {
              id: request.id,
              action: request.action,
            })
          ).result,
        ).toEqual({ authorized: true });
        const result = await signed("assistant.account.capture", {
          environmentId: store.environmentId,
          threadId: thread,
          issuer: "window",
          relayId: request.id,
          requestId: request.input.requestId,
          operationHash: request.input.operationHash,
          projectionRevision: 1,
          policyDigest: "a".repeat(64),
          privacyRevision: 1,
          sequence: ++sequence,
        });
        expect(
          (await call("conversation.desktop.finish", { id: request.id, result })).error,
        ).toBeUndefined();
      }
      if (!settled) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await pending;
    expect(sequence).toBe(2);
    const saved = await summaries.proof(thread, "Qualified account summary");
    expect(saved).toBeDefined();
    expect(await summaries.sourceProofs(thread, saved!.id)).toEqual({
      projectProofs: [],
      accountProofs: [{ accountId: account.result.id, version }],
    });
    let providerEntered = false,
      releaseProvider!: () => void;
    model.pause = () => {
      providerEntered = true;
      return new Promise<void>((resolve) => {
        releaseProvider = resolve;
      });
    };
    for (let i = 0; i < 20; i++)
      await server.assistant.request(
        {
          op: "threads.append",
          threadId: thread,
          role: "user",
          via: "voice",
          text: `Later ${i}`,
          idempotencyKey: `later-${i}`,
        },
        "owner",
      );
    settled = false;
    const refresh = summaries.drain().finally(() => {
      settled = true;
    });
    for (let i = 0; i < 1000 && !providerEntered && !settled; i++) {
      for (const request of (await call("conversation.desktop.take", {})).result ?? []) {
        expect(request).toMatchObject({ action: "privacy.account.capture", threadId: thread });
        expect(request).not.toHaveProperty("projectId");
        const result = await signed("assistant.account.capture", {
          environmentId: store.environmentId,
          threadId: thread,
          issuer: "window",
          relayId: request.id,
          requestId: request.input.requestId,
          operationHash: request.input.operationHash,
          projectionRevision: 1,
          policyDigest: "a".repeat(64),
          privacyRevision: 1,
          sequence: ++sequence,
        });
        expect(
          (await call("conversation.desktop.finish", { id: request.id, result })).error,
        ).toBeUndefined();
      }
      if (!providerEntered && !settled) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(providerEntered).toBe(true);
    let revoked = false;
    const revoke = social("accounts.assistantGrant", {
      accountId: account.result.id,
      permissions: [],
      expectedVersion: version,
    }).finally(() => {
      revoked = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(revoked).toBe(false);
    releaseProvider();
    await refresh;
    expect((await revoke).error).toBeUndefined();
    const artifacts = await store.db.prepare("SELECT id FROM assistant_summary_artifacts").all();
    expect(artifacts).toHaveLength(1);
  } finally {
    model.pause = undefined;
    model.replies = [];
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await server.closeResources();
    await engine.close();
    await store.close();
    if (previous === undefined) delete process.env.BYCODA_NATIVE_ADMISSION_REGISTRY;
    else process.env.BYCODA_NATIVE_ADMISSION_REGISTRY = previous;
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  }
}, 30000);
