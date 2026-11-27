import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { lockedIntegrity } from "./host-pty.mjs";

test("reads the pinned integrity of the PTY binding and each target prebuild", async () => {
  const lockfile = await readFile(new URL("../../pnpm-lock.yaml", import.meta.url), "utf8");
  const { dependencies } = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  );
  const version = dependencies["@lydell/node-pty"];
  for (const name of [
    "@lydell/node-pty",
    ...["win32-x64", "win32-arm64", "darwin-x64", "darwin-arm64", "linux-x64", "linux-arm64"].map(
      (target) => `@lydell/node-pty-${target}`,
    ),
  ])
    assert.match(lockedIntegrity(lockfile, name, version), /^sha512-[A-Za-z0-9+/]+=*$/);
});

test("refuses a binding the lockfile does not pin", () => {
  assert.throws(() => lockedIntegrity("", "@lydell/node-pty", "9.9.9"), /not pinned/);
});
