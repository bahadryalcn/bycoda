import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostRunWriters } from "./run-writers";
import type { ProviderChild } from "./provider-child";
import type { HostRunBinding, HostRunHandle } from "../src/integrations/harness/core/hostRun";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(options?: ConstructorParameters<typeof HostRunWriters>[0]) {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-host-run-writer-"));
  directories.push(directory);
  const writers = new HostRunWriters(options);
  const issue = async (
    sessionId = "logical",
    isCurrent = () => true,
    validateAuthority?: () => Promise<void>,
    cwd = directory,
  ) => {
    const handle = writers.reserve({
      owner: {},
      sessionId,
      runId: randomUUID(),
      isCurrent,
      validateAuthority,
    });
    await writers.setExecutionCwd(handle, cwd);
    return handle;
  };
  const attach = async (handle: HostRunHandle, physical = "logical#17", cwd = directory) => {
    const token = await writers.prepareProcess(handle, { sessionId: physical, cwd });
    // Exact object identity fixture. The backend tests below this authority use
    // real Node child/stdin callbacks; this object supplies no OS/SDK proof.
    const child = {} as ProviderChild;
    const source = Object.freeze({
      sessionId: physical,
      constructionId: randomUUID(),
      cwd: token.cwd,
    });
    writers.attachProcess(handle, child, source, token);
    writers.completeProcess(token);
    return { child, source };
  };
  return { writers, directory, issue, attach };
}

it("retains a sandbox grant until every accepted child has verified retirement", async () => {
  const f = fixture();
  const issueAux = async () => {
    const run = f.writers.reserve({
      owner: {},
      sessionId: "logical",
      runId: randomUUID(),
      isCurrent: () => true,
      auxiliary: true,
    });
    await f.writers.setExecutionCwd(run, f.directory);
    return run;
  };
  const original = await issueAux();
  const grant = await f.writers.grantCwd(original, f.directory, "text-sandbox");
  const other = await issueAux();
  const reservation = await f.writers.prepareProcess(other, {
    sessionId: "child",
    cwd: f.directory,
    provider: "antigravity",
    cwdGrant: grant,
  });
  const completion = gate();
  f.writers.observePreparedProcess(reservation, completion.promise);
  await f.writers.finish(original);
  expect(f.writers.retireTextGrant(original, grant)).toBe(false);
  f.writers.completeProcess(reservation);
  expect(f.writers.retireTextGrant(original, grant)).toBe(false);
  completion.resolve();
  await completion.promise;
  expect(f.writers.retireTextGrant(original, grant)).toBe(true);
  await expect(
    f.writers.prepareProcess(other, {
      sessionId: "new",
      cwd: f.directory,
      provider: "antigravity",
      cwdGrant: grant,
    }),
  ).rejects.toThrow(/grant/);
});

it("never retires a sandbox after unknown child completion", async () => {
  const f = fixture();
  const run = f.writers.reserve({
    owner: {},
    sessionId: "logical",
    runId: "unknown",
    isCurrent: () => true,
    auxiliary: true,
  });
  await f.writers.setExecutionCwd(run, f.directory);
  const grant = await f.writers.grantCwd(run, f.directory, "text-sandbox");
  const token = await f.writers.prepareProcess(run, {
    sessionId: "child",
    cwd: f.directory,
    provider: "antigravity",
    cwdGrant: grant,
  });
  f.writers.observePreparedProcess(token, Promise.reject(new Error("retirement unknown")));
  f.writers.completeProcess(token);
  await f.writers.finish(run);
  expect(f.writers.retireTextGrant(run, grant)).toBe(false);
});

it("reserves before Engine publication and retains an exact optional authority generation", async () => {
  const f = fixture();
  let published = false;
  const run = f.writers.reserve({
    owner: {},
    sessionId: "logical",
    runId: "original",
    authorityGeneration: undefined,
    isCurrent: () => published,
  });
  expect(() => f.writers.setExecutionCwd(run, f.directory)).toThrow(/source changed/);
  published = true;
  await f.writers.setExecutionCwd(run, f.directory);
  const p = await f.attach(run);
  const binding = await f.writers.bind(run, p.child, p.source);
  expect(Object.isFrozen(binding)).toBe(true);
  expect(Reflect.ownKeys(binding)).toEqual([]);
  await f.writers.write(binding, p.child, p.source, async () => {});
  await f.writers.finish(run);
});

it("keeps warm P across A/B and refuses ended, copied and foreign scopes without touching B", async () => {
  const f = fixture();
  const a = await f.issue(),
    p = await f.attach(a);
  const aBinding = await f.writers.bind(a, p.child, p.source);
  const bytes: string[] = [];
  await f.writers.write(aBinding, p.child, p.source, async () => {
    bytes.push("A");
  });
  await f.writers.finish(a);
  const b = await f.issue(),
    bBinding = await f.writers.bind(b, p.child, p.source);
  expect(() =>
    f.writers.write(aBinding, p.child, p.source, async () => {
      bytes.push("late A");
    }),
  ).toThrow(/closed/);
  expect(() => f.writers.bind(Object.freeze({}) as HostRunHandle, p.child, p.source)).toThrow(
    /original Host run handle/,
  );
  expect(() =>
    f.writers.write(Object.freeze({}) as HostRunBinding, p.child, p.source, async () => {}),
  ).toThrow(/original Host run binding/);
  const foreign = fixture(),
    foreignRun = await foreign.issue(),
    foreignP = await foreign.attach(foreignRun);
  const foreignBinding = await foreign.writers.bind(foreignRun, foreignP.child, foreignP.source);
  expect(() => f.writers.write(foreignBinding, p.child, p.source, async () => {})).toThrow(
    /original Host run binding/,
  );
  await f.writers.write(bBinding, p.child, p.source, async () => {
    bytes.push("B");
  });
  expect(bytes).toEqual(["A", "B"]);
  await Promise.all([f.writers.finish(b), foreign.writers.finish(foreignRun)]);
});

it("joins A's accepted callback and finish tail before B can bind the same physical original", async () => {
  const f = fixture(),
    entered = gate(),
    callback = gate(),
    bValidated = gate();
  const a = await f.issue(),
    p = await f.attach(a);
  const aBinding = await f.writers.bind(a, p.child, p.source);
  const writeA = f.writers.write(aBinding, p.child, p.source, async () => {
    entered.resolve();
    await callback.promise;
  });
  await entered.promise;
  let bChecks = 0;
  const b = await f.issue(
    "logical",
    () => true,
    async () => {
      bChecks++;
      bValidated.resolve();
    },
  );
  const bindingB = f.writers.bind(b, p.child, p.source);
  await bValidated.promise;
  const endingA = f.writers.finish(a);
  let aEnded = false,
    bBound = false;
  void endingA.then(() => {
    aEnded = true;
  });
  void bindingB.then(() => {
    bBound = true;
  });
  // A separate valid source completes while A's actual callback is held.
  const sibling = await f.issue("sibling"),
    q = await f.attach(sibling, "sibling#1");
  const qBinding = await f.writers.bind(sibling, q.child, q.source);
  await f.writers.write(qBinding, q.child, q.source, async () => {});
  expect(aEnded).toBe(false);
  expect(bBound).toBe(false);
  expect(bChecks).toBe(1);
  callback.resolve();
  await Promise.all([writeA, endingA]);
  const originalB = await bindingB;
  await f.writers.write(originalB, p.child, p.source, async () => {});
  await Promise.all([f.writers.finish(b), f.writers.finish(sibling)]);
});

it("rechecks the original source after authority awaits and emits no bytes on replacement", async () => {
  const f = fixture(),
    entered = gate(),
    release = gate();
  let current = true,
    hold = false,
    effects = 0;
  const a = await f.issue(
    "logical",
    () => current,
    async () => {
      if (hold) {
        entered.resolve();
        await release.promise;
      }
    },
  );
  const p = await f.attach(a),
    binding = await f.writers.bind(a, p.child, p.source);
  hold = true;
  const writing = f.writers.write(binding, p.child, p.source, async () => {
    effects++;
  });
  const outcome = writing.catch((error: unknown) => error);
  await entered.promise;
  current = false;
  release.resolve();
  expect(String(await outcome)).toContain("source changed");
  expect(effects).toBe(0);
  await expect(f.writers.finish(a)).resolves.toBeUndefined();
});

it("keeps a real failed write sticky across finish, warm rebind and shutdown, while unrelated sources work", async () => {
  const f = fixture(),
    failure = new Error("actual original callback failed");
  const a = await f.issue(),
    p = await f.attach(a),
    binding = await f.writers.bind(a, p.child, p.source);
  await expect(
    f.writers.write(binding, p.child, p.source, async () => {
      throw failure;
    }),
  ).rejects.toBe(failure);
  const end = f.writers.finish(a);
  expect(f.writers.finish(a)).toBe(end);
  await expect(end).rejects.toMatchObject({ errors: [failure] });
  const b = await f.issue();
  expect(() => f.writers.bind(b, p.child, p.source)).toThrow(/not verified/);
  const sibling = await f.issue("sibling"),
    q = await f.attach(sibling, "sibling");
  await f.writers.write(
    await f.writers.bind(sibling, q.child, q.source),
    q.child,
    q.source,
    async () => {},
  );
  await f.writers.finish(sibling);
  // The failure was reported by finish(a); shutdown does not rethrow it forever.
  await expect(f.writers.drain()).resolves.toBeUndefined();
});

it("ignores a late stdin EPIPE after admission closed", async () => {
  const f = fixture();
  const a = await f.issue(),
    p = await f.attach(a),
    binding = await f.writers.bind(a, p.child, p.source);
  const write = f.writers.write(binding, p.child, p.source, async () => {
    f.writers.closeAdmission(a);
    throw Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
  });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await expect(write).rejects.toThrow("EPIPE");
  await expect(f.writers.finish(a)).resolves.toBeUndefined();
  warn.mockRestore();
});

it("refuses capacity before mutating A and frees only successfully finished run capacity", async () => {
  const f = fixture({ maxRuns: 1 });
  const a = await f.issue(),
    p = await f.attach(a),
    binding = await f.writers.bind(a, p.child, p.source);
  const ownerB = {},
    sourceB = { owner: ownerB, sessionId: "logical", runId: "B", isCurrent: () => true };
  expect(() => f.writers.reserve(sourceB)).toThrow(/capacity is full/);
  let effects = 0;
  await f.writers.write(binding, p.child, p.source, async () => {
    effects++;
  });
  await f.writers.finish(a);
  const b = f.writers.reserve(sourceB);
  await f.writers.setExecutionCwd(b, f.directory);
  await f.writers.write(await f.writers.bind(b, p.child, p.source), p.child, p.source, async () => {
    effects++;
  });
  expect(effects).toBe(2);
  await f.writers.finish(b);
});

it("compares canonical actual cwd and private logical birth, never a physical ID prefix", async () => {
  const f = fixture();
  const alias = join(f.directory, "alias"),
    actual = join(f.directory, "actual"),
    other = join(f.directory, "other");
  mkdirSync(actual);
  mkdirSync(other);
  symlinkSync(actual, alias, process.platform === "win32" ? "junction" : "dir");
  const a = await f.issue("logical", () => true, undefined, alias),
    p = await f.attach(a, "unrelated-physical-name#2", actual);
  const binding = await f.writers.bind(a, p.child, p.source);
  const wrongLogical = await f.issue("logical-extra", () => true, undefined, actual);
  const wrongCwd = await f.issue("logical", () => true, undefined, other);
  expect(() => f.writers.bind(wrongLogical, p.child, p.source)).toThrow(/does not match/);
  expect(() => f.writers.bind(wrongCwd, p.child, p.source)).toThrow(/does not match/);
  expect(() => f.writers.bind(a, p.child, { ...p.source, constructionId: randomUUID() })).toThrow(
    /does not match/,
  );
  await f.writers.write(binding, p.child, p.source, async () => {});
  await Promise.all([
    f.writers.finish(a),
    f.writers.finish(wrongLogical),
    f.writers.finish(wrongCwd),
  ]);
});

it("closes normal admission and issuance while its preissued original cleanup view still settles", async () => {
  const f = fixture(),
    run = await f.issue(),
    control = f.writers.controlRun(run),
    p = await f.attach(run);
  const normal = await f.writers.bind(run, p.child, p.source);
  f.writers.closeAdmission(run);
  expect(() => f.writers.write(normal, p.child, p.source, async () => {})).toThrow(/closed/);
  await expect(
    f.writers.prepareProcess(control, { sessionId: "new-process", cwd: f.directory }),
  ).rejects.toThrow(/cannot start/);
  const cleanup = await f.writers.bind(control, p.child, p.source);
  f.writers.seal();
  expect(() =>
    f.writers.reserve({ owner: {}, sessionId: "new", runId: "new", isCurrent: () => true }),
  ).toThrow(/stopping/);
  expect(() =>
    f.writers.assertControlWrite(cleanup, JSON.stringify({ method: "turn/start" })),
  ).toThrow(/cannot start/);
  expect(() =>
    f.writers.assertControlWrite(cleanup, JSON.stringify({ method: "turn/start", type: "abort" })),
  ).toThrow(/cannot start/);
  let actual = 0;
  await f.writers.write(cleanup, p.child, p.source, async () => {
    f.writers.assertControlWrite(cleanup, JSON.stringify({ method: "turn/interrupt" }));
    actual++;
  });
  expect(actual).toBe(1);
  await f.writers.finish(run);
  expect(() => f.writers.write(cleanup, p.child, p.source, async () => {})).toThrow(/closed/);
});

it("keeps main project equality separate from trusted launcher and auxiliary sandbox roles", async () => {
  const f = fixture(),
    second = join(f.directory, "second"),
    launcher = join(f.directory, "launcher"),
    sandbox = join(f.directory, "sandbox");
  mkdirSync(second);
  mkdirSync(launcher);
  mkdirSync(sandbox);
  const main = await f.issue(),
    grant = await f.writers.grantCwd(main, launcher, "antigravity-launcher");
  const token = await f.writers.prepareProcess(main, {
    sessionId: "main-actual",
    cwd: launcher,
    provider: "antigravity",
    cwdGrant: grant,
  });
  const child = {} as ProviderChild,
    source = { sessionId: "main-actual", constructionId: randomUUID(), cwd: token.cwd };
  f.writers.attachProcess(main, child, source, token);
  f.writers.completeProcess(token);
  await f.writers.bind(main, child, source);
  await f.writers.finish(main);
  const moved = await f.issue("logical", () => true, undefined, second);
  expect(() => f.writers.bind(moved, child, source)).toThrow(/does not match/);
  await f.writers.finish(moved);
  const issueAux = async (cwd: string) => {
    const handle = f.writers.reserve({
      owner: {},
      sessionId: "explicit-auxiliary-lane",
      runId: randomUUID(),
      auxiliary: true,
      isCurrent: () => true,
    });
    await f.writers.setExecutionCwd(handle, cwd);
    return handle;
  };
  const a = await issueAux(f.directory),
    sandboxGrant = await f.writers.grantCwd(a, sandbox, "text-sandbox");
  const prepared = await f.writers.prepareProcess(a, {
    sessionId: "aux-original",
    cwd: sandbox,
    provider: "antigravity",
    cwdGrant: sandboxGrant,
  });
  const auxChild = {} as ProviderChild,
    auxSource = { sessionId: "aux-original", constructionId: randomUUID(), cwd: prepared.cwd };
  f.writers.attachProcess(a, auxChild, auxSource, prepared);
  f.writers.completeProcess(prepared);
  await f.writers.bind(a, auxChild, auxSource);
  await f.writers.finish(a);
  const b = await issueAux(second);
  await f.writers.write(
    await f.writers.bind(b, auxChild, auxSource),
    auxChild,
    auxSource,
    async () => {},
  );
  const foreignProvider = await issueAux(second);
  await expect(
    f.writers.prepareProcess(foreignProvider, {
      sessionId: "wrong-provider",
      cwd: sandbox,
      provider: "codex",
      cwdGrant: sandboxGrant,
    }),
  ).rejects.toThrow(/grant does not match/);
  await Promise.all([f.writers.finish(b), f.writers.finish(foreignProvider)]);
});
