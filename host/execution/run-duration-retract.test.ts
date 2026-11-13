import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { HostStore } from "../store";
import { admitRunDuration, confirmedRunProgress, retractRunDuration } from "./run-duration";

it("does not charge a retracted wait and admits the same run again from zero", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-run-retract-"));
  const store = new HostStore(join(directory, "host.db"));
  const rows = async () =>
    (await store.db
      .prepare("SELECT COUNT(*) AS count FROM run_duration_checkpoints WHERE run_id='run'")
      .get()) as { count: number };
  try {
    await store.ready;
    await admitRunDuration(store, "\u0000crew-task:t", "run", 1_000, 0);
    expect(
      (await confirmedRunProgress(store, "\u0000crew-task:t", "run", 61_000, 60_000)).elapsed,
    ).toBeGreaterThan(0);
    await retractRunDuration(store, "\u0000crew-task:t", "run");
    expect((await rows()).count).toBe(0);
    await admitRunDuration(store, "\u0000crew-task:t", "run", 120_000, 120_000);
    expect((await rows()).count).toBe(1);
    expect(
      (await confirmedRunProgress(store, "\u0000crew-task:t", "run", 121_000, 121_000)).elapsed,
    ).toBeLessThanOrEqual(1_000);
  } finally {
    await store.close?.();
    rmSync(directory, { recursive: true, force: true });
  }
});
