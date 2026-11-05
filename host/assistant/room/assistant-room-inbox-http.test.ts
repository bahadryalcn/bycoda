import { expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { HostStore } from "../../store";
import { HostEngine } from "../../engine";
import { createHostServer } from "../../server";
import {
  nativeAdmissionBytes,
  nativeAdmissionDigest,
  nativeAdmissionFingerprint,
} from "../native/assistant-native-admission";

it("routes project Room Inbox through signed scope and retains uncertain writes without replay", async () => {
  const directory = mkdtempSync(join(tmpdir(), "room-inbox-http-"));
  const store = new HostStore(join(directory, "host.db"));
  await store.ready;
  const project = await store.addProject(directory, "Inbox fixture");
  const keys = generateKeyPairSync("ed25519"),
    registry = join(directory, "registry.json");
  writeFileSync(
    registry,
    JSON.stringify({
      version: 1,
      generation: "a".repeat(64),
      entries: [
        {
          installationId: "desktop",
          hostId: store.environmentId,
          publicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
          fingerprint: nativeAdmissionFingerprint(keys.publicKey),
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
    const device = await store.issueDevice("Fixture owner"),
      otherDevice = await store.issueDevice("Other fixture device");
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
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
      if (!challenge) throw new Error("Missing fixture Native challenge");
      return {
        operationJson,
        proof: {
          challenge,
          signature: sign(null, nativeAdmissionBytes(challenge), keys.privateKey).toString(
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
    const threadId = (await call("assistant.request", { op: "threads.open" })).result.thread.id;
    await call("conversation.desktop.take", {});
    const item = {
      provider: "github",
      kind: "issue",
      number: 7,
      repo: "fixture/repo",
      projectPath: project.cwd,
    };
    const proof = "fixture-account-proof";
    let sequence = 0,
      effects = 0,
      validAccount = true,
      malformedCheck: "false" | "extra" | undefined;
    const seen: any[] = [];
    const run = async (action: string, input: Record<string, unknown>, requestId: string) => {
      let settled = false;
      const pending = call("voice.tools.call", {
        family: "conversation",
        action,
        projectId: project.id,
        threadId,
        requestId,
        input,
      }).finally(() => {
        settled = true;
      });
      for (let i = 0; i < 2000 && !settled; i++) {
        for (const request of (await call("conversation.desktop.take", {})).result ?? []) {
          if (request.action === "organization.read") {
            expect(request.threadId).toBe(threadId);
            expect(request).not.toHaveProperty("sessionId");
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
                await call("conversation.desktop.finish", {
                  id: request.id,
                  result: { items: [{ cwd: project.cwd }], nextOffset: null },
                })
              ).error,
            ).toBeUndefined();
            continue;
          }
          expect(
            ["privacy.scope.capture", "inbox.room.execute"],
            JSON.stringify(request),
          ).toContain(request.action);
          expect(request).toMatchObject({
            threadId,
            projectId: project.id,
            targetProjectCwd: project.cwd,
          });
          expect(request).not.toHaveProperty("sessionId");
          const admission = await call("native.services.conversation.desktop.authorize", {
            id: request.id,
            action: request.action,
          });
          expect(admission, `${request.action}: ${JSON.stringify(admission)}`).toMatchObject({
            result: { authorized: true },
          });
          if (request.action === "privacy.scope.capture") {
            const result = await signed("assistant.visibility.capture", {
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
            expect(
              (await call("conversation.desktop.finish", { id: request.id, result })).error,
            ).toBeUndefined();
          } else {
            expect(request.action).toBe("inbox.room.execute");
            const otherResponse = await fetch(endpoint, {
              method: "POST",
              headers: { Authorization: `Bearer ${otherDevice.token}` },
              body: JSON.stringify({
                version: 1,
                environmentId: store.environmentId,
                method: "native.services.conversation.desktop.authorize",
                params: { id: request.id, action: request.action },
              }),
            });
            expect(((await otherResponse.json()) as { result?: unknown }).result).toEqual({
              authorized: false,
            });
            seen.push(request.input);
            const operation = request.input.operation;
            if (operation.action === "list") {
              expect(request.input.provider).toBe("github");
              expect(operation.projects).toEqual([{ path: project.cwd }]);
              expect(
                (
                  await call("conversation.desktop.finish", {
                    id: request.id,
                    result: { accountProof: proof, items: [item], errors: {}, limited: true },
                  })
                ).error,
              ).toBeUndefined();
            } else if (operation.action === "source-check") {
              expect(request.input.accountProof).toBe(proof);
              expect(operation.cwd).toBe(project.cwd);
              await call(
                "conversation.desktop.finish",
                validAccount
                  ? {
                      id: request.id,
                      result:
                        malformedCheck === "false"
                          ? { current: false }
                          : malformedCheck === "extra"
                            ? { current: true, extra: true }
                            : { current: true },
                    }
                  : { id: request.id, error: "Account changed" },
              );
            } else {
              expect(operation).toMatchObject({
                action: "comment",
                cwd: project.cwd,
                item,
                body: "Fixture comment",
              });
              expect(request.input.accountProof).toBe(proof);
              effects++;
              await call("conversation.desktop.finish", {
                id: request.id,
                error: "Fixture lost Native reply",
              });
            }
          }
        }
        if (!settled) await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return await pending;
    };
    const listed = await run(
      "inbox.providers.list",
      { requestId: "list", provider: "github" },
      "list",
    );
    expect(listed.error).toBeUndefined();
    expect(listed.result).toMatchObject({
      state: "completed",
      result: { accountProof: proof, items: [item] },
    });
    const input = {
      requestId: "write",
      accountProof: proof,
      item: { provider: item.provider, kind: item.kind, number: item.number, repo: item.repo },
      body: "Fixture comment",
    };
    const write = await run("inbox.comment", input, "write");
    expect(write.error, JSON.stringify(write)).toBeUndefined();
    expect(write.result).toMatchObject({ state: "uncertain" });
    expect(
      (await run("inbox.result", { requestId: "write" }, "write-status")).result,
    ).toMatchObject({ state: "uncertain" });
    expect((await run("inbox.comment", input, "write")).result).toMatchObject({
      state: "uncertain",
    });
    expect(effects).toBe(1);
    expect((await run("inbox.result", { requestId: "list" }, "list-status")).result).toMatchObject({
      state: "completed",
    });
    malformedCheck = "false";
    const falseCheck = await run("inbox.result", { requestId: "list" }, "false-source-status");
    expect(JSON.stringify(falseCheck)).not.toContain("fixture/repo");
    malformedCheck = "extra";
    const extraCheck = await run("inbox.result", { requestId: "list" }, "extra-source-status");
    expect(JSON.stringify(extraCheck)).not.toContain("fixture/repo");
    malformedCheck = undefined;
    validAccount = false;
    const changed = await run("inbox.result", { requestId: "list" }, "changed-account");
    expect(JSON.stringify(changed)).not.toContain("fixture/repo");
    expect(changed.error ?? JSON.stringify(changed.result)).toMatch(/account|unavailable|changed/i);
    validAccount = true;
    await store.db
      .prepare("UPDATE projects SET cwd=? WHERE id=?")
      .run(join(directory, "changed-cwd"), project.id);
    const moved = await run("inbox.result", { requestId: "list" }, "changed-cwd-status");
    expect(JSON.stringify(moved)).not.toContain("fixture/repo");
    expect(moved.error ?? JSON.stringify(moved.result)).toMatch(
      /project|source|unavailable|changed/i,
    );
    expect(seen.filter((row) => row.operation.action === "comment")).toHaveLength(1);
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
