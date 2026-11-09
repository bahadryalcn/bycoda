import { describe, expect, it } from "vitest";
import type { SocialPrincipal } from "../social";
import type { SocialAudienceStore } from "../store/social-audience-store";
import type { SocialActionContext } from "../core/social-actions";
import { autonomyActions } from "./autonomy-actions";
import {
  defaultAutonomyPolicy,
  hasAutonomousLevel,
  nextPolicyDayStart,
  parseAutonomyInput,
  readAutonomyPolicy,
  saveAutonomyPolicy,
  timeZoneValid,
} from "./autonomy-policy";

const current = defaultAutonomyPolicy("acc");

describe("parseAutonomyInput", () => {
  it("defaults every action to suggest and merges a partial patch", () => {
    expect(Object.values(current.levels).every((level) => level === "suggest")).toBe(true);
    const patch = parseAutonomyInput({ levels: { reply: "approve" } }, current);
    expect(patch.levels.reply).toBe("approve");
    expect(patch.levels.publish).toBe("suggest");
  });

  it("rejects unknown fields, actions, levels and limits outside 0..1000000", () => {
    expect(() => parseAutonomyInput({ coldDm: true }, current)).toThrow(
      "Unknown autonomy policy field",
    );
    expect(() => parseAutonomyInput({ levels: { coldDm: "autonomous" } }, current)).toThrow(
      "Unknown autonomy action",
    );
    expect(() => parseAutonomyInput({ levels: { reply: "always" } }, current)).toThrow(
      "Invalid autonomy level",
    );
    expect(() => parseAutonomyInput({ limits: { reply: -1 } }, current)).toThrow("whole numbers");
    expect(() => parseAutonomyInput({ limits: { reply: 1.5 } }, current)).toThrow("whole numbers");
    expect(() => parseAutonomyInput({ limits: { reply: 2_000_000 } }, current)).toThrow(
      "whole numbers",
    );
  });

  it("validates working hours: time zone, weekday numbers and HH:mm", () => {
    const hours = (value: Record<string, unknown>) =>
      parseAutonomyInput(
        { workingHours: { timeZone: "UTC", days: [1], start: "09:00", end: "18:00", ...value } },
        current,
      );
    expect(hours({}).workingHours).toMatchObject({ timeZone: "UTC", days: [1] });
    expect(() => hours({ timeZone: "Mars/Olympus" })).toThrow("time zone");
    expect(() => hours({ days: [7] })).toThrow("0 (Sunday) to 6");
    expect(() => hours({ days: [] })).toThrow("0 (Sunday) to 6");
    expect(() => hours({ start: "25:00" })).toThrow("HH:mm");
    expect(() => hours({ end: "9:00" })).toThrow("HH:mm");
  });

  it("accepts null to clear working hours", () => {
    const withHours = parseAutonomyInput(
      { workingHours: { timeZone: "UTC", days: [1], start: "09:00", end: "18:00" } },
      current,
    );
    expect(
      parseAutonomyInput(
        { workingHours: null },
        { ...current, workingHours: withHours.workingHours },
      ).workingHours,
    ).toBeUndefined();
  });

  it("recognises time zones through Intl", () => {
    expect(timeZoneValid("Europe/Istanbul")).toBe(true);
    expect(timeZoneValid("Not/AZone")).toBe(false);
  });
});

describe("saveAutonomyPolicy and readAutonomyPolicy", () => {
  function memoryStore() {
    const records = new Map<string, unknown>();
    return {
      store: {
        getRecord: async (_kind: string, id: string) => records.get(id),
        putRecord: async (_kind: string, id: string, value: unknown) => {
          records.set(id, value);
          return value;
        },
      } as unknown as SocialAudienceStore,
    };
  }

  it("bumps the version on every save, so earlier approvals stop matching", async () => {
    const { store } = memoryStore();
    expect((await readAutonomyPolicy(store, "acc")).version).toBe(1);
    const first = await saveAutonomyPolicy(
      store,
      "acc",
      parseAutonomyInput({}, current),
      "owner:me",
      10,
    );
    const second = await saveAutonomyPolicy(
      store,
      "acc",
      parseAutonomyInput({ levels: { reply: "approve" } }, first),
      "owner:me",
      20,
    );
    expect([first.version, second.version]).toEqual([2, 3]);
    expect((await readAutonomyPolicy(store, "acc")).levels.reply).toBe("approve");
  });

  it("detects autonomous levels", () => {
    expect(hasAutonomousLevel(current)).toBe(false);
    expect(
      hasAutonomousLevel({ ...current, levels: { ...current.levels, comment: "autonomous" } }),
    ).toBe(true);
  });

  it("finds the next policy day for deferred limits", () => {
    const at = Date.parse("2026-10-10T23:50:00Z");
    expect(nextPolicyDayStart(current, at)).toBe(Date.parse("2026-10-11T00:05:00Z"));
  });
});

describe("autonomy.set action", () => {
  const owner: SocialPrincipal = { kind: "owner", actorId: "owner:me", provider: "owner" };
  function ctx(principal: SocialPrincipal = owner) {
    const records = new Map<string, unknown>();
    const store = {
      getRecord: async (_kind: string, id: string) => records.get(id),
      putRecord: async (_kind: string, id: string, value: unknown) => {
        records.set(id, value);
        return value;
      },
    } as unknown as SocialAudienceStore;
    return {
      store,
      service: {
        account: async () => ({ id: "acc" }),
        access: async () => ({ id: "acc" }),
      },
      now: () => 1,
      principal,
      operationId: "op",
    } as unknown as SocialActionContext;
  }

  it("requires ENABLE_AUTONOMY before any autonomous level is stored", async () => {
    const context = ctx();
    const set = autonomyActions["autonomy.set"].run;
    await expect(
      set(context, { accountId: "acc", policy: { levels: { reply: "autonomous" } } }),
    ).rejects.toThrow("ENABLE_AUTONOMY");
    const saved = (await set(context, {
      accountId: "acc",
      policy: { levels: { reply: "autonomous" } },
      confirm: "ENABLE_AUTONOMY",
    })) as { levels: Record<string, string>; version: number };
    expect(saved.levels.reply).toBe("autonomous");
    expect(saved.version).toBe(2);
  });

  it("lets non-autonomous levels be saved without confirmation", async () => {
    await expect(
      autonomyActions["autonomy.set"].run(ctx(), {
        accountId: "acc",
        policy: { levels: { reply: "approve" } },
      }),
    ).resolves.toMatchObject({ levels: { reply: "approve" } });
  });

  it("is owner-only at the registry level", () => {
    expect(autonomyActions["autonomy.set"].ownerOnly).toBe(true);
    expect(autonomyActions["autonomy.get"].ownerOnly).toBe(false);
  });
});
