import { describe, expect, it } from "vitest";
import type { SocialJob } from "../../../src/features/social/model/social";
import type { SocialPrincipal } from "../social";
import type { SocialAudienceStore } from "../store/social-audience-store";
import {
  AutonomyDeferred,
  assertAiWritable,
  authorizeAutonomous,
  chargeAutonomy,
  revalidateAutonomy,
  type AutonomyDeps,
} from "./autonomy-gate";
import {
  defaultAutonomyPolicy,
  parseAutonomyInput,
  policyDay,
  saveAutonomyPolicy,
} from "./autonomy-policy";

const AI: SocialPrincipal = {
  kind: "session",
  actorId: "session:ai",
  sessionId: "s1",
  provider: "codex",
  projectId: "p1",
};
const OWNER: SocialPrincipal = { kind: "owner", actorId: "owner:me", provider: "owner" };

/** In-memory stand-in for the audience store methods the gate uses. */
function fakeDeps(start: number) {
  const records = new Map<string, unknown>();
  const counters = new Map<string, number>();
  const settings = new Map<string, string>([["sending", "true"]]);
  const clock = { value: start };
  const audience = {
    getRecord: async (kind: string, id: string) => records.get(`${kind}:${id}`),
    putRecord: async (kind: string, id: string, value: unknown) => {
      records.set(`${kind}:${id}`, value);
      return value;
    },
    getCounter: async (account: string, action: string, day: string) =>
      counters.get(`${account}:${action}:${day}`) ?? 0,
    incrementCounter: async (account: string, action: string, day: string, by = 1) => {
      const key = `${account}:${action}:${day}`;
      const next = (counters.get(key) ?? 0) + by;
      counters.set(key, next);
      return next;
    },
  } as unknown as SocialAudienceStore;
  const deps: AutonomyDeps = {
    audience,
    setting: async (key) => settings.get(key),
    now: () => clock.value,
  };
  return { deps, clock, settings, counters, audience };
}

const job = (overrides: Partial<SocialJob> = {}): SocialJob =>
  ({
    id: "j1",
    accountId: "acc",
    kind: "reply",
    actorId: "session:ai",
    sessionId: "s1",
    status: "queued",
    attempts: 1,
    scheduledAt: 0,
    createdAt: 0,
    projectIds: ["p1"],
    payload: { text: "hi", media: [] },
    ...overrides,
  }) as SocialJob;

const T0 = Date.parse("2026-10-10T09:00:00Z");

async function setLevel(
  deps: AutonomyDeps,
  level: "suggest" | "approve" | "autonomous",
  extra: Record<string, unknown> = {},
) {
  const patch = parseAutonomyInput(
    { levels: { reply: level }, ...extra },
    defaultAutonomyPolicy("acc"),
  );
  await saveAutonomyPolicy(deps.audience, "acc", patch, "owner:me", T0);
}

const DAY = policyDay(defaultAutonomyPolicy("acc"), T0);

describe("authorizeAutonomous", () => {
  it("defaults to suggest for every AI principal", async () => {
    const { deps } = fakeDeps(T0);
    expect(
      await authorizeAutonomous(deps, { accountId: "acc", action: "reply", principal: AI }),
    ).toEqual({ mode: "suggest" });
  });

  it("holds an approve-level action for owner review", async () => {
    const { deps } = fakeDeps(T0);
    await setLevel(deps, "approve");
    expect(
      await authorizeAutonomous(deps, { accountId: "acc", action: "reply", principal: AI }),
    ).toEqual({ mode: "approve" });
  });

  it("returns a version-bound autonomy approval for autonomous levels", async () => {
    const { deps } = fakeDeps(T0);
    await setLevel(deps, "autonomous");
    const decision = await authorizeAutonomous(deps, {
      accountId: "acc",
      action: "reply",
      principal: AI,
    });
    expect(decision).toEqual({
      mode: "autonomous",
      approval: { kind: "autonomy", accountId: "acc", version: 2 },
      scheduledAt: T0,
    });
  });

  it("never applies autonomy to the owner", async () => {
    const { deps } = fakeDeps(T0);
    await setLevel(deps, "autonomous");
    expect(
      await authorizeAutonomous(deps, { accountId: "acc", action: "reply", principal: OWNER }),
    ).toEqual({ mode: "suggest" });
  });

  it("refuses while AI is stopped, sending is off or the global stop is set", async () => {
    const { deps, settings } = fakeDeps(T0);
    await setLevel(deps, "autonomous");
    settings.set("ai.stopped", "true");
    await expect(
      authorizeAutonomous(deps, { accountId: "acc", action: "reply", principal: AI }),
    ).rejects.toThrow("stopped");
    settings.delete("ai.stopped");
    settings.set("sending", "false");
    await expect(
      authorizeAutonomous(deps, { accountId: "acc", action: "reply", principal: AI }),
    ).rejects.toThrow("sending is off");
    settings.set("sending", "true");
    settings.set("stopped", "true");
    await expect(
      authorizeAutonomous(deps, { accountId: "acc", action: "reply", principal: AI }),
    ).rejects.toThrow("stopped");
  });

  it("schedules outside working hours at the next opening instead of refusing", async () => {
    const { deps } = fakeDeps(Date.parse("2026-10-10T08:00:00Z"));
    await setLevel(deps, "autonomous", {
      workingHours: { timeZone: "UTC", days: [0, 1, 2, 3, 4, 5, 6], start: "10:00", end: "11:00" },
    });
    const decision = await authorizeAutonomous(deps, {
      accountId: "acc",
      action: "reply",
      principal: AI,
    });
    expect(decision).toMatchObject({
      mode: "autonomous",
      scheduledAt: Date.parse("2026-10-10T10:00:00Z"),
    });
  });

  it("refuses when the daily limit is already reached", async () => {
    const { deps, counters } = fakeDeps(T0);
    await setLevel(deps, "autonomous", { limits: { reply: 1 } });
    counters.set(`acc:reply:${DAY}`, 1);
    await expect(
      authorizeAutonomous(deps, { accountId: "acc", action: "reply", principal: AI }),
    ).rejects.toThrow("Daily AI limit");
  });
});

describe("revalidateAutonomy and chargeAutonomy", () => {
  it("passes a job without autonomy approval untouched", async () => {
    const { deps } = fakeDeps(T0);
    await expect(revalidateAutonomy(deps, job())).resolves.toBeUndefined();
  });

  it("rejects when the policy version changed after queueing", async () => {
    const { deps } = fakeDeps(T0);
    await setLevel(deps, "autonomous");
    const queued = job({ approval: { kind: "autonomy", accountId: "acc", version: 1 } });
    await expect(revalidateAutonomy(deps, queued)).rejects.toThrow("policy changed");
  });

  it("defers, rather than drops, when the window closed after queueing", async () => {
    const { deps, clock } = fakeDeps(T0);
    await setLevel(deps, "autonomous", {
      workingHours: { timeZone: "UTC", days: [0, 1, 2, 3, 4, 5, 6], start: "10:00", end: "11:00" },
    });
    clock.value = Date.parse("2026-10-10T12:00:00Z");
    const queued = job({ approval: { kind: "autonomy", accountId: "acc", version: 2 } });
    const error = await revalidateAutonomy(deps, queued).catch((item: unknown) => item);
    expect(error).toBeInstanceOf(AutonomyDeferred);
    expect((error as AutonomyDeferred).at).toBe(Date.parse("2026-10-11T10:00:00Z"));
  });

  it("charges one dispatch to the daily counter, never twice", async () => {
    const { deps, counters } = fakeDeps(T0);
    await setLevel(deps, "autonomous");
    const queued = job({ approval: { kind: "autonomy", accountId: "acc", version: 2 } });
    await chargeAutonomy(deps, queued);
    await chargeAutonomy(deps, queued);
    expect([...counters.values()]).toEqual([1]);
    expect(queued.approval).toMatchObject({ counted: DAY });
  });
});

describe("assertAiWritable", () => {
  it("blocks AI writes while stopped but allows the owner and the stop itself", async () => {
    const { deps, settings } = fakeDeps(T0);
    settings.set("ai.stopped", "true");
    await expect(assertAiWritable(deps, AI, "replies.send")).rejects.toThrow("stopped");
    await expect(assertAiWritable(deps, AI, "ai.stop")).resolves.toBeUndefined();
    await expect(assertAiWritable(deps, OWNER, "replies.send")).resolves.toBeUndefined();
    await expect(assertAiWritable(deps, AI, "replies.list")).resolves.toBeUndefined();
  });
});
