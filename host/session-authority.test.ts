import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { HostStore } from "./store";
import { SocialService } from "./social";
import type { SocialAdapters } from "../src/integrations/social/adapter";
import { RuntimeLogAccess } from "./runtime-log-tools";
import { createSessionAuthorityResolver, SessionAuthorityUnavailable } from "./session-authority";
import type { HostSession } from "../src/features/connections/model/protocol";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-session-authority-"));
  const store = new HostStore(join(directory, "host.db"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  cleanup.push(() => store.close());
  await store.ready;
  const project = await store.addProject(directory, "Fixture");
  let fingerprint = "1",
    clock = 1_000;
  const desktop = {
    fingerprint: () => fingerprint,
    samePath: (a: string, b: string) => a === b,
    metadataAsync: vi.fn(async (_id: string) => ({
      cwd: directory,
      harness: "codex",
      running: false,
    })),
  };
  const resolver = createSessionAuthorityResolver(store, desktop, ["codex", "claude"]);
  const identity = {
    store,
    prepareSessionIdentity: resolver.prepare,
    sessionAuthority: resolver.current,
  };
  const access = new RuntimeLogAccess(identity, () => clock);
  return {
    store,
    project,
    directory,
    desktop,
    resolver,
    identity,
    access,
    changeFingerprint: () => {
      fingerprint += "1";
    },
    expire: () => {
      clock += 12 * 60 * 60_000;
    },
  };
}

async function socialFixture() {
  const s = await fixture();
  const social = new SocialService(
    s.store,
    {
      get: async () => undefined,
      set: async () => {},
      delete: async () => {},
    },
    {} as SocialAdapters,
    s.directory,
  );
  await social.ready;
  social.setSessionAuthorityResolver(s.resolver);
  cleanup.push(() => social.dispose());
  return { ...s, social };
}

it("keeps Social authentication preparation outside the actor and rechecks revoked devices", async () => {
  const s = await socialFixture();
  const device = await s.store.issueDevice("Social owner");
  const hash = createHash("sha256").update(device.token).digest("hex");
  const grant = await s.social.issueSessionGrant("native", hash);
  const entered = gate(),
    release = gate();
  s.desktop.metadataAsync.mockImplementationOnce(async () => {
    expect(s.store.db.ownsScope).toBe(false);
    entered.resolve();
    await release.promise;
    return { cwd: s.directory, harness: "codex", running: false };
  });
  const operation = vi.fn(() => s.store.projects());
  const pending = s.store.db.withAuthorization(s.social.authorization(grant.token), () =>
    s.store.db.scope(operation),
  );
  const rejected = expect(pending).rejects.toThrow("authorization was revoked");
  await entered.promise;
  try {
    expect(await s.store.revokeDevice(device.id)).toBe(true);
  } finally {
    release.resolve();
  }
  await rejected;
  expect(operation).not.toHaveBeenCalled();
});

it("keeps Social grant publication commit-bound and refuses scope-changing renewal", async () => {
  const s = await socialFixture();
  const initial = await s.social.issueSessionGrant("native");
  const renewed = await s.social.issueSessionGrant("native", undefined, initial.scope);
  expect(renewed.scope).toEqual(initial.scope);
  for (const expected of [
    { ...initial.scope, provider: "claude" },
    { ...initial.scope, environmentId: "other" },
    {},
  ])
    await expect(s.social.issueSessionGrant("native", undefined, expected)).rejects.toThrow(
      "scope changed",
    );
  let token = "";
  await s.resolver.prepare("native");
  await expect(
    s.store.transaction(async () => {
      const issued = await s.social.issueSessionGrant("native");
      token = issued.token;
      expect(await s.social.principalForToken(token)).toBeUndefined();
      throw new Error("rollback social fixture");
    }),
  ).rejects.toThrow("rollback social fixture");
  expect(await s.social.principalForToken(token)).toBeUndefined();
  expect(await s.social.principalForToken(initial.token)).toBeTruthy();
});

it("never admits a missing grant, even while an unrelated SQL owner is held", async () => {
  const s = await fixture();
  const entered = gate(),
    release = gate();
  const held = s.store.db.scope(async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  try {
    const admissions = s.store.db.admissionVersion;
    expect(await s.access.principalForToken("unknown")).toBeUndefined();
    expect(s.store.db.admissionVersion).toBe(admissions);
    expect(s.desktop.metadataAsync).not.toHaveBeenCalled();
  } finally {
    release.resolve();
    await held;
  }
});

it("lets unrelated SQL progress during desktop metadata preparation, including request guards", async () => {
  const s = await fixture();
  const grant = await s.access.issueSessionGrant("native");
  for (const mode of ["lookup", "guard"] as const) {
    const entered = gate(),
      release = gate();
    s.desktop.metadataAsync.mockImplementationOnce(async () => {
      expect(s.store.db.ownsScope).toBe(false);
      entered.resolve();
      await release.promise;
      return { cwd: s.directory, harness: "codex", running: false };
    });
    const pending =
      mode === "lookup"
        ? s.access.principalForToken(grant.token)
        : s.store.db.withAuthorization(s.access.authorization(grant.token), () =>
            s.store.project(s.project.id),
          );
    await entered.promise;
    try {
      // This read must finish before release, not merely meet a wall-clock threshold.
      expect((await s.store.project(s.project.id)).name).toBe("Fixture");
    } finally {
      release.resolve();
    }
    expect(await pending).toBeTruthy();
  }
});

it("rechecks device revocation and expiry after external metadata preparation", async () => {
  const s = await fixture();
  const device = await s.store.issueDevice("Owner");
  const deviceHash = createHash("sha256").update(device.token).digest("hex");
  const grant = await s.access.issueSessionGrant("native", deviceHash);
  const entered = gate(),
    release = gate();
  s.desktop.metadataAsync.mockImplementationOnce(async () => {
    entered.resolve();
    await release.promise;
    return { cwd: s.directory, harness: "codex", running: false };
  });
  const pending = s.access.principalForToken(grant.token);
  await entered.promise;
  try {
    expect(await s.store.revokeDevice(device.id)).toBe(true);
  } finally {
    release.resolve();
  }
  expect(await pending).toBeUndefined();

  const expiring = await s.access.issueSessionGrant("native");
  s.desktop.metadataAsync.mockImplementationOnce(async () => {
    s.expire();
    return { cwd: s.directory, harness: "codex", running: false };
  });
  expect(await s.access.principalForToken(expiring.token)).toBeUndefined();
});

it("fails closed on changed desktop metadata without destroying a still-valid grant", async () => {
  const s = await fixture();
  const grant = await s.access.issueSessionGrant("native");
  await s.resolver.prepare("native");
  s.changeFingerprint();
  await expect(s.store.db.scope(() => s.resolver.current("native"))).rejects.toBeInstanceOf(
    SessionAuthorityUnavailable,
  );
  expect(await s.store.db.scope(() => s.access.principalForToken(grant.token))).toBeUndefined();
  expect(await s.access.principalForToken(grant.token)).toBeTruthy();
});

it("never publishes an issuing transaction's grant before commit or after rollback", async () => {
  const s = await fixture();
  await s.resolver.prepare("native");
  let rolledBack = "";
  await expect(
    s.store.transaction(async () => {
      const grant = await s.access.issueSessionGrant("native");
      rolledBack = grant.token;
      expect(await s.access.principalForToken(grant.token)).toBeUndefined();
      throw new Error("rollback fixture");
    }),
  ).rejects.toThrow("rollback fixture");
  expect(await s.access.principalForToken(rolledBack)).toBeUndefined();
  let committed = "";
  await s.store.transaction(async () => {
    const grant = await s.access.issueSessionGrant("native");
    committed = grant.token;
    expect(await s.access.principalForToken(grant.token)).toBeUndefined();
  });
  expect(await s.access.principalForToken(committed)).toBeTruthy();
});

it("binds renewed grants to the exact session/project/provider/environment scope", async () => {
  const s = await fixture();
  const grant = await s.access.issueSessionGrant("native");
  expect((await s.access.issueSessionGrant("native", undefined, grant.scope)).scope).toEqual(
    grant.scope,
  );
  for (const expected of [
    { ...grant.scope, sessionId: "other" },
    { ...grant.scope, projectId: "other" },
    { ...grant.scope, provider: "claude" },
    { ...grant.scope, environmentId: "other" },
    { ...grant.scope, extra: true },
    null,
  ])
    await expect(s.access.issueSessionGrant("native", undefined, expected)).rejects.toThrow(
      "scope changed",
    );
  s.desktop.metadataAsync.mockResolvedValue({
    cwd: s.directory,
    harness: "claude",
    running: false,
  });
  await expect(s.access.issueSessionGrant("native", undefined, grant.scope)).rejects.toThrow(
    "scope changed",
  );
  expect(await s.access.principalForToken(grant.token)).toBeUndefined();
});

it("reads cold Host authority from indexed metadata without loading transcript blocks", async () => {
  const s = await fixture();
  const value: HostSession = {
    projectId: s.project.id,
    revision: 1,
    status: "idle",
    updatedAt: 1,
    session: {
      id: "host",
      cwd: s.directory,
      title: "Fixture",
      harness: "codex",
      model: "test",
      modelSettings: {},
      runtimeMode: "auto",
      blocks: [],
    },
  };
  await s.store.save(value, {});
  const session = vi.spyOn(s.store, "session");
  const grant = await s.access.issueSessionGrant("host");
  expect(await s.access.principalForToken(grant.token)).toMatchObject({ projectId: s.project.id });
  expect(session).not.toHaveBeenCalled();
  expect(s.desktop.metadataAsync).not.toHaveBeenCalled();
  await s.store.save(
    { ...value, revision: 2, session: { ...value.session, harness: "claude" } },
    {},
  );
  expect(await s.access.principalForToken(grant.token)).toBeUndefined();
});
