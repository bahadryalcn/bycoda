import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  countMinutes,
  decodeMinutes,
  emptyMinutes,
  encodeMinutes,
  setMinute,
} from "@bycoda/account-contracts/activity";
import { handleActivityRpc } from "./activity-rpc";
import { ACTIVITY_HISTORY_DAYS, ActivityService } from "./activity-store";

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "activity-"));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

const map = (...minutes: number[]) => {
  const bits = emptyMinutes();
  for (const minute of minutes) setMinute(bits, minute);
  return encodeMinutes(bits);
};
const zone = "Europe/Istanbul";

describe("activity store", () => {
  it("merges minutes with OR and ignores a repeat", async () => {
    const service = new ActivityService(directory);
    expect(
      await service.recordMinutes({
        date: "2026-11-08",
        timeZone: zone,
        minutes: map(1, 2),
      }),
    ).toBe(true);
    expect(
      await service.recordMinutes({
        date: "2026-11-08",
        timeZone: zone,
        minutes: map(2, 3),
      }),
    ).toBe(true);
    expect(
      await service.recordMinutes({
        date: "2026-11-08",
        timeZone: zone,
        minutes: map(2, 3),
      }),
    ).toBe(false);
    const [day] = await service.listDays({
      from: "2026-11-08",
      to: "2026-11-08",
    });
    expect(countMinutes(decodeMinutes(day!.minutes))).toBe(3);
  });

  it("counts a minute once across devices and windows", async () => {
    const service = new ActivityService(directory);
    await service.recordMinutes({
      deviceId: "a",
      date: "2026-11-08",
      timeZone: zone,
      minutes: map(10, 11),
    });
    await service.recordMinutes({
      deviceId: "b",
      date: "2026-11-08",
      timeZone: zone,
      minutes: map(11, 12),
    });
    const summary = await service.summary({
      today: "2026-11-08",
      timeZone: zone,
    });
    expect(summary.today).toBe(3);
    expect(summary.year).toBe(3);
  });

  it("survives a restart", async () => {
    await new ActivityService(directory).recordMinutes({
      date: "2026-11-08",
      timeZone: zone,
      minutes: map(5),
    });
    const summary = await new ActivityService(directory).summary({
      today: "2026-11-08",
      timeZone: zone,
    });
    expect(summary.today).toBe(1);
  });

  it("serialises concurrent writers without losing minutes", async () => {
    const service = new ActivityService(directory);
    await Promise.all(
      [1, 2, 3, 4, 5].map((m) =>
        service.recordMinutes({
          date: "2026-11-08",
          timeZone: zone,
          minutes: map(m),
        }),
      ),
    );
    expect((await service.summary({ today: "2026-11-08", timeZone: zone })).today).toBe(5);
  });

  it("keeps a corrupt file as evidence and starts empty", async () => {
    writeFileSync(join(directory, "activity.json"), "{not json");
    const service = new ActivityService(directory);
    expect((await service.summary({ today: "2026-11-08", timeZone: zone })).year).toBe(0);
    await service.recordMinutes({
      date: "2026-11-08",
      timeZone: zone,
      minutes: map(1),
    });
    expect(readdirSync(directory).some((name) => name.includes(".corrupt-"))).toBe(true);
    expect(
      (
        await new ActivityService(directory).summary({
          today: "2026-11-08",
          timeZone: zone,
        })
      ).today,
    ).toBe(1);
  });

  it("drops days older than the history window", async () => {
    const service = new ActivityService(directory);
    await service.recordMinutes({
      date: "2025-01-01",
      timeZone: zone,
      minutes: map(1),
    });
    await service.recordMinutes({
      date: "2026-11-08",
      timeZone: zone,
      minutes: map(1),
    });
    expect(ACTIVITY_HISTORY_DAYS).toBe(400);
    const days = await service.listDays({
      from: "2020-01-01",
      to: "2030-01-01",
    });
    expect(days.map((day) => day.date)).toEqual(["2026-11-08"]);
  });

  it("rejects malformed records at the boundary", async () => {
    const service = new ActivityService(directory);
    await expect(
      service.recordMinutes({
        date: "2026-13-40",
        timeZone: zone,
        minutes: map(1),
      }),
    ).rejects.toThrow();
    await expect(
      service.recordMinutes({
        date: "2026-11-08",
        timeZone: "Nope/Zone",
        minutes: map(1),
      }),
    ).rejects.toThrow();
    await expect(
      service.recordMinutes({
        date: "2026-11-08",
        timeZone: zone,
        minutes: "abc",
      }),
    ).rejects.toThrow();
  });

  it("serves the RPC handler and rejects unknown params", async () => {
    const service = new ActivityService(directory);
    expect(
      await handleActivityRpc(service, "activity.record", {
        date: "2026-11-08",
        timeZone: zone,
        minutes: map(7),
      }),
    ).toEqual({ changed: true });
    const summary = (await handleActivityRpc(service, "activity.summary", {
      today: "2026-11-08",
      timeZone: zone,
    })) as { today: number; last7Days: unknown[] };
    expect(summary.today).toBe(1);
    expect(summary.last7Days).toHaveLength(7);
    await expect(
      handleActivityRpc(service, "activity.days", {
        from: "2026-11-01",
        to: "2026-11-08",
        extra: 1,
      }),
    ).rejects.toThrow();
  });
});
