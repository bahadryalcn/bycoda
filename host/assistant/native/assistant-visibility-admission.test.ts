import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  NativeAdmissionOwner,
  nativeAdmissionBytes,
  nativeAdmissionDigest,
  nativeAdmissionFingerprint,
} from "./assistant-native-admission";
import { AssistantVisibilityAdmission } from "./assistant-visibility-admission";
import { AssistantVisibilityFence } from "./assistant-visibility-fence";

it("pins account-only source proof and drains its physical effect on privacy revocation", async () => {
  const pair = generateKeyPairSync("ed25519"),
    path = join(await mkdtemp(join(tmpdir(), "account-capture-")), "keys.json");
  await writeFile(
    path,
    JSON.stringify({
      version: 1,
      generation: "a".repeat(64),
      entries: [
        {
          installationId: "desktop",
          hostId: "host",
          publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
          fingerprint: nativeAdmissionFingerprint(pair.publicKey),
        },
      ],
    }),
  );
  const native = new NativeAdmissionOwner(path, "host"),
    fence = new AssistantVisibilityFence(),
    admission = new AssistantVisibilityAdmission("host", native, fence);
  const signed = async (action: string, value: unknown) => {
    const operationJson = JSON.stringify(value),
      challenge = await native.challenge({
        installationId: "desktop",
        hostId: "host",
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
  await admission.reopen(
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
          visibleProjects: [],
        },
      },
    }),
    async () => true,
  );
  const expected = {
    environmentId: "host",
    threadId: "global-room",
    relayId: "relay",
    requestId: "request",
    operationHash: "b".repeat(64),
  };
  const capture = {
    ...expected,
    issuer: "issuer",
    projectionRevision: 1,
    policyDigest: "a".repeat(64),
    privacyRevision: 1,
    sequence: 1,
  };
  await expect(
    admission.withAccountCapture(
      await signed("assistant.account.capture", capture),
      { ...expected, operationHash: "c".repeat(64) },
      async () => true,
      async () => {},
    ),
  ).rejects.toThrow("source changed");
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = admission.withAccountCapture(
    await signed("assistant.account.capture", capture),
    expected,
    async () => true,
    async (valid) => {
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      expect(valid()).toBe(false);
    },
  );
  await ready;
  let drained = false;
  const revocation = fence.revokeAll().then(() => {
    drained = true;
  });
  await Promise.resolve();
  expect(drained).toBe(false);
  release();
  await expect(pending).rejects.toThrow("scope revoked");
  await revocation;
  expect(drained).toBe(true);
});

it("reopens only for an exact native-signed committed projection under current owner trust", async () => {
  const pair = generateKeyPairSync("ed25519");
  const path = join(await mkdtemp(join(tmpdir(), "visibility-admission-")), "keys.json");
  const entry = {
    installationId: "desktop",
    hostId: "host",
    publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    fingerprint: nativeAdmissionFingerprint(pair.publicKey),
  };
  const registry = (generation: string, entries: unknown[]) =>
    JSON.stringify({ version: 1, generation: generation.repeat(64), entries });
  await writeFile(path, registry("a", [entry]));
  const native = new NativeAdmissionOwner(path, "host");
  const fence = new AssistantVisibilityFence();
  const admission = new AssistantVisibilityAdmission("host", native, fence);
  const operationJson = JSON.stringify({
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
        visibleProjects: [{ cwd: "/project" }],
      },
    },
  });
  const request = {
    installationId: "desktop",
    hostId: "host",
    action: "assistant.visibility.reopen",
    requestDigest: nativeAdmissionDigest(operationJson),
  };
  const challenge = await native.challenge(request);
  const proof = {
    challenge,
    signature: sign(null, nativeAdmissionBytes(challenge), pair.privateKey).toString("base64url"),
  };
  await expect(admission.reopen({ epoch: 0 }, async () => true)).rejects.toThrow();
  await expect(
    admission.reopen(
      { operationJson: operationJson.replace("project", "different"), proof },
      async () => true,
    ),
  ).rejects.toThrow();
  expect(await admission.reopen({ operationJson, proof }, async () => true)).toEqual({ epoch: 0 });
  await expect(admission.reopen({ operationJson, proof }, async () => true)).rejects.toThrow();
  const pending = await native.challenge(request);
  await writeFile(path, registry("b", []));
  await expect(
    admission.reopen(
      {
        operationJson,
        proof: {
          challenge: pending,
          signature: sign(null, nativeAdmissionBytes(pending), pair.privateKey).toString(
            "base64url",
          ),
        },
      },
      async () => true,
    ),
  ).rejects.toThrow();
});

it("holds the exact native capture permit through effect settlement and rejects changed request identity", async () => {
  const pair = generateKeyPairSync("ed25519");
  const path = join(await mkdtemp(join(tmpdir(), "visibility-capture-")), "keys.json");
  const entry = {
    installationId: "desktop",
    hostId: "host",
    publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    fingerprint: nativeAdmissionFingerprint(pair.publicKey),
  };
  await writeFile(
    path,
    JSON.stringify({
      version: 1,
      generation: "a".repeat(64),
      entries: [entry],
    }),
  );
  const native = new NativeAdmissionOwner(path, "host");
  const fence = new AssistantVisibilityFence();
  const admission = new AssistantVisibilityAdmission("host", native, fence);
  const signed = async (action: string, value: unknown) => {
    const operationJson = JSON.stringify(value);
    const challenge = await native.challenge({
      installationId: "desktop",
      hostId: "host",
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
  await admission.reopen(
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
          visibleProjects: [{ cwd: "/project" }],
        },
      },
    }),
    async () => true,
  );
  const expected = {
    environmentId: "host",
    threadId: "thread",
    projectId: "project",
    targetCwd: "/project",
    action: "tasks.list",
    requestId: "request",
    operationHash: "b".repeat(64),
    relayId: "relay",
  };
  const capture = {
    ...expected,
    issuer: "issuer",
    sequence: 1,
    projectionRevision: 1,
    policyDigest: "a".repeat(64),
    privacyRevision: 1,
    visibleCwds: ["/project"],
  };
  await expect(
    admission.withCapture(
      await signed("assistant.visibility.capture", capture),
      { ...expected, requestId: "different" },
      async () => true,
      async () => "leak",
    ),
  ).rejects.toThrow("scope changed");
  await expect(
    admission.withCapture(
      await signed("assistant.visibility.capture", {
        ...capture,
        issuer: "other-window",
      }),
      expected,
      async () => true,
      async () => "leak",
    ),
  ).rejects.toThrow("issuer or trust changed");
  await expect(
    admission.withCapture(
      await signed("assistant.visibility.capture", {
        ...capture,
        privacyRevision: 2,
      }),
      expected,
      async () => true,
      async () => "leak",
    ),
  ).rejects.toThrow("qualification unavailable");
  let release!: () => void;
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = admission.withCapture(
    await signed("assistant.visibility.capture", capture),
    expected,
    async () => true,
    async (valid, identity) => {
      expect(valid()).toBe(true);
      expect(identity.installationId).toBe("desktop");
      expect(identity.visibilityEpoch).toBe(0);
      expect(admission.currentIdentity(identity)).toBe(true);
      expect(
        admission.currentIdentity({
          ...identity,
          policyGeneration: "different-process",
        }),
      ).toBe(false);
      expect(
        new AssistantVisibilityAdmission(
          "host",
          native,
          new AssistantVisibilityFence(),
        ).currentIdentity(identity),
      ).toBe(false);
      expect(await native.current(identity.installationId, identity.registryRevision)).toBe(true);
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return "done";
    },
  );
  await ready;
  release();
  await expect(pending).resolves.toBe("done");
  const next = { ...capture, sequence: 2, visibleCwds: ["/project", "/other"] };
  const other = {
    ...next,
    sequence: 3,
    projectId: "other",
    targetCwd: "/other",
    relayId: "relay-2",
  };
  const expectedOther = {
    ...expected,
    projectId: "other",
    targetCwd: "/other",
    relayId: "relay-2",
  };
  await expect(
    admission.withCaptures(
      [
        {
          envelope: await signed("assistant.visibility.capture", next),
          expected,
        },
        {
          envelope: await signed("assistant.visibility.capture", other),
          expected: expectedOther,
        },
      ],
      async () => true,
      async (valid) => valid(),
    ),
  ).resolves.toBe(true);
  const firstThread = { ...capture, sequence: 4 };
  const secondThread = {
    ...capture,
    sequence: 5,
    threadId: "other-thread",
    relayId: "relay-3",
  };
  await expect(
    admission.withCaptures(
      [
        {
          envelope: await signed("assistant.visibility.capture", firstThread),
          expected,
        },
        {
          envelope: await signed("assistant.visibility.capture", secondThread),
          expected: {
            ...expected,
            threadId: "other-thread",
            relayId: "relay-3",
          },
        },
      ],
      async () => true,
      async (valid) => valid(),
    ),
  ).resolves.toBe(true);
  const accountExpected = {
    environmentId: "host",
    threadId: "global-room",
    relayId: "account-relay",
    requestId: "account-request",
    operationHash: "c".repeat(64),
  };
  const account = {
    ...accountExpected,
    issuer: "issuer",
    sequence: 6,
    projectionRevision: 1,
    policyDigest: "a".repeat(64),
    privacyRevision: 1,
  };
  const project = { ...capture, sequence: 7 };
  const projectEnvelope = await signed("assistant.visibility.capture", project);
  const accountEnvelope = await signed("assistant.account.capture", account);
  await expect(
    admission.withCaptures(
      [{ envelope: projectEnvelope, expected }],
      async () => true,
      async (valid, source) => valid() && source.issuer === "issuer",
      [{ envelope: accountEnvelope, expected: accountExpected }],
    ),
  ).resolves.toBe(true);
  await expect(
    admission.withCaptures(
      [{ envelope: projectEnvelope, expected }],
      async () => true,
      async () => true,
      [{ envelope: accountEnvelope, expected: accountExpected }],
    ),
  ).rejects.toThrow();
  await expect(
    admission.withCaptures(
      [],
      async () => true,
      async () => true,
      [
        {
          envelope: await signed("assistant.account.capture", {
            ...account,
            issuer: "different",
            sequence: 8,
          }),
          expected: accountExpected,
        },
      ],
    ),
  ).rejects.toThrow("issuer or trust changed");
  await expect(
    admission.withCaptures(
      [],
      async () => true,
      async () => true,
      [
        {
          envelope: await signed("assistant.account.capture", {
            ...account,
            privacyRevision: 2,
            sequence: 9,
          }),
          expected: accountExpected,
        },
      ],
    ),
  ).rejects.toThrow("qualification unavailable");
  let releaseMixed!: () => void, enteredMixed!: () => void;
  const mixedReady = new Promise<void>((resolve) => {
    enteredMixed = resolve;
  });
  const mixed = admission.withCaptures(
    [
      {
        envelope: await signed("assistant.visibility.capture", {
          ...project,
          sequence: 10,
        }),
        expected,
      },
    ],
    async () => true,
    async (valid) => {
      enteredMixed();
      await new Promise<void>((resolve) => {
        releaseMixed = resolve;
      });
      expect(valid()).toBe(false);
    },
    [
      {
        envelope: await signed("assistant.account.capture", {
          ...account,
          sequence: 11,
        }),
        expected: accountExpected,
      },
    ],
  );
  await mixedReady;
  let drained = false;
  const revocation = fence.revokeAll().then(() => {
    drained = true;
  });
  await Promise.resolve();
  expect(drained).toBe(false);
  releaseMixed();
  await expect(mixed).rejects.toThrow("scope revoked");
  await revocation;
  expect(drained).toBe(true);
});

it("verifies each source proof as it arrives, so a long run of captures never ages out the first", async () => {
  const pair = generateKeyPairSync("ed25519");
  const path = join(await mkdtemp(join(tmpdir(), "visibility-collect-")), "keys.json");
  await writeFile(
    path,
    JSON.stringify({
      version: 1,
      generation: "a".repeat(64),
      entries: [
        {
          installationId: "desktop",
          hostId: "host",
          publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
          fingerprint: nativeAdmissionFingerprint(pair.publicKey),
        },
      ],
    }),
  );
  let clock = 1_000_000;
  const native = new NativeAdmissionOwner(path, "host", false, () => clock);
  const fence = new AssistantVisibilityFence();
  const admission = new AssistantVisibilityAdmission("host", native, fence);
  const signed = async (action: string, value: unknown) => {
    const operationJson = JSON.stringify(value);
    const challenge = await native.challenge({
      installationId: "desktop",
      hostId: "host",
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
  await admission.reopen(
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
          visibleProjects: Array.from({ length: 8 }, (_, index) => ({
            cwd: `/p${index}`,
          })),
        },
      },
    }),
    async () => true,
  );
  const expectedFor = (index: number) => ({
    environmentId: "host",
    threadId: "thread",
    projectId: `p${index}`,
    targetCwd: `/p${index}`,
    action: "room.disclosure",
    requestId: "request",
    operationHash: "b".repeat(64),
    relayId: `relay-${index}`,
  });
  const captureFor = (index: number) => ({
    ...expectedFor(index),
    issuer: "issuer",
    sequence: index + 1,
    projectionRevision: 1,
    policyDigest: "a".repeat(64),
    privacyRevision: 1,
    visibleCwds: [`/p${index}`],
  });
  // Eight desktop round trips of five seconds: the first proof is 35 s old when the last arrives.
  const arrive = async (index: number) => {
    clock += 5_000;
    return {
      envelope: await signed("assistant.visibility.capture", captureFor(index)),
      index,
    };
  };
  const waiting = [];
  for (let index = 0; index < 8; index += 1) waiting.push(await arrive(index));
  await expect(
    admission.withCaptures(
      waiting.map(({ envelope, index }) => ({
        envelope,
        expected: expectedFor(index),
      })),
      async () => true,
      async () => true,
    ),
  ).rejects.toThrow("Invalid native admission proof");

  const collected = admission.collect(async () => true);
  for (let index = 0; index < 8; index += 1) {
    const { envelope } = await arrive(index);
    await collected.project(envelope, {
      ...expectedFor(index),
      requestId: "request",
    });
  }
  await expect(
    collected.run(async (valid, identity) => valid() && identity.issuer === "issuer"),
  ).resolves.toBe(true);
  // The proofs were consumed once: running the same set again is refused, never replayed.
  const replay = admission.collect(async () => true);
  const stale = await arrive(0);
  await replay.project(stale.envelope, expectedFor(0));
  await expect(replay.project(stale.envelope, expectedFor(0))).rejects.toThrow(
    "Invalid native admission proof",
  );
  // A proof that did age out before it reached the Host is still refused.
  const late = await arrive(1);
  clock += 31_000;
  await expect(
    admission.collect(async () => true).project(late.envelope, expectedFor(1)),
  ).rejects.toThrow("Invalid native admission proof");
});
