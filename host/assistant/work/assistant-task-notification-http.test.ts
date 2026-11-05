import { expect, it } from "vitest";
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

it("hands an opted-in task notification to the exact signed native owner without replay", async () => {
  const dir = mkdtempSync(join(tmpdir(), "assistant-task-notification-http-"));
  const store = new HostStore(join(dir, "host.db"));
  const project = await store.addProject(dir, "Project");
  const pair = generateKeyPairSync("ed25519"),
    registry = join(dir, "native.json");
  writeFileSync(
    registry,
    JSON.stringify({
      version: 1,
      generation: "a".repeat(64),
      entries: [
        {
          installationId: "desktop",
          hostId: store.environmentId,
          publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
          fingerprint: nativeAdmissionFingerprint(pair.publicKey),
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
    const owner = await store.issueDevice("Owner"),
      other = await store.issueDevice("Other");
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
    const call = async (method: string, params: Record<string, unknown>, token = owner.token) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
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
      if (!challenge) throw new Error("Native fixture challenge unavailable.");
      return {
        operationJson,
        proof: {
          challenge,
          signature: sign(null, nativeAdmissionBytes(challenge), pair.privateKey).toString(
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
        projects: [{ cwd: project.cwd, name: "Project" }],
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
            dailyTokenBudget: 10000,
            autonomy: "report",
            observationTaskDone: true,
            notificationAway: "all",
            quietStart: 0,
            quietEnd: 0,
          },
        })
      ).error,
    ).toBeUndefined();
    const manual = (await call("assistant.request", { op: "manual.list" })).result.manual.policy;
    expect(
      (
        await call("assistant.request", {
          op: "manual.policy",
          expectedVersion: manual.version,
          enabled: true,
          projectIds: [project.id],
        })
      ).error,
    ).toBeUndefined();
    await call("assistant.request", { op: "presence.set", state: "away" });
    const threadId = (await call("assistant.request", { op: "threads.open" })).result.thread.id;
    await store.db.prepare("INSERT INTO tasks(id,value) VALUES(?,?)").run(
      "task",
      JSON.stringify({
        id: "task",
        projectId: project.id,
        createdAt: 1,
        updatedAt: Date.now(),
        status: "done",
      }),
    );
    await call("conversation.desktop.take", {});
    let sequence = 0,
      delivered = 0,
      acceptedInput: any;
    const driveTick = async (unknownDelivery = false) => {
      let settled = false;
      const ticking = server.assistant.tick().finally(() => {
        settled = true;
      });
      while (!settled) {
        const pending = (await call("conversation.desktop.take", {})).result ?? [];
        for (const request of pending) {
          const params = { id: request.id, action: request.action };
          expect(
            (await call("native.services.conversation.desktop.authorize", params)).result,
          ).toEqual({ authorized: true });
          expect(
            (await call("native.services.conversation.desktop.authorize", params, other.token))
              .result,
          ).toEqual({ authorized: false });
          let result: unknown;
          if (request.action === "privacy.scope.capture") {
            result = await signed("assistant.visibility.capture", {
              environmentId: store.environmentId,
              threadId,
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
          } else {
            expect(["assistant.notification.status", "assistant.notification.deliver"]).toContain(
              request.action,
            );
            if (request.action === "assistant.notification.deliver") {
              delivered++;
              const handoff = {
                threadId,
                notificationId: request.input.notificationId,
                operationHash: request.input.operationHash,
              };
              if (!unknownDelivery) acceptedInput = handoff;
              expect(
                (await call("native.services.assistant.notification.authorize", { input: handoff }))
                  .result,
              ).toEqual({ authorized: true });
              expect(
                (
                  await call(
                    "native.services.assistant.notification.authorize",
                    { input: handoff },
                    other.token,
                  )
                ).result,
              ).toEqual({ authorized: false });
              if (unknownDelivery) {
                expect(
                  (
                    await call("conversation.desktop.finish", {
                      id: request.id,
                      error: "Outcome unknown",
                    })
                  ).error,
                ).toBeUndefined();
                continue;
              }
            }
            result = await signed("assistant.notification.receipt", {
              environmentId: store.environmentId,
              threadId,
              issuer: "window",
              relayId: request.id,
              notificationId: request.input.notificationId,
              kind: request.input.kind,
              requestId: request.input.requestId,
              operationHash: request.input.operationHash,
              permission: "granted",
              state: request.action === "assistant.notification.deliver" ? "accepted" : "unknown",
            });
          }
          expect(
            (await call("conversation.desktop.finish", { id: request.id, result })).error,
          ).toBeUndefined();
        }
        if (!settled) await new Promise((resolve) => setTimeout(resolve, 5));
      }
      await ticking;
    };
    await driveTick();
    expect(delivered).toBe(1);
    expect(
      (await call("native.services.assistant.notification.authorize", { input: acceptedInput }))
        .result,
    ).toEqual({ authorized: true });
    await call("assistant.request", { op: "presence.set", state: "dnd" });
    expect(
      (await call("native.services.assistant.notification.authorize", { input: acceptedInput }))
        .result,
    ).toEqual({ authorized: false });
    await call("assistant.request", { op: "presence.set", state: "away" });
    const current = (await call("assistant.request", { op: "snapshot" })).result.snapshot.profile;
    await call("assistant.request", {
      op: "profile.update",
      expectedVersion: current.version,
      patch: { observationTaskDone: false },
    });
    expect(
      (await call("native.services.assistant.notification.authorize", { input: acceptedInput }))
        .result,
    ).toEqual({ authorized: false });
    const optedOut = (await call("assistant.request", { op: "snapshot" })).result.snapshot.profile;
    await call("assistant.request", {
      op: "profile.update",
      expectedVersion: optedOut.version,
      patch: { observationTaskDone: true },
    });
    await store.db
      .prepare(
        "UPDATE assistant_observation_source_revisions SET version=version+1 WHERE source='task' AND source_id='task'",
      )
      .run();
    expect(
      (await call("native.services.assistant.notification.authorize", { input: acceptedInput }))
        .result,
    ).toEqual({ authorized: false });
    await store.db.prepare("INSERT INTO tasks(id,value) VALUES(?,?)").run(
      "task-unknown",
      JSON.stringify({
        id: "task-unknown",
        projectId: project.id,
        createdAt: 2,
        updatedAt: Date.now(),
        status: "done",
      }),
    );
    await driveTick(true);
    expect(delivered).toBe(2);
    await driveTick(true);
    expect(delivered).toBe(2);
    const recover = async (params: Record<string, unknown>) => {
      let done = false;
      const result = call("assistant.request", params).finally(() => {
        done = true;
      });
      while (!done) {
        for (const request of (await call("conversation.desktop.take", {})).result ?? []) {
          let payload: unknown;
          if (request.action === "organization.read")
            payload = { items: [{ cwd: project.cwd }], nextOffset: null };
          else if (request.action === "privacy.scope.capture")
            payload = await signed("assistant.visibility.capture", {
              environmentId: store.environmentId,
              threadId,
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
          else {
            expect(request.action).toBe("assistant.notification.status");
            payload = await signed("assistant.notification.receipt", {
              environmentId: store.environmentId,
              threadId,
              issuer: "window",
              relayId: request.id,
              notificationId: request.input.notificationId,
              kind: request.input.kind,
              requestId: request.input.requestId,
              operationHash: request.input.operationHash,
              permission: "granted",
              state: "unknown",
            });
          }
          await call("conversation.desktop.finish", { id: request.id, result: payload });
        }
        if (!done) await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return result;
    };
    const pendingRecovery = await recover({
      op: "observation.delivery.list",
      projectId: project.id,
    });
    expect(pendingRecovery.error).toBeUndefined();
    expect(pendingRecovery.result.observationDeliveries).toHaveLength(1);
    const pendingId = pendingRecovery.result.observationDeliveries[0].notificationId;
    const refreshed = await recover({
      op: "observation.delivery.refresh",
      projectId: project.id,
      notificationId: pendingId,
    });
    expect(refreshed.result.observationDeliveries[0].state).toBe("unknown");
    expect(delivered).toBe(2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await server.closeResources();
    await engine.close();
    await store.close();
    if (previous === undefined) delete process.env.BYCODA_NATIVE_ADMISSION_REGISTRY;
    else process.env.BYCODA_NATIVE_ADMISSION_REGISTRY = previous;
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
}, 30000);
