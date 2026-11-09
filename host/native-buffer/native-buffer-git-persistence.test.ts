import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import {
  NATIVE_BUFFER_ARTIFACT_MAX_BYTES as MAX,
  type NativeBufferClockBacking,
  type NativeBufferClockState,
  type NativeBufferCompletionCertificate,
} from "../ports/native-buffer-persistence";
import {
  NATIVE_BUFFER_HISTORY_VERSIONS,
  createNativeBufferGitPersistence,
} from "./native-buffer-git-persistence";

const run = promisify(execFile);
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const reportId = "a".repeat(64);
const currentKey = `native-activity/buffers/${reportId}.json`;
const history = "native-activity/buffer-history";
const authorize = async () => {};
const cleanups: string[] = [];
afterEach(async () => {
  for (const path of cleanups.splice(0))
    await rm(path, { recursive: true, force: true, maxRetries: 5 });
});

function memoryClocks(): NativeBufferClockBacking & { set(state: NativeBufferClockState): void } {
  const states = new Map<string, NativeBufferClockState>();
  return {
    set: (state) => void states.set(state.reportId, state),
    readClock: async (id) => states.get(id) ?? null,
    async initializeClock(state, check) {
      await check();
      const known = states.get(state.reportId);
      if (known && JSON.stringify(known) !== JSON.stringify(state)) throw new Error("conflict");
      states.set(state.reportId, state);
      return state;
    },
    async advanceClock(expected, next, check) {
      await check();
      if (JSON.stringify(states.get(expected.reportId)) !== JSON.stringify(expected))
        throw new Error("conflict");
      states.set(next.reportId, next);
      return next;
    },
  };
}
const clock = (highWater: number, base = 1): NativeBufferClockState => ({
  version: 1,
  reportId,
  clockId: randomUUID(),
  base,
  highWater,
  digest: sha(String(highWater)),
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "nb-git-"));
  cleanups.push(root);
  const gitDir = join(root, "store", "native-buffer-store.git"),
    clocks = memoryClocks();
  const persistence = createNativeBufferGitPersistence({ gitDir, clocks });
  const git = async (...args: string[]) =>
    (await run("git", args, { env: { ...process.env, GIT_DIR: gitDir }, cwd: root })).stdout.trim();
  return { root, gitDir, clocks, persistence, git };
}
const ref = (key: string, raw: Buffer) => ({ key, sha256: sha(raw), byteLength: raw.length });
const versionKey = (kind: "reports" | "raw", version: number, digest: string) =>
  `${history}/${kind}/${reportId}/${version.toString().padStart(16, "0")}-${digest}.${kind === "raw" ? "bin" : "json"}`;
function certificate(
  state: NativeBufferClockState,
  version: number,
  raw: Buffer,
  artifacts = [ref(currentKey, raw)],
): NativeBufferCompletionCertificate {
  return {
    reportId,
    reportVersion: version,
    snapshotDigest: sha(raw),
    byteLength: raw.length,
    clockId: state.clockId,
    raw,
    artifacts,
  };
}
async function listAll(
  persistence: ReturnType<typeof createNativeBufferGitPersistence>,
  directory: string,
  view?: number,
) {
  const names: string[] = [];
  let after: string | null = null;
  do {
    const page = await persistence.entries(directory, after, 2, view);
    names.push(...page.entries.map((entry) => entry.name));
    after = page.nextAfter;
  } while (after);
  return names;
}

it("round-trips writes, bounded reads, paged entries and frozen directory views", async () => {
  const { persistence } = await fixture();
  expect(await persistence.directoryView()).toBe(0);
  expect(await persistence.read(currentKey, MAX)).toBeNull();
  expect(await persistence.entries(`${history}/reports`, null, 10)).toEqual({
    entries: [],
    nextAfter: null,
  });
  const first = Buffer.from('﻿ { "first": true }\n');
  await persistence.complete({
    writes: [
      { key: currentKey, bytes: first, immutable: false },
      { key: `${history}/reports/old/a.json`, bytes: first, immutable: true },
      { key: `${history}/reports/old/b.json`, bytes: first, immutable: true },
      { key: `${history}/chunks/c.bin`, bytes: Buffer.from("chunk"), immutable: true },
    ],
    certificates: [],
    authorize,
  });
  const view = await persistence.directoryView();
  expect(view).toBe(4);
  expect(await persistence.read(currentKey, MAX)).toEqual(first);
  await expect(persistence.read(currentKey, 3)).rejects.toThrow("corrupt");
  expect(await persistence.read(`${history}/reports/old`, MAX)).toBeNull();
  expect(await persistence.read(`${history}/reports/none.json`, MAX)).toBeNull();
  await expect(persistence.read("../escape", MAX)).rejects.toThrow();

  await persistence.complete({
    writes: [
      { key: currentKey, bytes: Buffer.from("new head"), immutable: false },
      { key: `${history}/reports/new/a.json`, bytes: first, immutable: true },
      { key: `${history}/reports/direct.json`, bytes: first, immutable: true },
    ],
    certificates: [],
    authorize,
  });
  expect(await persistence.directoryView()).toBe(view + 2);
  expect(await persistence.read(currentKey, MAX)).toEqual(Buffer.from("new head"));
  expect(await listAll(persistence, `${history}/reports`, view)).toEqual(["old"]);
  expect((await listAll(persistence, `${history}/reports`)).sort()).toEqual([
    "direct.json",
    "new",
    "old",
  ]);
  expect(await listAll(persistence, `${history}/reports/old`)).toEqual(["a.json", "b.json"]);
  const page = await persistence.entries(history, null, 10);
  expect(page.entries).toEqual([
    { name: "chunks", isDirectory: true },
    { name: "reports", isDirectory: true },
  ]);
  expect(await persistence.hasEntry(`${history}/reports`, "new", view)).toBe(false);
  expect(await persistence.hasEntry(`${history}/reports`, "new")).toBe(true);
  expect(await persistence.hasEntry("native-activity/buffers", `${reportId}.json`, view)).toBe(
    true,
  );
  expect(await persistence.entries("native-activity/buffers", null, 10, 0)).toEqual({
    entries: [],
    nextAfter: null,
  });
  await expect(persistence.entries("native-activity/buffers", "rowid:1", 10)).rejects.toThrow();
  await expect(persistence.entries("native-activity/buffers", null, 10, 999)).rejects.toThrow();
  await expect(persistence.entries("native-activity/buffers", null, 10, -1)).rejects.toThrow();
});

it("rejects immutable content changes, file/directory collisions and invalid writes", async () => {
  const { persistence } = await fixture();
  const key = `${history}/chunks/x.bin`,
    original = Buffer.from("original");
  await persistence.complete({
    writes: [{ key, bytes: original, immutable: true }],
    certificates: [],
    authorize,
  });
  const view = await persistence.directoryView();
  await expect(
    persistence.complete({
      writes: [{ key, bytes: Buffer.from("changed"), immutable: true }],
      certificates: [],
      authorize,
    }),
  ).rejects.toThrow("conflicting");
  await persistence.complete({
    writes: [{ key, bytes: original, immutable: true }],
    certificates: [],
    authorize,
  });
  expect(await persistence.directoryView()).toBe(view);
  expect(await persistence.read(key, MAX)).toEqual(original);
  await expect(
    persistence.complete({
      writes: [{ key: key + "/child", bytes: original, immutable: true }],
      certificates: [],
      authorize,
    }),
  ).rejects.toThrow("corrupt");
  await expect(
    persistence.complete({
      writes: [{ key: `${history}/chunks`, bytes: original, immutable: true }],
      certificates: [],
      authorize,
    }),
  ).rejects.toThrow("corrupt");
  await expect(
    persistence.complete({
      writes: [{ key: `${history}/chunks/y.bin`, bytes: original, immutable: false }],
      certificates: [],
      authorize,
    }),
  ).rejects.toThrow("corrupt");
  await expect(
    persistence.complete({
      writes: [
        { key: "native-activity/buffer-history/clocks/a", bytes: original, immutable: true },
      ],
      certificates: [],
      authorize,
    }),
  ).rejects.toThrow("corrupt");
  await expect(
    persistence.complete({
      writes: [{ key, bytes: Buffer.alloc(MAX + 1), immutable: true }],
      certificates: [],
      authorize,
    }),
  ).rejects.toThrow("corrupt");
  const denied = async () => {
    throw new Error("Fixture authority revoked");
  };
  await expect(
    persistence.complete({
      writes: [{ key: `${history}/chunks/z.bin`, bytes: original, immutable: true }],
      certificates: [],
      authorize: denied,
    }),
  ).rejects.toThrow("revoked");
  expect(await persistence.read(`${history}/chunks/z.bin`, MAX)).toBeNull();
  expect(await persistence.directoryView()).toBe(view);
});

it("round-trips certificates idempotently and rejects a differing one for the same identity", async () => {
  const { persistence, clocks } = await fixture();
  const state = clock(1),
    raw = Buffer.from('{ "recovery": { "reportVersion": 1 } }');
  const value = {
    ...certificate(state, 1, raw, [ref(currentKey, raw), ref(versionKey("raw", 1, sha(raw)), raw)]),
    originalDelivery: {
      originalId: "original",
      sha256: sha("{}"),
      byteLength: 2,
      principalId: sha("paired"),
      environmentId: "original-host",
    },
  };
  const writes = [
    { key: currentKey, bytes: raw, immutable: false },
    { key: versionKey("raw", 1, sha(raw)), bytes: raw, immutable: true },
  ];
  // The clock arrives in the same completion and is adopted after the ref move.
  await persistence.complete({
    writes,
    certificates: [value],
    initializeClocks: [state],
    authorize,
  });
  expect(await clocks.readClock(reportId)).toEqual(state);
  const identity = { reportId, reportVersion: 1, snapshotDigest: sha(raw) };
  const stored = await persistence.readCertificate(identity, MAX);
  expect(stored).toEqual({
    ...value,
    artifacts: [...value.artifacts].sort((a, b) => (a.key < b.key ? -1 : 1)),
  });
  await expect(persistence.readCertificate(identity, raw.length - 1)).rejects.toThrow("corrupt");
  expect(
    await persistence.readCertificate({ ...identity, snapshotDigest: sha("other") }, MAX),
  ).toBeNull();
  const view = await persistence.directoryView();
  await persistence.complete({ writes, certificates: [value], authorize });
  expect(await persistence.directoryView()).toBe(view);
  await expect(
    persistence.complete({
      writes,
      certificates: [
        { ...value, originalDelivery: { ...value.originalDelivery, originalId: "x" } },
      ],
      authorize,
    }),
  ).rejects.toThrow("conflicting");
  // A certificate without an admitting clock, or with an unverifiable artifact, is rejected.
  await expect(
    persistence.complete({
      writes,
      certificates: [certificate(clock(1), 1, raw)],
      authorize,
    }),
  ).rejects.toThrow("corrupt");
  await expect(
    persistence.complete({
      writes: [],
      certificates: [certificate(state, 1, raw, [ref(`${history}/chunks/missing.bin`, raw)])],
      authorize,
    }),
  ).rejects.toThrow("corrupt");
  // Artifacts already stored in an earlier completion are verified from the tree.
  const advanced = { ...state, highWater: 2 },
    second = Buffer.from('{ "recovery": { "reportVersion": 2 } }');
  clocks.set(advanced);
  await persistence.complete({
    writes: [],
    certificates: [certificate(advanced, 2, second, [ref(versionKey("raw", 1, sha(raw)), raw)])],
    authorize,
  });
  expect(
    (
      await persistence.readCertificate(
        { ...identity, reportVersion: 2, snapshotDigest: sha(second) },
        MAX,
      )
    )?.raw,
  ).toEqual(second);
  await expect(
    persistence.complete({
      writes: [],
      certificates: [certificate(advanced, 2, raw, [ref(versionKey("raw", 1, sha(raw)), second)])],
      authorize,
    }),
  ).rejects.toThrow("corrupt");
});

it(`keeps the newest ${NATIVE_BUFFER_HISTORY_VERSIONS} history versions, their certificates and the shared keys they reference`, async () => {
  const { persistence, clocks, git } = await fixture();
  const total = NATIVE_BUFFER_HISTORY_VERSIONS + 5,
    state = clock(total);
  clocks.set(state);
  // Odd versions: v1 manifests listing chunks. Even versions: v2 manifests whose template
  // descriptor lists chunks. Every version also references one shared chunk.
  const chunk = (name: string) => ({ bytes: Buffer.from(name), digest: sha(name) });
  const chunkKey = (digest: string) => `${history}/chunks/${digest}.bin`;
  const templateKey = (digest: string) => `${history}/templates/${digest}.json`;
  const shared = chunk("shared"),
    own = (version: number) => chunk(`own ${version}`),
    template = (version: number) => sha(`template ${version}`);
  for (let version = 1; version <= total; version++) {
    const raw = Buffer.from(JSON.stringify({ version })),
      digest = sha(raw),
      piece = own(version),
      refs = [shared, piece].map((value) => ({
        digest: value.digest,
        byteLength: value.bytes.length,
      }));
    const manifest =
      version % 2
        ? { version: 1, reportId, reportVersion: version, snapshotDigest: digest, chunks: refs }
        : {
            version: 2,
            reportId,
            reportVersion: version,
            snapshotDigest: digest,
            body: { templateDigest: template(version) },
          };
    await persistence.complete({
      writes: [
        { key: currentKey, bytes: raw, immutable: false },
        {
          key: versionKey("reports", version, digest),
          bytes: Buffer.from(JSON.stringify(manifest)),
          immutable: true,
        },
        { key: versionKey("raw", version, digest), bytes: raw, immutable: true },
        { key: chunkKey(shared.digest), bytes: shared.bytes, immutable: true },
        { key: chunkKey(piece.digest), bytes: piece.bytes, immutable: true },
        ...(version % 2
          ? []
          : [
              {
                key: templateKey(template(version)),
                bytes: Buffer.from(
                  JSON.stringify({ version: 1, templateDigest: template(version), chunks: refs }),
                ),
                immutable: true,
              },
            ]),
      ],
      certificates: [certificate(state, version, raw)],
      authorize,
    });
  }
  const reports = await listAll(persistence, `${history}/reports/${reportId}`),
    raws = await listAll(persistence, `${history}/raw/${reportId}`);
  expect(reports).toHaveLength(NATIVE_BUFFER_HISTORY_VERSIONS);
  expect(raws).toHaveLength(NATIVE_BUFFER_HISTORY_VERSIONS);
  expect(
    reports[0].startsWith(
      (total - NATIVE_BUFFER_HISTORY_VERSIONS + 1).toString().padStart(16, "0"),
    ),
  ).toBe(true);
  const at = (version: number) => {
    const raw = Buffer.from(JSON.stringify({ version }));
    return { reportId, reportVersion: version, snapshotDigest: sha(raw) };
  };
  for (let version = 1; version <= total - NATIVE_BUFFER_HISTORY_VERSIONS; version++)
    expect(await persistence.readCertificate(at(version), MAX)).toBeNull();
  expect(
    (await persistence.readCertificate(at(total - NATIVE_BUFFER_HISTORY_VERSIONS + 1), MAX))
      ?.reportVersion,
  ).toBe(6);
  expect((await persistence.readCertificate(at(total), MAX))?.reportVersion).toBe(total);
  expect(await persistence.read(currentKey, MAX)).toEqual(
    Buffer.from(JSON.stringify({ version: total })),
  );
  const certificates = (
    await git("ls-tree", "-r", "--name-only", "refs/bycoda/native-buffer", "--", "certificates/")
  )
    .split("\n")
    .filter(Boolean);
  expect(certificates).toHaveLength(NATIVE_BUFFER_HISTORY_VERSIONS);
  // Shared keys reachable only from dropped versions go; those of kept versions stay readable.
  const dropped = total - NATIVE_BUFFER_HISTORY_VERSIONS;
  for (let version = 1; version <= total; version++) {
    const kept = version > dropped;
    expect(await persistence.read(chunkKey(own(version).digest), MAX)).toEqual(
      kept ? own(version).bytes : null,
    );
    if (version % 2 === 0)
      expect(!!(await persistence.read(templateKey(template(version)), MAX))).toBe(kept);
  }
  expect(await persistence.read(chunkKey(shared.digest), MAX)).toEqual(shared.bytes);
  expect(await listAll(persistence, `${history}/chunks`)).toHaveLength(
    NATIVE_BUFFER_HISTORY_VERSIONS + 1,
  );
  expect(await listAll(persistence, `${history}/templates`)).toHaveLength(
    NATIVE_BUFFER_HISTORY_VERSIONS / 2,
  );
  // Parentless snapshots: gc drops superseded trees and pruned versions.
  const objects = async () => {
    const raw = await git("count-objects", "-v");
    const value = (name: string) => Number(new RegExp(`^${name}: (\\d+)$`, "m").exec(raw)![1]);
    return value("count") + value("in-pack");
  };
  const before = await objects();
  const sizes = await persistence.gc();
  const after = await objects();
  expect(after).toBeLessThan(before);
  expect(sizes.beforeBytes).toBeGreaterThan(0);
  expect(sizes.afterBytes).toBeGreaterThan(0);
  expect(await git("rev-list", "--count", "refs/bycoda/native-buffer")).toBe("1");
  expect((await persistence.readCertificate(at(total), MAX))?.reportVersion).toBe(total);
}, 120_000); // 25 real git completions

it("retries once when another writer moves the ref and fails on a second lost race", async () => {
  const { gitDir, clocks, persistence } = await fixture();
  const other = createNativeBufferGitPersistence({ gitDir, clocks });
  let moved = 0;
  const race = (moves: number[]) => {
    let calls = 0;
    return async () => {
      calls++;
      if (moves.includes(calls) && ++moved)
        await other.complete({
          writes: [
            {
              key: `${history}/chunks/other-${moved}.bin`,
              bytes: Buffer.from(`other ${moved}`),
              immutable: true,
            },
          ],
          certificates: [],
          authorize,
        });
    };
  };
  // Calls: 1 admission, 2 after reading the base, 3 right before update-ref.
  await persistence.complete({
    writes: [{ key: `${history}/chunks/mine.bin`, bytes: Buffer.from("mine"), immutable: true }],
    certificates: [],
    authorize: race([3]),
  });
  expect((await listAll(persistence, `${history}/chunks`)).sort()).toEqual([
    "mine.bin",
    "other-1.bin",
  ]);
  await expect(
    persistence.complete({
      writes: [{ key: `${history}/chunks/lost.bin`, bytes: Buffer.from("lost"), immutable: true }],
      certificates: [],
      authorize: race([3, 5]),
    }),
  ).rejects.toThrow("concurrently");
  expect(await persistence.read(`${history}/chunks/lost.bin`, MAX)).toBeNull();
  other.close();
});

it("reports availability for a missing git executable or an unusable repository path", async () => {
  const { root, gitDir, clocks, persistence } = await fixture();
  expect(
    await createNativeBufferGitPersistence({
      gitDir,
      clocks,
      git: "bycoda-missing-git-" + randomUUID(),
    }).available(),
  ).toBe(false);
  const file = join(root, "not-a-directory");
  await writeFile(file, "x");
  expect(await createNativeBufferGitPersistence({ gitDir: file, clocks }).available()).toBe(false);
  expect(
    await createNativeBufferGitPersistence({ gitDir: join(file, "child.git"), clocks }).available(),
  ).toBe(false);
  expect(await persistence.available()).toBe(true);
  expect(await persistence.directoryView()).toBe(0);
  persistence.close();
  expect(await persistence.available()).toBe(false);
});
