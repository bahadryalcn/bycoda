import { expect, it, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

const model = vi.hoisted(() => ({ step: 0, source: "note", projectId: "" }));
vi.mock("../core/assistant-text", async (original) => ({
  ...(await original<typeof import("../core/assistant-text")>()),
  assistantText: () => async (_profile: unknown, prompt: string) => {
    let response: unknown;
    const target = model.source === "native-session" ? { projectId: model.projectId } : {};
    const input =
      model.source === "native-session"
        ? { source: model.source }
        : { nativeLibrary: true, source: model.source };
    if (model.step++ === 0)
      response = {
        type: "tool",
        family: "conversation",
        action: "observations.read",
        ...target,
        input,
      };
    else if (model.step === 2)
      response = {
        type: "tool",
        family: "conversation",
        action: "observations.resnapshot",
        ...target,
        input,
      };
    else if (model.step === 3) {
      const id = prompt.match(/"snapshotId"\s*:\s*"([^"]+)"/)?.[1];
      if (!id) throw new Error("Fixture baseline page was not delivered to model");
      response = {
        type: "tool",
        family: "conversation",
        action: "observations.resnapshot",
        ...target,
        input: { ...input, snapshotId: id, offset: 0 },
      };
    } else response = { type: "final", text: "Native baseline reviewed." };
    return { text: JSON.stringify(response), tokens: 10 };
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

it.each(["note", "server", "crew", "native-session"])(
  "recovers %s source through real Host HTTP and signed relay",
  async (source) => {
    model.source = source;
    const dir = mkdtempSync(join(tmpdir(), "native-observation-http-"));
    const store = new HostStore(join(dir, "host.db"));
    await store.ready;
    const project = await store.addProject(dir, "Fixture");
    model.projectId = project.id;
    const key = generateKeyPairSync("ed25519"),
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
      const call = async (method: string, params: Record<string, unknown>) =>
        (await (
          await fetch(endpoint, {
            method: "POST",
            headers: { Authorization: `Bearer ${device.token}` },
            body: JSON.stringify({
              version: 1,
              environmentId: store.environmentId,
              method,
              params,
            }),
          })
        ).json()) as { result?: any; error?: string };
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
        if (!challenge) throw new Error("Fixture challenge unavailable");
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
      let sequence = 0,
        gap = true,
        completed = 0,
        settled = false;
      const turn = call("assistant.request", {
        op: "threads.send",
        threadId: thread,
        via: "text",
        text: "Check Notes",
        idempotencyKey: "turn",
      }).finally(() => {
        settled = true;
      });
      for (let i = 0; i < 2000 && !settled; i++) {
        for (const request of (await call("conversation.desktop.take", {})).result ?? []) {
          expect(
            (
              await call("native.services.conversation.desktop.authorize", {
                id: request.id,
                action: request.action,
              })
            ).result,
          ).toEqual({ authorized: true });
          const common = {
            environmentId: store.environmentId,
            threadId: thread,
            issuer: "window",
            relayId: request.id,
            requestId: request.input.requestId,
            operationHash: request.input.operationHash,
            projectionRevision: 1,
            policyDigest: "a".repeat(64),
            privacyRevision: 1,
          };
          let result: unknown;
          if (request.action === "organization.read")
            result = { items: [{ cwd: project.cwd }], nextOffset: null };
          else if (request.action === "privacy.account.capture")
            result = await signed("assistant.account.capture", { ...common, sequence: ++sequence });
          else if (request.action === "privacy.scope.capture")
            result = await signed("assistant.visibility.capture", {
              ...common,
              projectId: project.id,
              targetCwd: project.cwd,
              action: request.input.action,
              visibleCwds: [project.cwd],
              sequence: ++sequence,
            });
          else if (
            request.action === "observations.native.baseline" ||
            request.action === "observations.native.projectBaseline"
          )
            result = await signed("assistant.observations.baseline", {
              ...common,
              source,
              ...(source === "native-session"
                ? { projectId: project.id, targetCwd: project.cwd }
                : {}),
              page: {
                fingerprint: (gap ? "b" : "c").repeat(64),
                offset: 0,
                nextOffset: 0,
                total: 0,
                watermark: 0,
                sourceGap: gap,
                entries: [],
              },
            });
          else if (
            request.action === "observations.native.complete" ||
            request.action === "observations.native.projectComplete"
          ) {
            completed++;
            result = await signed("assistant.observations.complete", {
              ...common,
              source,
              ...(source === "native-session"
                ? { projectId: project.id, targetCwd: project.cwd }
                : {}),
              fingerprint: request.input.fingerprint,
              watermark: request.input.watermark,
              completed: true,
            });
            gap = false;
          } else throw new Error(`Unexpected relay action ${request.action}`);
          expect(
            (await call("conversation.desktop.finish", { id: request.id, result })).error,
          ).toBeUndefined();
        }
        if (!settled) await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const result = await turn;
      expect(result.error).toBeUndefined();
      expect(result.result.messages.at(-1).text).toBe("Native baseline reviewed.");
      expect(completed).toBe(source === "crew" ? 0 : 1);
    } finally {
      model.step = 0;
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await server.closeResources();
      await engine.close();
      await store.close();
      if (previous === undefined) delete process.env.BYCODA_NATIVE_ADMISSION_REGISTRY;
      else process.env.BYCODA_NATIVE_ADMISSION_REGISTRY = previous;
      rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    }
  },
  30000,
);
