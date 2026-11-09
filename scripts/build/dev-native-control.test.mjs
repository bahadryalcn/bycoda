import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acceptanceControl } from "./dev-native-control.mjs";

test("run-local controls execute once and reject unknown commands without dispatch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-dev-control-"));
  try {
    let stopped = 0;
    const control = acceptanceControl(directory, {
      "stop-host": async () => ({ hostPid: ++stopped }),
    });
    await control.poll();
    await writeFile(control.path, JSON.stringify({ id: "request-1", action: "stop-host" }));
    await control.poll();
    await control.poll();
    assert.equal(stopped, 1);
    assert.deepEqual(JSON.parse(await readFile(control.resultPath, "utf8")), {
      id: "request-1",
      ok: true,
      hostPid: 1,
    });
    await writeFile(control.path, JSON.stringify({ id: "request-2", action: "kill-owner-host" }));
    await control.poll();
    assert.equal(stopped, 1);
    assert.deepEqual(JSON.parse(await readFile(control.resultPath, "utf8")), {
      id: "request-2",
      ok: false,
      error: "Unsupported native acceptance control",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("failed restart acknowledges failure and a later request may retry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-dev-control-"));
  try {
    let attempts = 0;
    const control = acceptanceControl(directory, {
      "restart-app": async () => {
        if (++attempts === 1) throw new Error("not ready");
        return { pid: 123 };
      },
    });
    await writeFile(control.path, JSON.stringify({ id: "one", action: "restart-app" }));
    await control.poll();
    assert.equal(JSON.parse(await readFile(control.resultPath, "utf8")).ok, false);
    await writeFile(control.path, JSON.stringify({ id: "two", action: "restart-app" }));
    await control.poll();
    assert.equal(JSON.parse(await readFile(control.resultPath, "utf8")).pid, 123);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
