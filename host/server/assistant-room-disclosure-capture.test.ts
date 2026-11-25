import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ConversationDesktopRelay } from "../conversation/conversation-desktop-relay";
import {
  NativeAdmissionOwner,
  nativeAdmissionBytes,
  nativeAdmissionDigest,
  nativeAdmissionFingerprint,
} from "../assistant/native/assistant-native-admission";
import { AssistantVisibilityAdmission } from "../assistant/native/assistant-visibility-admission";
import { AssistantVisibilityFence } from "../assistant/native/assistant-visibility-fence";
import type { AssistantPorts } from "../assistant/service";
import type { RoomManagementAdmission } from "../assistant/management/assistant-management-turn";
import { createAssistantRoomRuntime } from "./assistant-room";

const HOST = "host";
const THREAD = "global-room";
const DEVICE = "e".repeat(64);
const closers: (() => void)[] = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/**
 * The Host's real Room disclosure over its real relay, native admission and visibility fence.
 * Only the desktop is simulated: it takes each capture, spends `latencyMs` of the injected
 * clock on it (the webview reads and the Host challenge), and answers with a signed proof.
 */
async function integration(sources: number, latencyMs: number, desktop: "answers" | "silent") {
  const pair = generateKeyPairSync("ed25519");
  const keys = join(await mkdtemp(join(tmpdir(), "room-disclosure-")), "keys.json");
  await writeFile(
    keys,
    JSON.stringify({
      version: 1,
      generation: "a".repeat(64),
      entries: [
        {
          installationId: "desktop",
          hostId: HOST,
          publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
          fingerprint: nativeAdmissionFingerprint(pair.publicKey),
        },
      ],
    }),
  );
  let clock = 5_000_000;
  const native = new NativeAdmissionOwner(keys, HOST, false, () => clock);
  const fence = new AssistantVisibilityFence();
  const visibility = new AssistantVisibilityAdmission(HOST, native, fence);
  const relay = new ConversationDesktopRelay(HOST);
  closers.push(() => relay.close());
  const signed = async (action: string, value: unknown) => {
    const operationJson = JSON.stringify(value);
    const challenge = await native.challenge({
      installationId: "desktop",
      hostId: HOST,
      action,
      requestDigest: nativeAdmissionDigest(operationJson),
    });
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
  const projects = Array.from({ length: sources }, (_, index) => ({
    projectId: `project-${index}`,
    cwd: `/work/project-${index}`,
  }));
  await visibility.reopen(
    await signed("assistant.visibility.reopen", {
      epoch: 0,
      projection: {
        version: 1,
        revision: 1,
        operationId: "operation",
        actor: "issuer",
        snapshot: {
          schemaVersion: 1,
          policyDigest: "a".repeat(64),
          issuer: "issuer",
          privacyRevision: 1,
          visibleProjects: projects.map(({ cwd }) => ({ cwd })),
        },
      },
    }),
    async () => true,
  );
  const dependencies = new Proxy(
    {
      engine: {
        store: {
          environmentId: HOST,
          db: { readScope: <T>(work: () => Promise<T>) => work() },
          project: async (id: string) => ({
            cwd: projects.find((project) => project.projectId === id)!.cwd,
          }),
          withProjectIdentityRead: async <T>(
            _proofs: unknown,
            work: (valid: () => boolean) => Promise<T>,
          ) => work(() => true),
        },
      },
      assistant: {
        threadBinding: async (id: string) => ({ id }),
        globalRoomBinding: async () => ({ id: THREAD }),
      },
      conversationDesktop: relay,
      visibilityAdmission: visibility,
      assistantPorts: {} as AssistantPorts,
    } as Record<string, unknown>,
    // Everything else the Room runtime wires at start is closures never called by a disclosure.
    {
      get: (target, key) =>
        target[key as string] ?? new Proxy(() => undefined, { get: () => undefined }),
    },
  );
  createAssistantRoomRuntime(dependencies as never);
  const disclosure = (dependencies.assistantPorts as AssistantPorts).withRoomResponseDisclosure!;
  const answered: string[] = [];
  let running = desktop === "answers";
  const claimedByDesktop: Record<string, unknown>[] = [];
  const poll = (async () => {
    // Registers the desktop's poll, then serves captures until stopped.
    while (running || desktop === "silent") {
      const requests = await relay.take(DEVICE, { waitMs: 20 });
      claimedByDesktop.push(...requests);
      if (desktop === "silent") {
        if (claimedByDesktop.length) return;
        continue;
      }
      for (const request of requests) {
        clock += latencyMs;
        const input = request.input as { action: string; requestId: string; operationHash: string };
        const capture = {
          environmentId: HOST,
          threadId: String(request.threadId),
          issuer: "issuer",
          relayId: String(request.id),
          projectId: String(request.projectId),
          targetCwd: String(request.targetProjectCwd),
          action: input.action,
          requestId: input.requestId,
          operationHash: input.operationHash,
          projectionRevision: 1,
          policyDigest: "a".repeat(64),
          privacyRevision: 1,
          visibleCwds: [String(request.targetProjectCwd)],
          sequence: answered.length + 1,
        };
        const envelope = await signed("assistant.visibility.capture", capture);
        answered.push(String(request.projectId));
        await relay.finish(String(request.id), envelope, undefined, DEVICE);
      }
    }
  })();
  closers.push(() => {
    running = false;
  });
  const admission: RoomManagementAdmission = {
    environmentId: HOST,
    deviceHash: DEVICE,
    authorized: async () => true,
  };
  return { disclosure, projects, relay, admission, answered, claimedByDesktop, poll };
}

it("holds every source of a long history: 30 captures of 5 s each never age out the first proof", async () => {
  const test = await integration(30, 5_000, "answers");
  const scopes = test.projects.map((project) => ({
    threadId: THREAD,
    projects: [project.projectId],
    accounts: [],
    projectProofs: [project],
  }));
  // 30 x 5 s is 150 s of desktop work against a 30 s proof lifetime.
  const held = await test.disclosure(scopes, test.admission, async (valid) => valid());
  expect(held).toBe(true);
  expect(test.answered).toHaveLength(30);
  expect(await test.relay.take(DEVICE)).toEqual([]);
});

it("ends a history whose desktop claims a capture and goes silent, and leaves the relay empty", async () => {
  const test = await integration(6, 0, "silent");
  const scopes = test.projects.map((project) => ({
    threadId: THREAD,
    projects: [project.projectId],
    accounts: [],
    projectProofs: [project],
  }));
  const budget = new AbortController();
  const admission = { ...test.admission, signal: budget.signal };
  const pending = test.disclosure(scopes, admission, async () => "never");
  const failure = pending.then(
    () => "resolved",
    (error: Error) => error.message,
  );
  await test.poll;
  expect(test.claimedByDesktop).toHaveLength(1);
  budget.abort();
  await expect(failure).resolves.toMatch(/cancelled|authority|unavailable/i);
  // The claimed capture is gone: no late answer is accepted and nothing waits for the next poll.
  await expect(
    test.relay.finish(String(test.claimedByDesktop[0].id), {}, undefined, DEVICE),
  ).rejects.toThrow("expired");
  expect(await test.relay.take(DEVICE)).toEqual([]);
});
