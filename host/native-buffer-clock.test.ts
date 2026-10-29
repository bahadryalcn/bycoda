import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createNativeBufferClock } from "./native-buffer-clock";
import { createNativeBufferPersistenceStore } from "./native-buffer-persistence-store";
import type {
  NativeBufferClockBacking,
  NativeBufferClockState,
} from "./ports/native-buffer-persistence";
import { HostStore } from "./store";

const REPORT = "a".repeat(64);
const fixtures = resolve("temp/verification/2026-10-29-buffer-sql-clock/fixtures");
const cleanups: Array<() => Promise<void>> = [];
const authorize = async () => {};
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const zero = "0".repeat(64);

afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  await mkdir(fixtures, { recursive: true });
  const root = await mkdtemp(join(fixtures, "clock-"));
  const path = join(root, "host.db");
  let store = new HostStore(path);
  await store.issueDevice("Clock fixture");
  const f = {
    root,
    directory: join(root, "native-activity", "buffer-history", "clocks"),
    get store() {
      return store;
    },
    backing: () => createNativeBufferPersistenceStore(store),
    async reopen() {
      await store.close();
      store = new HostStore(path);
      await store.issueDevice("Reopened clock fixture");
    },
  };
  cleanups.push(async () => {
    await store.close();
    if (dirname(root) !== fixtures || !basename(root).startsWith("clock-"))
      throw new Error("Unsafe clock fixture cleanup path");
    await rm(root, { recursive: true, force: true });
  });
  return f;
}

const options = (observedVersion = 0, observedClockId?: string) => ({
  observedVersion,
  observedClockId,
  bootstrap: vi.fn(async () => 0),
  authorize,
});

function next(state: NativeBufferClockState): NativeBufferClockState {
  const highWater = state.highWater + 1;
  return {
    ...state,
    highWater,
    digest: sha(`${highWater.toString().padStart(16, "0")}|${state.clockId}|${state.digest}`),
  };
}

function record(value: number, clockId: string, previous: string) {
  const prefix = `${value.toString().padStart(16, "0")}|${clockId}|${previous}`;
  return `${prefix}|${sha(prefix)}\n`;
}

async function legacy(root: string, base = 7, count = 5) {
  const clock = createNativeBufferClock({ root });
  let answer = { value: base, clockId: "" };
  for (let index = 0; index < count; index++) {
    answer = await clock.reserve(REPORT, {
      ...options(index ? answer.value : base, index ? answer.clockId : undefined),
      bootstrap: async () => base,
    });
  }
  return answer;
}

it("keeps the SQL floor across restart and complete filesystem clock loss", async () => {
  const f = await fixture();
  const firstOptions = options();
  const first = await createNativeBufferClock({ root: f.root, backing: f.backing() }).reserve(
    REPORT,
    firstOptions,
  );
  expect(first.value).toBe(1);
  expect(firstOptions.bootstrap).toHaveBeenCalledTimes(1);
  await mkdir(f.directory, { recursive: true });
  await writeFile(join(f.directory, `${REPORT}.journal`), "invalid old cache");
  await writeFile(join(f.directory, `${REPORT}.head.json`), "{bad cache");
  await f.reopen();
  const resumeOptions = options(first.value, first.clockId);
  resumeOptions.bootstrap.mockRejectedValue(new Error("SQL must not scan history"));
  const resumed = await createNativeBufferClock({
    root: f.root,
    backing: f.backing(),
    write: async () => {
      throw new Error("SQL must not repair filesystem caches");
    },
  }).reserve(REPORT, resumeOptions);
  expect(resumed).toEqual({ value: 2, clockId: first.clockId });
  expect(resumeOptions.bootstrap).not.toHaveBeenCalled();
  expect(await readFile(join(f.directory, `${REPORT}.journal`), "utf8")).toBe("invalid old cache");
  await rm(join(f.root, "native-activity"), { recursive: true });
  await f.reopen();
  expect(
    await createNativeBufferClock({ root: f.root, backing: f.backing() }).reserve(
      REPORT,
      options(2, first.clockId),
    ),
  ).toEqual({ value: 3, clockId: first.clockId });
});

it("imports every validated legacy reservation including gaps and keeps its clock identity", async () => {
  const f = await fixture();
  const tail = await legacy(f.root);
  const observed = options(tail.value, tail.clockId);
  observed.bootstrap.mockRejectedValue(new Error("Initialized clock must not bootstrap"));
  const migrated = await createNativeBufferClock({ root: f.root, backing: f.backing() }).reserve(
    REPORT,
    observed,
  );
  expect(migrated).toEqual({ value: tail.value + 1, clockId: tail.clockId });
  expect(observed.bootstrap).not.toHaveBeenCalled();
  expect(await f.backing().readClock(REPORT)).toMatchObject({ base: 7, highWater: migrated.value });
  await rm(join(f.root, "native-activity"), { recursive: true });
  await f.reopen();
  expect(
    await createNativeBufferClock({ root: f.root, backing: f.backing() }).reserve(
      REPORT,
      options(migrated.value, tail.clockId),
    ),
  ).toEqual({ value: migrated.value + 1, clockId: tail.clockId });
});

it("adopts a closed legacy clock without consuming another reservation", async () => {
  const f = await fixture();
  const tail = await legacy(f.root);
  const journalPath = join(f.directory, `${REPORT}.journal`);
  const before = await readFile(journalPath);
  const clock = createNativeBufferClock({ root: f.root, backing: f.backing() });
  const state = await clock.adopt(REPORT, options(tail.value, tail.clockId));
  expect(state).toMatchObject({
    version: 1,
    reportId: REPORT,
    clockId: tail.clockId,
    base: 7,
    highWater: tail.value,
  });
  expect(await readFile(journalPath)).toEqual(before);
  expect(await f.backing().readClock(REPORT)).toEqual(state);
  await f.reopen();
  expect(
    await createNativeBufferClock({ root: f.root, backing: f.backing() }).reserve(
      REPORT,
      options(tail.value, tail.clockId),
    ),
  ).toEqual({ value: tail.value + 1, clockId: tail.clockId });
});

it("repeated SQL adoption reads only the existing floor and never initializes, advances or scans files", async () => {
  const f = await fixture();
  const backing = f.backing();
  const firstOptions = { ...options(11), bootstrap: vi.fn(async () => 11) };
  const first = await createNativeBufferClock({ root: f.root, backing }).adopt(
    REPORT,
    firstOptions,
  );
  expect(first.highWater).toBe(11);
  expect(firstOptions.bootstrap).toHaveBeenCalledTimes(1);
  await mkdir(f.directory, { recursive: true });
  await writeFile(join(f.directory, `${REPORT}.journal`), "not a journal");
  await writeFile(join(f.directory, `${REPORT}.head.json`), "not a head");
  const initializeClock = vi.fn(backing.initializeClock),
    advanceClock = vi.fn(backing.advanceClock);
  const current = options(11, first.clockId);
  current.bootstrap.mockRejectedValue(new Error("adoption must not bootstrap"));
  const changes = await f.store.db.prepare("SELECT total_changes() AS n").get();
  const adopted = await createNativeBufferClock({
    root: f.root,
    backing: { readClock: backing.readClock, initializeClock, advanceClock },
    write: async () => {
      throw new Error("adoption must not write files");
    },
  }).adopt(REPORT, current);
  expect(adopted).toEqual(first);
  expect(initializeClock).not.toHaveBeenCalled();
  expect(advanceClock).not.toHaveBeenCalled();
  expect(current.bootstrap).not.toHaveBeenCalled();
  expect(await f.store.db.prepare("SELECT total_changes() AS n").get()).toEqual(changes);
});

it("adoption rechecks current authority and rejects the unsupported legacy-only mode", async () => {
  const f = await fixture();
  const backing = f.backing();
  const initialized = await createNativeBufferClock({ root: f.root, backing }).adopt(
    REPORT,
    options(),
  );
  let allowed = true;
  const authorizeAdoption = async () => {
    if (!allowed) throw new Error("Adoption owner revoked");
  };
  const revokeOnRead: NativeBufferClockBacking = {
    ...backing,
    readClock: async (reportId) => {
      const value = await backing.readClock(reportId);
      allowed = false;
      return value;
    },
  };
  await expect(
    createNativeBufferClock({ root: f.root, backing: revokeOnRead }).adopt(REPORT, {
      ...options(),
      authorize: authorizeAdoption,
    }),
  ).rejects.toThrow("revoked");
  expect(await backing.readClock(REPORT)).toEqual(initialized);
  const bootstrap = vi.fn(async () => 0);
  await expect(
    createNativeBufferClock({ root: f.root }).adopt(REPORT, { ...options(), bootstrap }),
  ).rejects.toThrow("requires SQL backing");
  expect(bootstrap).not.toHaveBeenCalled();
});

it("fully verifies interior records during the one-time legacy import", async () => {
  for (const corruption of ["hash", "chain", "value", "clock"] as const) {
    const f = await fixture();
    const tail = await legacy(f.root, 0, 6);
    const path = join(f.directory, `${REPORT}.journal`);
    const bytes = await readFile(path);
    const lines = bytes.toString("ascii").trimEnd().split("\n");
    const [value, clockId, previous] = lines[2].split("|");
    if (corruption === "hash") lines[2] = lines[2].slice(0, -1) + "x";
    else
      lines[2] = record(
        corruption === "value" ? Number(value) + 1 : Number(value),
        corruption === "clock" ? randomUUID() : clockId,
        corruption === "chain" ? "f".repeat(64) : previous,
      ).trimEnd();
    await writeFile(path, lines.join("\n") + "\n");
    await expect(
      createNativeBufferClock({ root: f.root, backing: f.backing() }).reserve(
        REPORT,
        options(tail.value, tail.clockId),
      ),
    ).rejects.toThrow("clock");
    expect(await f.backing().readClock(REPORT)).toBeNull();
  }
});

it("accepts a lagging or missing valid legacy head without losing its durable tail", async () => {
  for (const missing of [false, true]) {
    const f = await fixture();
    const tail = await legacy(f.root);
    const headPath = join(f.directory, `${REPORT}.head.json`);
    if (missing) await rm(headPath);
    else {
      const first = (await readFile(join(f.directory, `${REPORT}.journal`), "utf8"))
        .split("\n")[0]
        .split("|");
      await writeFile(
        headPath,
        JSON.stringify({
          version: 1,
          reportId: REPORT,
          clockId: tail.clockId,
          base: 7,
          highWater: 7,
          digest: first[3],
        }),
      );
    }
    expect(
      await createNativeBufferClock({ root: f.root, backing: f.backing() }).reserve(
        REPORT,
        options(tail.value, tail.clockId),
      ),
    ).toEqual({ value: tail.value + 1, clockId: tail.clockId });
  }
});

it("adopts only the exact interrupted single-record legacy initialization", async () => {
  const f = await fixture();
  const clockId = randomUUID();
  await mkdir(f.directory, { recursive: true });
  await writeFile(join(f.directory, `${REPORT}.journal`), record(0, clockId, zero));
  expect(
    await createNativeBufferClock({ root: f.root, backing: f.backing() }).reserve(
      REPORT,
      options(),
    ),
  ).toEqual({ value: 1, clockId });
  expect(await f.backing().readClock(REPORT)).toMatchObject({ base: 0, highWater: 1 });
});

it("rejects initialized legacy loss, mismatches and invalid pointer states without a SQL floor", async () => {
  for (const corruption of [
    "missing",
    "partial",
    "marker",
    "head",
    "ahead",
    "digest",
    "no-marker",
  ] as const) {
    const f = await fixture();
    const tail = await legacy(f.root, 0, 3);
    const journal = join(f.directory, `${REPORT}.journal`),
      marker = join(f.directory, `${REPORT}.initialized.json`),
      head = join(f.directory, `${REPORT}.head.json`);
    if (corruption === "missing") await rm(journal);
    if (corruption === "partial") {
      const raw = await readFile(journal);
      await writeFile(journal, raw.subarray(0, raw.length - 1));
    }
    if (corruption === "marker")
      await writeFile(
        marker,
        JSON.stringify({ version: 1, reportId: REPORT, clockId: randomUUID(), base: 0 }),
      );
    if (corruption === "head") await writeFile(head, "{invalid");
    if (corruption === "no-marker") await rm(marker);
    if (corruption === "ahead" || corruption === "digest") {
      const value = JSON.parse(await readFile(head, "utf8"));
      if (corruption === "ahead") value.highWater++;
      else value.digest = "f".repeat(64);
      await writeFile(head, JSON.stringify(value));
    }
    await expect(
      createNativeBufferClock({ root: f.root, backing: f.backing() }).reserve(
        REPORT,
        options(tail.value, tail.clockId),
      ),
    ).rejects.toThrow("clock");
    expect(await f.backing().readClock(REPORT)).toBeNull();
  }
});

it("consumes a SQL reservation whose successful commit acknowledgement was lost", async () => {
  const f = await fixture();
  const backing = f.backing();
  const lostAck: NativeBufferClockBacking = {
    readClock: backing.readClock,
    initializeClock: backing.initializeClock,
    advanceClock: async (expected, advanced, check) => {
      await backing.advanceClock(expected, advanced, check);
      throw new Error("Lost committed reservation ACK");
    },
  };
  await expect(
    createNativeBufferClock({ root: f.root, backing: lostAck }).reserve(REPORT, options()),
  ).rejects.toThrow("Lost committed");
  const committed = await backing.readClock(REPORT);
  expect(committed?.highWater).toBe(1);
  await f.reopen();
  const retry = options(0);
  retry.bootstrap.mockRejectedValue(new Error("No legacy fallback"));
  expect(
    await createNativeBufferClock({ root: f.root, backing: f.backing() }).reserve(REPORT, retry),
  ).toEqual({ value: 2, clockId: committed!.clockId });
});

it("rechecks authorization after a committed advance without reusing that reservation", async () => {
  const f = await fixture();
  const backing = f.backing();
  let allowed = true;
  const check = async () => {
    if (!allowed) throw new Error("Clock owner revoked");
  };
  const revokeAfterCommit: NativeBufferClockBacking = {
    readClock: backing.readClock,
    initializeClock: backing.initializeClock,
    advanceClock: async (expected, advanced, authorizeAdvance) => {
      const value = await backing.advanceClock(expected, advanced, authorizeAdvance);
      allowed = false;
      return value;
    },
  };
  await expect(
    createNativeBufferClock({ root: f.root, backing: revokeAfterCommit }).reserve(REPORT, {
      ...options(),
      authorize: check,
    }),
  ).rejects.toThrow("revoked");
  const consumed = await backing.readClock(REPORT);
  expect(consumed?.highWater).toBe(1);
  allowed = true;
  expect(
    await createNativeBufferClock({ root: f.root, backing }).reserve(REPORT, {
      ...options(1, consumed!.clockId),
      authorize: check,
    }),
  ).toEqual({ value: 2, clockId: consumed!.clockId });
});

it("rejects revoked initialization before creating SQL clock state", async () => {
  const f = await fixture();
  await expect(
    createNativeBufferClock({ root: f.root, backing: f.backing() }).reserve(REPORT, {
      ...options(),
      authorize: async () => {
        throw new Error("Not authorized");
      },
    }),
  ).rejects.toThrow("Not authorized");
  expect(await f.backing().readClock(REPORT)).toBeNull();
  expect(
    await f.store.db
      .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'native_buffer_%'")
      .all(),
  ).toEqual([]);
});

it("never rebuilds a missing or corrupt SQL floor from surviving filesystem caches", async () => {
  for (const corruption of ["floor", "witness", "mismatch", "json"] as const) {
    const f = await fixture();
    const tail = await legacy(f.root);
    await createNativeBufferClock({ root: f.root, backing: f.backing() }).reserve(
      REPORT,
      options(tail.value, tail.clockId),
    );
    await f.store.transaction(async () => {
      if (corruption === "floor")
        await f.store.db.prepare("DELETE FROM native_buffer_clocks WHERE report_id=?").run(REPORT);
      if (corruption === "witness")
        await f.store.db
          .prepare("DELETE FROM native_buffer_clock_witnesses WHERE report_id=?")
          .run(REPORT);
      if (corruption === "mismatch") {
        const value = await f.backing().readClock(REPORT);
        await f.store.db
          .prepare("UPDATE native_buffer_clocks SET state_json=? WHERE report_id=?")
          .run(JSON.stringify({ ...value, highWater: 0 }), REPORT);
      }
      if (corruption === "json")
        await f.store.db
          .prepare("UPDATE native_buffer_clocks SET state_json=? WHERE report_id=?")
          .run("{invalid", REPORT);
    });
    await f.reopen();
    const observed = options(tail.value, tail.clockId);
    await expect(
      createNativeBufferClock({ root: f.root, backing: f.backing() }).reserve(REPORT, observed),
    ).rejects.toThrow("corrupt");
    expect(observed.bootstrap).not.toHaveBeenCalled();
  }
});

it("serializes competing initialization and CAS advancement without duplicate versions", async () => {
  const f = await fixture();
  let entered = 0,
    release!: () => void;
  const both = new Promise<void>((resolveBoth) => {
    release = resolveBoth;
  });
  const bootstrap = async () => {
    if (++entered === 2) release();
    await both;
    return 0;
  };
  const first = createNativeBufferClock({ root: f.root, backing: f.backing() }),
    second = createNativeBufferClock({ root: f.root, backing: f.backing() });
  const results = await Promise.allSettled([
    first.reserve(REPORT, { ...options(), bootstrap }),
    second.reserve(REPORT, { ...options(), bootstrap }),
  ]);
  expect(results.filter((value) => value.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((value) => value.status === "rejected")).toHaveLength(1);
  const current = (await f.backing().readClock(REPORT))!;
  expect(current.highWater).toBe(1);
  const advanced = next(current);
  const advances = await Promise.allSettled([
    f.backing().advanceClock(current, advanced, authorize),
    f.backing().advanceClock(current, advanced, authorize),
  ]);
  expect(advances.filter((value) => value.status === "fulfilled")).toHaveLength(1);
  expect((await f.backing().readClock(REPORT))?.highWater).toBe(2);
  expect(await first.reserve(REPORT, options(2, current.clockId))).toEqual({
    value: 3,
    clockId: current.clockId,
  });
});

it("leaves a failed SQL advance rolled back and retries the same next value", async () => {
  const f = await fixture();
  const clock = createNativeBufferClock({ root: f.root, backing: f.backing() });
  const first = await clock.reserve(REPORT, options());
  await f.store.transaction(async () => {
    await f.store.db.exec(
      "CREATE TRIGGER clock_fixture_failure BEFORE UPDATE ON native_buffer_clocks BEGIN SELECT RAISE(ABORT,'clock fixture rollback'); END",
    );
  });
  await expect(clock.reserve(REPORT, options(1, first.clockId))).rejects.toThrow(
    "clock fixture rollback",
  );
  expect((await f.backing().readClock(REPORT))?.highWater).toBe(1);
  await f.store.transaction(async () => {
    await f.store.db.exec("DROP TRIGGER clock_fixture_failure");
  });
  expect(await clock.reserve(REPORT, options(1, first.clockId))).toEqual({
    value: 2,
    clockId: first.clockId,
  });
});

it("rejects observation mismatch and exhaustion without promoting observations to a floor", async () => {
  const f = await fixture();
  const clock = createNativeBufferClock({ root: f.root, backing: f.backing() });
  const first = await clock.reserve(REPORT, options());
  await expect(clock.reserve(REPORT, options(2, first.clockId))).rejects.toThrow("clock");
  await expect(clock.reserve(REPORT, options(1, randomUUID()))).rejects.toThrow("clock");
  expect((await f.backing().readClock(REPORT))?.highWater).toBe(1);
  const exhaustedReport = "b".repeat(64);
  const bootstrap = vi.fn(async () => Number.MAX_SAFE_INTEGER);
  await expect(
    clock.reserve(exhaustedReport, { ...options(Number.MAX_SAFE_INTEGER), bootstrap }),
  ).rejects.toThrow("exhausted");
  expect((await f.backing().readClock(exhaustedReport))?.highWater).toBe(Number.MAX_SAFE_INTEGER);
  await expect(clock.reserve(exhaustedReport, { ...options(), bootstrap })).rejects.toThrow(
    "exhausted",
  );
  expect(bootstrap).toHaveBeenCalledTimes(1);
});
