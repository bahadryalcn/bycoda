import { expect, it, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import {
  nativeAdmissionBytes,
  nativeAdmissionDigest,
  nativeAdmissionFingerprint,
} from "../native/assistant-native-admission";
import { HostStore } from "../../store";
import { HostEngine } from "../../engine";
import { createHostServer } from "../../server";
import { RealtimeVoice } from "../../../src/features/voice/model/realtimeVoice";
import {
  registerVoiceGenerationRetirement,
  retireVoiceGeneration,
} from "../../../src/features/voice/model/voiceGenerationRetirement";

it("holds account revocation until exact native relay certifies actual socket and audio closure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "room-voice-retirement-http-"));
  const store = new HostStore(join(directory, "host.db"));
  await store.ready;
  const pair = generateKeyPairSync("ed25519");
  const registry = join(directory, "native-registry.json");
  writeFileSync(
    registry,
    JSON.stringify({
      version: 1,
      generation: "a".repeat(64),
      entries: [
        {
          installationId: "fixture-desktop",
          hostId: store.environmentId,
          publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
          fingerprint: nativeAdmissionFingerprint(pair.publicKey),
        },
      ],
    }),
  );
  const previous = process.env.BYCODA_NATIVE_ADMISSION_REGISTRY;
  process.env.BYCODA_NATIVE_ADMISSION_REGISTRY = registry;
  const engine = new HostEngine(store, {});
  const server = await createHostServer(engine, ["codex"]);
  const audio = Promise.withResolvers<void>();
  let socketClose!: () => void;
  const socket = {
    readyState: 1,
    addEventListener: (_type: string, callback: () => void) => {
      socketClose = callback;
    },
    close: vi.fn(),
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  const contexts = [
    {
      state: "running",
      close: vi.fn(async function () {
        await audio.promise;
        this.state = "closed";
      }),
    },
    {
      state: "running",
      close: vi.fn(async function () {
        await audio.promise;
        this.state = "closed";
      }),
    },
  ];
  const track = {
    readyState: "live",
    onended: null,
    stop() {
      this.readyState = "ended";
    },
  };
  vi.stubGlobal("navigator", { mediaDevices: { removeEventListener() {} } });
  const voice = new RealtimeVoice(
    "openai",
    {
      state: () => {},
      reply: () => {},
      transcript: () => {},
      turnStart: () => {},
      playback: () => {},
      tool: async () => ({}),
      error: () => {},
    },
    "tr",
  );
  Object.assign(voice, {
    socket,
    input: contexts[0],
    output: contexts[1],
    stream: { getTracks: () => [track] },
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const owner = await store.issueDevice("Fixture owner");
    const other = await store.issueDevice("Other fixture device");
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
    const call = async (method: string, params: Record<string, unknown>, token = owner.token) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ version: 1, environmentId: store.environmentId, method, params }),
      });
      return (await response.json()) as { result?: any; error?: string };
    };
    const social = (action: string, input: Record<string, unknown>) =>
      call("social.request", { action, input });
    const account = await social("accounts.create", {
      platform: "x",
      name: "Fixture",
      accountType: "member",
      projectIds: [],
    });
    const accountId = account.result.id;
    const grant = await social("accounts.assistantGrant", {
      accountId,
      permissions: ["read"],
      expectedVersion: null,
    });
    expect(grant.error).toBeUndefined();
    const snapshot = await call("assistant.request", { op: "snapshot" });
    await call("assistant.request", {
      op: "profile.update",
      expectedVersion: snapshot.result.snapshot.profile.version,
      patch: {
        name: "Assistant",
        setupComplete: true,
        enabled: true,
        dailyTokenBudget: 100000,
        execution: {
          harness: "codex",
          model: "fixture",
          modelSettings: {},
          runtimeMode: "supervised",
          maxRunMinutes: 60,
        },
      },
    });
    const threadId = (await call("assistant.request", { op: "threads.open" })).result.thread.id;
    const ownerMessage = await call("assistant.request", {
      op: "threads.append",
      threadId,
      role: "user",
      via: "voice",
      text: "Read my account",
      idempotencyKey: "voice-owner",
    });
    const context = await call("assistant.request", {
      op: "voice.context.open",
      threadId,
      requestId: "voice-open",
      generationKey: "fixture-socket-generation",
      seedMessageIds: [],
      ownerMessageId: ownerMessage.result.message.id,
      contextProjectIds: [],
      summaryUsed: false,
    });
    const disclosure = await call("voice.tools.call", {
      threadId,
      family: "social",
      action: "accounts.list",
      input: {},
      requestId: "voice-read",
      causalContextId: context.result.voiceContext.id,
    });
    expect(disclosure.error).toBeUndefined();
    registerVoiceGenerationRetirement(
      "fixture-socket-generation",
      () => ({ environmentId: store.environmentId, threadId }),
      () => voice.retire(),
    );
    await call("conversation.desktop.take", {});
    let settled = false;
    const revoke = social("accounts.assistantGrant", {
      accountId,
      permissions: [],
      expectedVersion: grant.result.assistantGrant.version,
    }).finally(() => {
      settled = true;
    });
    let requests: any[] = [];
    for (let attempt = 0; attempt < 300 && !requests.length; attempt++) {
      requests = (await call("conversation.desktop.take", {})).result ?? [];
      if (!requests.length) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request).toMatchObject({
      action: "voice.generation.retire",
      threadId,
      input: { generationKey: "fixture-socket-generation" },
    });
    expect(
      (
        await call("native.services.conversation.desktop.authorize", {
          id: request.id,
          action: request.action,
        })
      ).result,
    ).toEqual({ authorized: true });
    expect(
      (
        await call(
          "native.services.conversation.desktop.authorize",
          { id: request.id, action: request.action },
          other.token,
        )
      ).result,
    ).toEqual({ authorized: false });
    let closed = false;
    const retirement = retireVoiceGeneration(request.input, {
      environmentId: store.environmentId,
      threadId,
    }).then((value) => {
      closed = true;
      return value;
    });
    await vi.waitFor(() => expect(socket.close).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    socket.readyState = 3;
    socketClose();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(closed).toBe(false);
    expect(settled).toBe(false);
    audio.resolve();
    expect(await retirement).toEqual({ retired: true, generationKey: "fixture-socket-generation" });
    expect(
      (
        await call("native.services.conversation.desktop.authorize", {
          id: request.id,
          action: request.action,
        })
      ).result,
    ).toEqual({ authorized: true });
    // Simulated native bridge signs only after real frontend retirement registry settles.
    const operationJson = JSON.stringify({
      environmentId: store.environmentId,
      threadId,
      issuer: "fixture-window",
      relayId: request.id,
      generationKey: request.input.generationKey,
      requestId: request.input.requestId,
      operationHash: request.input.operationHash,
    });
    const challengeResponse = await call("native.services.assistant.delegation.nativeChallenge", {
      input: {
        installationId: "fixture-desktop",
        hostId: store.environmentId,
        action: "assistant.voice.generation.retired",
        requestDigest: nativeAdmissionDigest(operationJson),
      },
    });
    expect(challengeResponse.error).toBeUndefined();
    const challenge = challengeResponse.result;
    const proof = {
      challenge,
      signature: sign(null, nativeAdmissionBytes(challenge), pair.privateKey).toString("base64url"),
    };
    expect(
      (
        await call("conversation.desktop.finish", {
          id: request.id,
          result: { operationJson, proof },
        })
      ).error,
    ).toBeUndefined();
    expect((await revoke).error).toBeUndefined();
    expect(
      await store.db
        .prepare(
          "SELECT account_id FROM social_assistant_voice_leases WHERE thread_id=? AND generation_key=?",
        )
        .all(threadId, "fixture-socket-generation"),
    ).toEqual([]);
  } finally {
    audio.resolve();
    socket.readyState = 3;
    socketClose?.();
    vi.unstubAllGlobals();
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
