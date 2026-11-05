import { expect, it } from "vitest";
import { HostStore } from "../store";
import {
  admitRunDuration,
  confirmedRunElapsed,
  confirmedRunProgress,
  forgetRunSamples,
  finishRunDuration,
  finishedRunProgress,
  localRunDay,
} from "./run-duration";

it("exposes a real admitted origin to nested budget reads before commit", async () => {
  const store = new HostStore(":memory:");
  await store.ready;
  try {
    await store.transaction(async () => {
      await admitRunDuration(store, "session", "accepted", 1_000, 100);
      expect(await confirmedRunProgress(store, "session", "accepted", 1_000, 100)).toEqual({
        elapsed: 0,
        uncertain: false,
      });
      expect(await confirmedRunProgress(store, "session", "accepted", 2_000, 1_100)).toEqual({
        elapsed: 1_000,
        uncertain: false,
      });
    });
    expect(await confirmedRunProgress(store, "session", "accepted", 3_000, 2_100)).toEqual({
      elapsed: 2_000,
      uncertain: false,
    });
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
        expect(await confirmedRunProgress(store, "session", "accepted", 2_000, 1_100)).toEqual({
          elapsed: 1_000,
          uncertain: false,
        });
        throw new Error("acceptance rolled back");
      }),
    ).rejects.toThrow("acceptance rolled back");
    expect(await confirmedRunProgress(store, "session", "accepted", 3_000, 2_100)).toEqual({
      elapsed: 0,
      uncertain: true,
    });
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
    expect(await finishedRunProgress(store, "session", "run")).toEqual({
      elapsed: 30_000,
      uncertain: false,
    });
    expect(await confirmedRunProgress(store, "session", "run", 61_000, 60_100)).toEqual({
      elapsed: 30_000,
      uncertain: false,
    });
  } finally {
    await store.close();
  }
});

it("keeps observations made during retirement before final settlement", async () => {
  const store = new HostStore(":memory:");
  await store.ready;
  try {
    await store.transaction(() => admitRunDuration(store, "session", "run", 1_000, 100));
    await confirmedRunProgress(store, "session", "run", 31_000, 30_100);
    await finishRunDuration(store, "session", "run", 61_000, 60_100);
    expect(await finishedRunProgress(store, "session", "run")).toEqual({
      elapsed: 60_000,
      uncertain: false,
    });
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
    expect(await finishedRunProgress(store, "session", "run")).toBeNull();
    expect(await confirmedRunProgress(store, "session", "run", 61_000, 60_100)).toEqual({
      elapsed: 60_000,
      uncertain: false,
    });
  } finally {
    await store.close();
  }
});

it("preserves committed uncertainty through nested samples and restart", async () => {
  const store = new HostStore(":memory:");
  await store.ready;
  try {
    await store.transaction(() => admitRunDuration(store, "session", "run", 1_000, 100));
    await store.transaction(async () => {
      await confirmedRunProgress(store, "session", "run", 201_000, 200_100);
      expect((await confirmedRunProgress(store, "session", "run", 31_000, 30_100)).uncertain).toBe(
        true,
      );
    });
    expect((await confirmedRunProgress(store, "session", "run", 61_000, 60_100)).uncertain).toBe(
      true,
    );
    forgetRunSamples(store, "session", "run");
    expect((await confirmedRunProgress(store, "session", "run", 71_000, 10)).uncertain).toBe(true);
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
    expect(await confirmedRunProgress(store, "legacy", "run", 10_000, 100)).toEqual({
      elapsed: 0,
      uncertain: true,
    });
    await store.transaction(() => admitRunDuration(store, "legacy", "run", 11_000, 1_100));
    expect(await confirmedRunProgress(store, "legacy", "run", 40_000, 30_100)).toEqual({
      elapsed: 30_000,
      uncertain: true,
    });
    forgetRunSamples(store, "legacy", "run");
    expect(await confirmedRunProgress(store, "legacy", "run", 50_000, 10)).toEqual({
      elapsed: 30_000,
      uncertain: true,
    });
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
    expect(await confirmedRunProgress(store, "session", "rolled-back", 2_000, 1_100)).toEqual({
      elapsed: 0,
      uncertain: true,
    });
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
        await confirmedRunProgress(store, "session", "run", 31_000, 30_100);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await confirmedRunProgress(store, "session", "run", 61_000, 60_100)).toEqual({
      elapsed: 60_000,
      uncertain: false,
    });
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
      await confirmedRunProgress(store, "session", "run", 31_000, 30_100);
      await confirmedRunProgress(store, "session", "run", 61_000, 60_100);
    });
    const row = await store.db
      .prepare("SELECT ms FROM run_duration_daily WHERE session_id=? AND run_id=?")
      .get("session", "run");
    expect(row?.ms).toBe(60_000);
    expect((await confirmedRunProgress(store, "session", "run", 71_000, 70_100)).elapsed).toBe(
      70_000,
    );
  } finally {
    await store.close();
  }
});
