import { expect, it, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

vi.mock("../core/assistant-text", async (original) => ({
  ...(await original<typeof import("../core/assistant-text")>()),
  assistantText: () => async () => ({ text: "Qualified summary", tokens: 10 }),
}));
import { HostStore } from "../../store";
import { HostEngine } from "../../engine";
import { createHostServer } from "../../server";
import {
  nativeAdmissionBytes,
  nativeAdmissionDigest,
  nativeAdmissionFingerprint,
} from "../native/assistant-native-admission";
import type { HostAssistantThreadSummaries } from "./assistant-thread-summary";

it("summarizes a project through the real global Room native source and persists the captured identity", async () => {
  const directory = mkdtempSync(join(tmpdir(), "assistant-summary-source-http-"));
  const store = new HostStore(join(directory, "host.db"));
  const project = await store.addProject(directory, "Fixture");
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
          visibleProjects: [{ cwd: project.cwd }],
        },
      },
    });
    expect(
      (await call("native.services.assistant.visibility.reopen", { input: reopen })).error,
    ).toBeUndefined();
    server.desktop.live.beat({
      clientId: "fixture",
      sessions: [],
      projectDirectoryRevision: "1",
      projectDirectory: {
        version: 1,
        groups: [],
        excludedPaths: [],
        excludedGroupIds: [],
        projects: [{ cwd: project.cwd, name: "Fixture" }],
      },
    });
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
    const actor = (await call("assistant.request", { op: "threads.open" })).result.thread.id;
    const target = (await call("assistant.request", { op: "threads.open", projectId: project.id }))
      .result.thread.id;
    expect(actor).not.toBe(target);
    for (let i = 0; i < 20; i++)
      await server.assistant.request(
        {
          op: "threads.append",
          threadId: target,
          role: "user",
          via: "voice",
          text: `Fixture ${i}`,
          idempotencyKey: `message-${i}`,
        },
        "owner",
      );
    await call("conversation.desktop.take", {});
    const summaries = (
      server.assistant as unknown as { threadSummaries: HostAssistantThreadSummaries }
    ).threadSummaries;
    let settled = false,
      sequence = 0;
    const pending = summaries.drain().finally(() => {
      settled = true;
    });
    for (let i = 0; i < 1000 && !settled; i++) {
      for (const request of (await call("conversation.desktop.take", {})).result ?? []) {
        expect(request).toMatchObject({
          action: "privacy.scope.capture",
          threadId: actor,
          projectId: project.id,
          targetProjectCwd: project.cwd,
        });
        expect(
          (
            await call("native.services.conversation.desktop.authorize", {
              id: request.id,
              action: request.action,
            })
          ).result,
        ).toEqual({ authorized: true });
        const result = await signed("assistant.visibility.capture", {
          environmentId: store.environmentId,
          threadId: actor,
          issuer: "window",
          relayId: request.id,
          projectId: project.id,
          targetCwd: project.cwd,
          action: request.input.action,
          requestId: request.input.requestId,
          operationHash: request.input.operationHash,
          projectionRevision: 1,
          policyDigest: "a".repeat(64),
          privacyRevision: 1,
          visibleCwds: [project.cwd],
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
    const saved = await summaries.proof(target, "Qualified summary");
    expect(saved).toBeDefined();
    expect(await summaries.sourceProofs(target, saved!.id)).toEqual({
      projectProofs: [{ projectId: project.id, cwd: project.cwd }],
      accountProofs: [],
    });
  } finally {
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
