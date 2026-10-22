import { describe, expect, it } from "vitest";
import { createTeamAccessPolicy, type TeamAccessRequest, type TeamEvidence } from "./team-access";

const request: TeamAccessRequest = {
  organizationId: "org",
  projectId: "project",
  machineId: "machine",
  resourceId: "resource",
  actorId: "alice",
  deviceId: "device",
  permission: "terminal.observe",
  requestId: "operation",
};
function evidence(): TeamEvidence {
  return {
    target: {
      organizationId: "org",
      projectId: "project",
      machineId: "machine",
      resourceId: "resource",
    },
    actorId: "alice",
    deviceId: "device",
    identity: "active",
    membership: "active",
    admission: "admitted",
    device: "trusted",
    grant: "active",
    recovery: "ready",
    entitlement: "active",
    policy: "allow",
    permissions: ["terminal.observe"],
    hostCapabilities: ["terminal.observe"],
    epoch: 3,
    checkpointEpoch: 3,
    leaseId: "lease",
    membershipCheckedAt: 100_000,
    issuedAt: 110_000,
    expiresAt: 160_000,
  };
}
function setup(initial = evidence()) {
  let current = initial,
    wall = 120_000,
    monotonic = 1000;
  const policy = createTeamAccessPolicy(
    { verify: async () => current },
    { wallMs: () => wall, monotonicMs: () => monotonic },
  );
  return {
    policy,
    set: (next: TeamEvidence) => {
      current = next;
    },
    tick: (w: number, m: number) => {
      wall = w;
      monotonic = m;
    },
  };
}
it("fails closed without an actual verifier regardless of caller identity/role assertions", async () => {
  expect(
    await createTeamAccessPolicy().authorize(
      { verified: true, role: "owner", paired: true },
      request,
    ),
  ).toEqual({ allowed: false, reason: "verifier-unavailable" });
});
it("denies unverifiable or unavailable authority", async () => {
  for (const verify of [
    async () => undefined,
    async () => {
      throw new Error("offline");
    },
  ]) {
    expect((await createTeamAccessPolicy({ verify }).authorize({}, request)).allowed).toBe(false);
  }
});
it("permits an exactly bound admitted observer for the remaining membership lifetime", async () => {
  expect(await setup().policy.authorize({}, request)).toEqual({
    allowed: true,
    remainingMs: 40_000,
  });
});
it("revalidates a request without consuming approval or an execution permit", async () => {
  const s = setup();
  expect((await s.policy.authorize({}, request)).allowed).toBe(true);
  expect((await s.policy.authorize({}, request)).allowed).toBe(true);
});
describe("contract default-deny cases", () => {
  const cases: [string, (value: TeamEvidence) => void][] = [
    ...(["organizationId", "projectId", "machineId", "resourceId"] as const).map(
      (key) =>
        [
          key,
          (e: TeamEvidence) => {
            e.target[key] = "different";
          },
        ] as [string, (e: TeamEvidence) => void],
    ),
    [
      "wrong actor",
      (e) => {
        e.actorId = "bob";
      },
    ],
    [
      "wrong device",
      (e) => {
        e.deviceId = "other";
      },
    ],
    [
      "identity revoked",
      (e) => {
        e.identity = "revoked";
      },
    ],
    [
      "membership revoked",
      (e) => {
        e.membership = "revoked";
      },
    ],
    [
      "pending identity",
      (e) => {
        e.admission = "pending_identity";
      },
    ],
    [
      "pending seat",
      (e) => {
        e.admission = "pending_seat";
      },
    ],
    [
      "suspended admission",
      (e) => {
        e.admission = "suspended";
      },
    ],
    [
      "revoked admission",
      (e) => {
        e.admission = "revoked";
      },
    ],
    [
      "revoked device",
      (e) => {
        e.device = "revoked";
      },
    ],
    [
      "revoked grant",
      (e) => {
        e.grant = "revoked";
      },
    ],
    [
      "quarantined restore",
      (e) => {
        e.recovery = "quarantined";
      },
    ],
    [
      "unknown restore",
      (e) => {
        e.recovery = "unverified";
      },
    ],
    [
      "wrong epoch",
      (e) => {
        e.epoch = 2;
      },
    ],
    [
      "expired lease",
      (e) => {
        e.expiresAt = 120_000;
      },
    ],
    [
      "stale membership cannot gain a new 60s from issue",
      (e) => {
        e.membershipCheckedAt = 90_000;
      },
    ],
    [
      "future-issued lease",
      (e) => {
        e.issuedAt = 121_000;
      },
    ],
    [
      "nonfinite expiry",
      (e) => {
        e.expiresAt = Infinity;
      },
    ],
    [
      "unsupported host",
      (e) => {
        e.hostCapabilities = [];
      },
    ],
    [
      "no matching grant",
      (e) => {
        e.permissions = [];
      },
    ],
    [
      "policy denied",
      (e) => {
        e.policy = "deny";
      },
    ],
    [
      "entitlement denied",
      (e) => {
        e.entitlement = "denied";
      },
    ],
  ];
  it.each(cases)("denies %s", async (_, mutate) => {
    const e = evidence();
    mutate(e);
    expect((await setup(e).policy.authorize({}, request)).allowed).toBe(false);
  });
});
it("rejects authoritative epoch rollback after a newer checkpoint", async () => {
  const s = setup();
  await s.policy.authorize({}, request);
  const old = evidence();
  old.epoch = old.checkpointEpoch = 2;
  s.set(old);
  expect(await s.policy.authorize({}, request)).toEqual({
    allowed: false,
    reason: "epoch-mismatch",
  });
});
it("wall-clock rollback cannot extend an already checked lease", async () => {
  const s = setup();
  await s.policy.authorize({}, request);
  s.tick(119_000, 41_000);
  expect(await s.policy.authorize({}, request)).toEqual({
    allowed: false,
    reason: "lease-monotonic-expired",
  });
});
it("does not reuse a lease ID with another target or expiry", async () => {
  const s = setup();
  await s.policy.authorize({}, request);
  const changed = evidence();
  changed.expiresAt--;
  s.set(changed);
  expect(await s.policy.authorize({}, request)).toEqual({
    allowed: false,
    reason: "lease-rebound",
  });
});
it("does not turn observer permissions into input, SFTP or forwarding grants", async () => {
  for (const permission of [
    "terminal.input",
    "sftp.read",
    "sftp.write",
    "forward.local",
    "forward.remote",
    "forward.dynamic",
  ] as const) {
    expect((await setup().policy.authorize({}, { ...request, permission })).allowed).toBe(false);
  }
});
it("requires an exact current single-writer lease and separate approval for input", async () => {
  const e = evidence();
  e.permissions = e.hostCapabilities = ["terminal.input"];
  const r = {
    ...request,
    permission: "terminal.input" as const,
    operationDigest: "host-computed-digest",
  };
  expect((await setup(e).policy.authorize({}, r)).allowed).toBe(false);
  e.writer = { actorId: "alice", deviceId: "device", leaseId: "lease", expiresAt: 145_000 };
  expect((await setup(e).policy.authorize({}, r)).allowed).toBe(false);
  e.approval = {
    requestId: "operation",
    operationDigest: "host-computed-digest",
    permission: "terminal.input",
    expiresAt: 140_000,
  };
  expect(await setup(e).policy.authorize({}, r)).toEqual({ allowed: true, remainingMs: 20_000 });
  expect(
    (await setup(e).policy.authorize({}, { ...r, operationDigest: "changed-payload" })).allowed,
  ).toBe(false);
  for (const key of ["actorId", "deviceId", "leaseId"] as const) {
    const changed = structuredClone(e);
    changed.writer![key] = "other";
    expect((await setup(changed).policy.authorize({}, r)).allowed).toBe(false);
  }
  e.approval.requestId = "different-command";
  expect((await setup(e).policy.authorize({}, r)).allowed).toBe(false);
});
it("rechecks authority for each effect rather than reusing an allowed decision", async () => {
  const s = setup();
  expect((await s.policy.authorize({}, request)).allowed).toBe(true);
  const revoked = evidence();
  revoked.grant = "revoked";
  s.set(revoked);
  expect((await s.policy.authorize({}, request)).allowed).toBe(false);
});
