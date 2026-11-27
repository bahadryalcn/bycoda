import { expect, it } from "vitest";
import { HostStore } from "../store";
import {
  admitRunDuration,
  confirmedRunElapsed,
  forgetRunSamples,
  finishRunDuration,
  finishedRunElapsed,
  checkpointRunElapsed,
  localRunDay,
} from "./run-duration";

it("exposes a real admitted origin to nested budget reads before commit", async () => {
  const store = new HostStore(":memory:");
  await store.ready;
  try {
    await store.transaction(async () => {
      await admitRunDuration(store, "session", "accepted", 1_000, 100);
      expect(await confirmedRunElapsed(store, "session", "accepted", 1_000, 100)).toBe(0);
      expect(await confirmedRunElapsed(store, "session", "accepted", 2_000, 1_100)).toBe(1_000);
    });
    expect(await confirmedRunElapsed(store, "session", "accepted", 3_000, 2_100)).toBe(2_000);
  } finally {
    await store.close();
  }
});

it("removes an admitted origin and nested samples when the accepting batch rolls back", async () => {
  const store = new HostStore(":memory:");
  await store.ready;
  try {
    await expect(
      store.transaction(async () => {
        await admitRunDuration(store, "session", "accepted", 1_000, 100);
        expect(await confirmedRunElapsed(store, "session", "accepted", 2_000, 1_100)).toBe(1_000);
        throw new Error("acceptance rolled back");
      }),
    ).rejects.toThrow("acceptance rolled back");
    expect(await confirmedRunElapsed(store, "session", "accepted", 3_000, 2_100)).toBe(0);
  } finally {
    await store.close();
  }
});

it("records the admitted day even before any elapsed interval", async () => {
  const store = new HostStore(":memory:");
  await store.ready;
  try {
    await store.transaction(() => admitRunDuration(store, "session", "run", 1_000, 100));
    const row = await store.db
      .prepare("SELECT ms FROM run_duration_daily WHERE session_id=? AND run_id=? AND day=?")
      .get("session", "run", localRunDay(1_000));
    expect(row?.ms).toBe(0);
  } finally {
    await store.close();
  }
});

it("settles an owned run once and never counts later observations", async () => {
  const store = new HostStore(":memory:");
  await store.ready;
  try {
    await store.transaction(() => admitRunDuration(store, "session", "run", 1_000, 100));
    await finishRunDuration(store, "session", "run", 31_000, 30_100);
    await finishRunDuration(store, "session", "run", 61_000, 60_100);
    expect(await finishedRunElapsed(store, "session", "run")).toBe(30_000);
    expect(await confirmedRunElapsed(store, "session", "run", 61_000, 60_100)).toBe(30_000);
  } finally {
    await store.close();
  }
});

it("keeps observations made during retirement before final settlement", async () => {
  const store = new HostStore(":memory:");
  await store.ready;
  try {
    await store.transaction(() => admitRunDuration(store, "session", "run", 1_000, 100));
    await confirmedRunElapsed(store, "session", "run", 31_000, 30_100);
    await finishRunDuration(store, "session", "run", 61_000, 60_100);
    expect(await finishedRunElapsed(store, "session", "run")).toBe(60_000);
  } finally {
    await store.close();
  }
});

it("does not publish a finish checkpoint when its transaction fails", async () => {
  const store = new HostStore(":memory:");
  await store.ready;
  try {
    await store.transaction(() => admitRunDuration(store, "session", "run", 1_000, 100));
    await expect(
      store.transaction(async () => {
        await finishRunDuration(store, "session", "run", 31_000, 30_100);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await finishedRunElapsed(store, "session", "run")).toBeNull();
    expect(await confirmedRunElapsed(store, "session", "run", 61_000, 60_100)).toBe(60_000);
  } finally {
    await store.close();
  }
});

it("counts only the time before and after a gap and keeps running", async () => {
  const store = new HostStore(":memory:");
  await store.ready;
  const minute = 60_000;
  try {
    await store.transaction(() => admitRunDuration(store, "session", "run", 0, 0));
    // 10 minutes of work in 30 s samples, then a 60 minute sleep, then 5 more minutes.
    let wall = 0;
    for (let i = 0; i < 20; i++)
      await confirmedRunElapsed(store, "session", "run", (wall += 30_000), wall);
    expect(await confirmedRunElapsed(store, "session", "run", wall, wall)).toBe(10 * minute);
    wall += 60 * minute;
    expect(await confirmedRunElapsed(store, "session", "run", wall, wall)).toBe(10 * minute);
    for (let i = 0; i < 10; i++)
      await confirmedRunElapsed(store, "session", "run", (wall += 30_000), wall);
    expect(await confirmedRunElapsed(store, "session", "run", wall, wall)).toBe(15 * minute);
    // The slept hour is not charged to any day either.
    const day = await store.db
      .prepare("SELECT sum(ms) AS ms FROM run_duration_daily WHERE session_id=? AND run_id=?")
      .get("session", "run");
    expect(Number(day?.ms)).toBe(15 * minute);
  } finally {
    await store.close();
  }
});

it("continues from the checkpoint after a Host restart without losing or inventing time", async () => {
  const store = new HostStore(":memory:");
  await store.ready;
  try {
    await store.transaction(() => admitRunDuration(store, "session", "run", 1_000, 100));
    await confirmedRunElapsed(store, "session", "run", 31_000, 30_100);
    forgetRunSamples(store, "session", "run");
    // The first sample after the restart only sets the baseline, whatever time passed.
    expect(await confirmedRunElapsed(store, "session", "run", 9_000_000, 10)).toBe(30_000);
    expect(await confirmedRunElapsed(store, "session", "run", 9_030_000, 30_010)).toBe(60_000);
    expect(await checkpointRunElapsed(store, "session", "run")).toBe(60_000);
  } finally {
    await store.close();
  }
});

it("reads the last checkpoint of a run that has no close record", async () => {
  const store = new HostStore(":memory:");
  await store.ready;
  try {
    expect(await checkpointRunElapsed(store, "session", "none")).toBe(0);
    await store.transaction(() => admitRunDuration(store, "session", "run", 1_000, 100));
    await confirmedRunElapsed(store, "session", "run", 46_000, 45_100);
    expect(await finishedRunElapsed(store, "session", "run")).toBeNull();
    expect(await checkpointRunElapsed(store, "session", "run")).toBe(45_000);
  } finally {
    await store.close();
  }
});

it("retains confirmed exact-run duration across restart and excludes unknown gaps", async () => {
  const store = new HostStore(":memory:");
  await store.ready;
  try {
    await store.transaction(() => admitRunDuration(store, "session", "run", 1_000, 100));
    expect(await confirmedRunElapsed(store, "session", "run", 1_000, 100)).toBe(0);
    expect(await confirmedRunElapsed(store, "session", "run", 31_000, 30_100)).toBe(30_000);
    expect(await confirmedRunElapsed(store, "session", "other", 31_000, 30_100)).toBe(0);
    expect(await confirmedRunElapsed(store, "session", "run", 3_631_000, 3_630_100)).toBe(30_000);
    expect(await confirmedRunElapsed(store, "session", "run", 3_661_000, 3_660_100)).toBe(60_000);
    forgetRunSamples(store, "session", "run");
    expect(await confirmedRunElapsed(store, "session", "run", 7_000_000, 50)).toBe(60_000);
    expect(await confirmedRunElapsed(store, "session", "run", 7_030_000, 30_050)).toBe(90_000);
  } finally {
    await store.close();
  }
});

it("does not treat a first observed legacy run as a new admission", async () => {
  const store = new HostStore(":memory:");
  await store.ready;
  try {
    expect(await confirmedRunElapsed(store, "legacy", "run", 10_000, 100)).toBe(0);
    await store.transaction(() => admitRunDuration(store, "legacy", "run", 11_000, 1_100));
    expect(await confirmedRunElapsed(store, "legacy", "run", 40_000, 30_100)).toBe(30_000);
    forgetRunSamples(store, "legacy", "run");
    expect(await confirmedRunElapsed(store, "legacy", "run", 50_000, 10)).toBe(30_000);
  } finally {
    await store.close();
  }
});

it("does not admit a run when its enclosing transaction rolls back", async () => {
  const store = new HostStore(":memory:");
  await store.ready;
  try {
    await expect(
      store.transaction(async () => {
        await admitRunDuration(store, "session", "rolled-back", 1_000, 100);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await confirmedRunElapsed(store, "session", "rolled-back", 2_000, 1_100)).toBe(0);
  } finally {
    await store.close();
  }
});

it("does not consume a duration sample when its enclosing transaction rolls back", async () => {
  const store = new HostStore(":memory:");
  await store.ready;
  try {
    await store.transaction(() => admitRunDuration(store, "session", "run", 1_000, 100));
    await expect(
      store.transaction(async () => {
        await confirmedRunElapsed(store, "session", "run", 31_000, 30_100);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await confirmedRunElapsed(store, "session", "run", 61_000, 60_100)).toBe(60_000);
    const row = await store.db
      .prepare("SELECT ms FROM run_duration_daily WHERE session_id=? AND run_id=?")
      .get("session", "run");
    expect(row?.ms).toBe(60_000);
  } finally {
    await store.close();
  }
});

it("counts repeated samples in one transaction only once", async () => {
  const store = new HostStore(":memory:");
  await store.ready;
  try {
    await store.transaction(() => admitRunDuration(store, "session", "run", 1_000, 100));
    await store.transaction(async () => {
      await confirmedRunElapsed(store, "session", "run", 31_000, 30_100);
      await confirmedRunElapsed(store, "session", "run", 61_000, 60_100);
    });
    const row = await store.db
      .prepare("SELECT ms FROM run_duration_daily WHERE session_id=? AND run_id=?")
      .get("session", "run");
    expect(row?.ms).toBe(60_000);
    expect(await confirmedRunElapsed(store, "session", "run", 71_000, 70_100)).toBe(70_000);
  } finally {
    await store.close();
  }
});
