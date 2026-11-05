import { expect, it, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { HostStore } from "../../store";
import { HostEngine } from "../../engine";
import { createHostServer } from "../../server";
import { SocialService } from "../../social/social";
import { platformRequirements } from "../../../src/integrations/social/capabilities";
import {
  SOCIAL_PLATFORMS,
  type SocialAccount,
  type SocialContact,
  type SocialDraft,
  type SocialJob,
} from "../../../src/features/social/model/social";
import {
  SocialPlatformError,
  type SocialAdapter,
  type SocialAdapters,
} from "../../../src/integrations/social/adapter";
import {
  nativeAdmissionBytes,
  nativeAdmissionDigest,
  nativeAdmissionFingerprint,
} from "../native/assistant-native-admission";

it("runs reviewed Room Social send over HTTP with signed project and account admission", async () => {
  const directory = mkdtempSync(join(tmpdir(), "room-social-http-"));
  const store = new HostStore(join(directory, "host.db"));
  await store.ready;
  const project = await store.addProject(directory, "Fixture");
  const pair = generateKeyPairSync("ed25519"),
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
          publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
          fingerprint: nativeAdmissionFingerprint(pair.publicKey),
        },
      ],
    }),
  );
  const previous = process.env.BYCODA_NATIVE_ADMISSION_REGISTRY;
  process.env.BYCODA_NATIVE_ADMISSION_REGISTRY = registry;
  const send = vi.fn<SocialAdapter["send"]>(async (_account, job) => ({
    platformId: `fake-${job.id}`,
  }));
  const adapters = Object.fromEntries(
    SOCIAL_PLATFORMS.map((platform) => [platform, { send, poll: async () => ({ events: [] }) }]),
  ) as SocialAdapters;
  const tokens = new Map<string, any>();
  let now = Date.now();
  const social = new SocialService(
    store,
    {
      get: async (id) => tokens.get(id),
      set: async (id, token) => {
        tokens.set(id, token);
      },
      delete: async (id) => {
        tokens.delete(id);
      },
    },
    adapters,
    directory,
    undefined,
    () => now,
  );
  const engine = new HostEngine(store, {});
  const server = await createHostServer(
    engine,
    ["codex"],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    social,
  );
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const device = await store.issueDevice("Fixture"),
      endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
    const call = async (method: string, params: Record<string, unknown>) =>
      (await (
        await fetch(endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${device.token}` },
          body: JSON.stringify({ version: 1, environmentId: store.environmentId, method, params }),
        })
      ).json()) as { result?: any; error?: any };
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
      if (!challenge) throw new Error("Native challenge unavailable");
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
    const projection = await signed("assistant.visibility.reopen", {
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
      (await call("native.services.assistant.visibility.reopen", { input: projection })).error,
    ).toBeUndefined();
    const owner = { kind: "owner" as const, actorId: "owner", provider: "owner" };
    const invoke = async <T>(action: string, input: Record<string, unknown>) =>
      (await social.call(owner, action, input)) as T;
    const account = await invoke<SocialAccount>("accounts.create", {
      platform: "x",
      name: "Fixture",
      accountType: "member",
      projectIds: [project.id],
    });
    const scopes = [
      ...new Set(Object.values(platformRequirements("x", "member")).flatMap((item) => item.scopes)),
    ];
    await social.connectAccount(
      account.id,
      { platformId: "fixture-account", name: "Fixture", scopes, accessApproved: true },
      { accessToken: "fake-token" },
    );
    await invoke("accounts.grants", {
      accountId: account.id,
      projectId: project.id,
      permissions: ["read", "draft", "comment"],
    });
    const granted = await invoke<SocialAccount>("accounts.assistantGrant", {
      accountId: account.id,
      permissions: ["read", "draft"],
      expectedVersion: null,
    });
    const contact = await invoke<SocialContact>("contacts.upsert", {
      accountId: account.id,
      platformId: "fake-recipient",
      name: "Recipient",
      projectIds: [project.id],
      commentEligible: true,
    });
    const draft = await invoke<SocialDraft>("comments.draft", {
      accountId: account.id,
      projectId: project.id,
      contactId: contact.id,
      postId: "fake-post",
      text: "Fixture reviewed text",
    });
    const profile = (await call("assistant.request", { op: "snapshot" })).result.snapshot.profile;
    expect(
      (
        await call("assistant.request", {
          op: "profile.update",
          expectedVersion: profile.version,
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
    let sequence = 0,
      approvals = 0,
      reviewed: any,
      loseReview = false;
    const run = async <T>(operation: Promise<T>) => {
      let settled = false;
      const pending = operation.finally(() => {
        settled = true;
      });
      for (let i = 0; i < 2500 && !settled; i++) {
        for (const request of (await call("conversation.desktop.take", {})).result ?? []) {
          expect(
            (
              await call("native.services.conversation.desktop.authorize", {
                id: request.id,
                action: request.action,
              })
            ).result,
          ).toEqual({ authorized: true });
          let result: unknown;
          if (request.action === "organization.read")
            result = { items: [{ cwd: project.cwd }], nextOffset: null };
          else if (request.action === "management.write.authorize") {
            approvals++;
            reviewed = request.input.operation;
            result = { approved: true, operationHash: reviewed.operationHash };
          } else if (request.action === "privacy.scope.capture")
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
          else if (request.action === "privacy.account.capture")
            result = await signed("assistant.account.capture", {
              environmentId: store.environmentId,
              threadId,
              issuer: "window",
              relayId: request.id,
              requestId: request.input.requestId,
              operationHash: request.input.operationHash,
              projectionRevision: 1,
              policyDigest: "a".repeat(64),
              privacyRevision: 1,
              sequence: ++sequence,
            });
          else throw new Error(`Unexpected relay ${request.action}`);
          const finish =
            request.action === "management.write.authorize" && loseReview
              ? { id: request.id, error: "Fixture native acknowledgement lost" }
              : { id: request.id, result };
          expect((await call("conversation.desktop.finish", finish)).error).toBeUndefined();
        }
        if (!settled) await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return await pending;
    };
    const proposal = {
      requestId: "send-one",
      accountId: account.id,
      projectId: project.id,
      action: "comments.send",
      entityId: draft.id,
    };
    const submit = () =>
      call("voice.tools.call", {
        family: "conversation",
        action: "social.send.propose",
        projectId: project.id,
        threadId,
        requestId: "send-one",
        input: proposal,
      });
    const accepted = await run(submit());
    expect(accepted.error).toBeUndefined();
    expect(reviewed).toMatchObject({
      action: "social.send",
      input: {
        snapshot: {
          accountGrantVersion: granted.assistantGrant!.version,
          projectCwd: project.cwd,
          payload: { payload: { text: "Fixture reviewed text" } },
        },
      },
    });
    expect(reviewed.input.snapshot.policyVersion).toMatch(/^[a-f0-9]{64}$/);
    expect(approvals).toBe(1);
    const queued = await invoke<SocialJob[]>("jobs.status", {});
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      actorId: `assistant-thread:${threadId}`,
      roomSource: {
        threadId,
        accountGrantVersion: granted.assistantGrant!.version,
        projectCwd: project.cwd,
        policyVersion: reviewed.input.snapshot.policyVersion,
        operationHash: reviewed.operationHash,
      },
    });
    await run(submit());
    expect(approvals).toBe(1);
    expect(send).not.toHaveBeenCalled();
    await invoke("execution.enable", { confirm: "ENABLE_EXTERNAL_SENDS" });
    await run(social.tick());
    expect(send).toHaveBeenCalledOnce();
    const status = await run(
      call("voice.tools.call", {
        family: "conversation",
        action: "social.send.status",
        projectId: project.id,
        threadId,
        requestId: "inspect-one",
        input: { accountId: account.id, projectId: project.id, operationId: "send-one" },
      }),
    );
    expect(status.error).toBeUndefined();
    expect(JSON.stringify(status.result)).toContain('"status":"succeeded"');
    await run(submit());
    expect(send).toHaveBeenCalledOnce();
    const uncertainDraft = await invoke<SocialDraft>("comments.draft", {
      accountId: account.id,
      projectId: project.id,
      contactId: contact.id,
      postId: "another-fake-post",
      text: "Uncertain fixture",
    });
    const uncertainProposal = {
      ...proposal,
      requestId: "send-uncertain",
      entityId: uncertainDraft.id,
    };
    const uncertainSubmit = () =>
      call("voice.tools.call", {
        family: "conversation",
        action: "social.send.propose",
        projectId: project.id,
        threadId,
        requestId: "send-uncertain",
        input: uncertainProposal,
      });
    expect((await run(uncertainSubmit())).error).toBeUndefined();
    send.mockRejectedValueOnce(new SocialPlatformError("unknown"));
    now += 3000;
    await run(social.tick());
    const unknown = await run(
      call("voice.tools.call", {
        family: "conversation",
        action: "social.send.status",
        projectId: project.id,
        threadId,
        requestId: "inspect-uncertain",
        input: { accountId: account.id, projectId: project.id, operationId: "send-uncertain" },
      }),
    );
    expect(unknown.error).toBeUndefined();
    expect(JSON.stringify(unknown.result)).toContain('"status":"review"');
    await run(uncertainSubmit());
    now += 60000;
    await run(social.tick());
    expect(send).toHaveBeenCalledTimes(2);
    const lostDraft = await invoke<SocialDraft>("comments.draft", {
      accountId: account.id,
      projectId: project.id,
      contactId: contact.id,
      postId: "lost-native-post",
      text: "Lost native result",
    });
    const lostInput = { ...proposal, requestId: "lost-native", entityId: lostDraft.id };
    const lostSubmit = () =>
      call("voice.tools.call", {
        family: "conversation",
        action: "social.send.propose",
        projectId: project.id,
        threadId,
        requestId: "lost-native",
        input: lostInput,
      });
    loseReview = true;
    const lost = await run(lostSubmit());
    expect(JSON.stringify(lost.result)).toContain('"state":"failed"');
    const count = approvals;
    loseReview = false;
    await run(lostSubmit());
    await run(social.tick());
    expect(approvals).toBe(count);
    expect(send).toHaveBeenCalledTimes(2);
    expect(await invoke<SocialJob[]>("jobs.status", {})).toHaveLength(2);
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
