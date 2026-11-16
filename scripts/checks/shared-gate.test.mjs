import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { acquireLock, gateArguments, gateKey, sharedGate } from "./shared-gate.mjs";

const scratch = () => mkdtempSync(path.join(tmpdir(), "bycoda-shared-gate-"));
const quiet = { print: () => {}, pollMs: 5 };

test("one tree state runs the gate once and later sessions reuse the result", async () => {
  const directory = scratch();
  let runs = 0;
  const options = {
    ...quiet,
    name: "web",
    command: ["gate"],
    directory,
    treeHash: () => "tree-a",
    run: async () => (runs++, { exitCode: 0 }),
  };
  assert.equal(await sharedGate(options), 0);
  assert.equal(await sharedGate(options), 0);
  assert.equal(runs, 1);
  assert.equal(await sharedGate({ ...options, force: true }), 0);
  assert.equal(runs, 2);
  assert.equal(existsSync(path.join(directory, "lock")), false);
  rmSync(directory, { recursive: true, force: true });
});

test("a failure is shared with its log, and a changed tree runs again", async () => {
  const directory = scratch();
  let tree = "tree-a";
  let runs = 0;
  const printed = [];
  const options = {
    ...quiet,
    print: (line) => printed.push(line),
    name: "web",
    command: ["gate"],
    directory,
    treeHash: () => tree,
    run: async (_command, { logFile }) => {
      runs++;
      writeFileSync(logFile, "first line\nassertion failed in widget.test.ts\n");
      return { exitCode: 1 };
    },
  };
  assert.equal(await sharedGate(options), 1);
  assert.equal(await sharedGate(options), 1);
  assert.equal(runs, 1);
  assert(printed.some((line) => line.includes("assertion failed in widget.test.ts")));
  tree = "tree-b";
  assert.equal(await sharedGate(options), 1);
  assert.equal(runs, 2);
  rmSync(directory, { recursive: true, force: true });
});

test("a run whose tree changed underneath it is never shared", async () => {
  const directory = scratch();
  let tree = "tree-a";
  let runs = 0;
  const options = {
    ...quiet,
    name: "web",
    command: ["gate"],
    directory,
    treeHash: () => tree,
    run: async () => {
      runs++;
      tree = `edited-${runs}`;
      return { exitCode: 0 };
    },
  };
  assert.equal(await sharedGate(options), 0);
  tree = "tree-a";
  assert.equal(await sharedGate(options), 0);
  assert.equal(runs, 2);
  rmSync(directory, { recursive: true, force: true });
});

test("concurrent sessions on one tree queue behind one run", async () => {
  const directory = scratch();
  let runs = 0;
  let running = 0;
  let overlap = false;
  const session = () =>
    sharedGate({
      ...quiet,
      name: "web",
      command: ["gate"],
      directory,
      treeHash: () => "tree-a",
      alive: () => true,
      run: async () => {
        runs++;
        if (++running > 1) overlap = true;
        await new Promise((resolve) => setTimeout(resolve, 40));
        running--;
        return { exitCode: 0 };
      },
    });
  assert.deepEqual(await Promise.all([session(), session(), session()]), [0, 0, 0]);
  assert.equal(runs, 1);
  assert.equal(overlap, false);
  rmSync(directory, { recursive: true, force: true });
});

test("a lock left by a dead process is replaced, a live holder is respected", () => {
  const directory = scratch();
  const file = path.join(directory, "lock");
  writeFileSync(file, JSON.stringify({ pid: 4242, name: "web" }));
  const held = acquireLock(file, { pid: 1 }, { alive: () => true });
  assert.equal(held.acquired, false);
  assert.equal(held.holder.pid, 4242);
  assert.equal(acquireLock(file, { pid: 1 }, { alive: () => false }).acquired, true);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).pid, 1);
  rmSync(directory, { recursive: true, force: true });
});

test("keys separate gates, commands and trees; arguments are validated", () => {
  const base = { name: "web", command: ["a"], tree: "t", platform: "x", node: "v1" };
  const keys = new Set([
    gateKey(base),
    gateKey({ ...base, name: "preflight" }),
    gateKey({ ...base, command: ["b"] }),
    gateKey({ ...base, tree: "u" }),
  ]);
  assert.equal(keys.size, 4);
  assert.deepEqual(gateArguments(["web", "--", "pnpm", "x"]), {
    name: "web",
    command: ["pnpm", "x"],
  });
  assert.throws(() => gateArguments(["web"]));
  assert.throws(() => gateArguments(["../web", "--", "x"]));
});
