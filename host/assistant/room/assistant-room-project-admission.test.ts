import { expect, it } from "vitest";
import { assertDelegatedProjectAdmission } from "./assistant-room-project-admission";
import { verifyDelegatedProjectPolicy } from "./assistant-room-project-admission";
import { generateKeyPairSync, sign } from "node:crypto";
it("defaults to denial and binds exact project, action, headless choice and live permit", () => {
  const base = {
    targetEnvironmentId: "host",
    projectId: "project",
    action: "tasks.get",
    headless: false,
  };
  expect(() => assertDelegatedProjectAdmission(base)).toThrow("unavailable");
  const keys = generateKeyPairSync("ed25519"),
    policy = {
      targetEnvironmentId: "host",
      projectId: "project",
      actions: ["tasks.get"],
      allowHeadless: false,
      revision: "a".repeat(64),
      expiresAt: Date.now() + 60000,
    };
  const bytes = Buffer.from(
    JSON.stringify([
      "bycoda-delegated-project-policy-v1",
      policy.targetEnvironmentId,
      policy.projectId,
      policy.actions,
      policy.allowHeadless,
      policy.revision,
      policy.expiresAt,
    ]),
  );
  const policySignature = sign(null, bytes, keys.privateKey).toString("base64url"),
    trustedPublicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const permit = {
      targetEnvironmentId: "host",
      projectId: "project",
      policyRevision: policy.revision,
      current: () => true,
    },
    reviewed = { policy, permit, policySignature, trustedPublicKey };
  expect(assertDelegatedProjectAdmission({ ...base, ...reviewed })).toBe(permit);
  expect(() => assertDelegatedProjectAdmission({ ...base, ...reviewed, headless: true })).toThrow(
    "not admitted",
  );
  expect(() =>
    assertDelegatedProjectAdmission({ ...base, ...reviewed, headless: "unknown" }),
  ).toThrow("not admitted");
  expect(() =>
    assertDelegatedProjectAdmission({
      ...base,
      ...reviewed,
      permit: { ...permit, current: () => false },
    }),
  ).toThrow("not admitted");
  expect(() =>
    assertDelegatedProjectAdmission({
      ...base,
      ...reviewed,
      permit: { ...permit, projectId: "other" },
    }),
  ).toThrow("not admitted");
});
it("verifies a time-bound exact owner policy without enabling it", () => {
  const keys = generateKeyPairSync("ed25519"),
    policy = {
      targetEnvironmentId: "host",
      projectId: "project",
      actions: ["tasks.get"],
      allowHeadless: false,
      revision: "a".repeat(64),
      expiresAt: 2000,
    };
  const bytes = Buffer.from(
    JSON.stringify([
      "bycoda-delegated-project-policy-v1",
      policy.targetEnvironmentId,
      policy.projectId,
      policy.actions,
      policy.allowHeadless,
      policy.revision,
      policy.expiresAt,
    ]),
  );
  const signature = sign(null, bytes, keys.privateKey).toString("base64url"),
    key = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  expect(verifyDelegatedProjectPolicy(policy, signature, key, 1000)).toBe(true);
  expect(
    verifyDelegatedProjectPolicy({ ...policy, allowHeadless: true }, signature, key, 1000),
  ).toBe(false);
  expect(verifyDelegatedProjectPolicy(policy, signature, key, 2000)).toBe(false);
});
