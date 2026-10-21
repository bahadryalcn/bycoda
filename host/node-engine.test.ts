import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preparePosixNode } from "./node-engine";
import { launchAgent, systemdUnit } from "./service";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

it("keeps macOS/Linux service executable paths stable across package and Node updates and rollback", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-engine-"));
  directories.push(directory);
  const old = join(directory, "runtime", "old");
  const next = join(directory, "runtime", "next");
  for (const runtime of [old, next]) {
    await mkdir(join(runtime, "bin"), { recursive: true });
    await writeFile(join(runtime, "bin", "node"), "node one");
  }
  const engine = await preparePosixNode(join(old, "bin", "node"), directory);
  const before = await stat(engine);
  expect(await preparePosixNode(join(next, "bin", "node"), directory)).toBe(engine);
  expect((await stat(engine)).mtimeMs).toBe(before.mtimeMs);
  expect(engine).toBe(join(directory, "engine", "node"));
  const options = { directory, executable: engine, entry: join(next, "host.mjs"), port: 3776 };
  expect(launchAgent(options, "/bin")).toContain(`<string>${engine}</string>`);
  expect(systemdUnit(options, "/bin")).toContain(`ExecStart=${JSON.stringify(engine)}`);
  await writeFile(join(next, "bin", "node"), "node two");
  await preparePosixNode(join(next, "bin", "node"), directory);
  expect(await readFile(engine, "utf8")).toBe("node two");
  await preparePosixNode(join(old, "bin", "node"), directory);
  expect(await readFile(engine, "utf8")).toBe("node one");
  await expect(preparePosixNode(join(directory, "missing"), directory)).rejects.toThrow();
  expect(await readFile(engine, "utf8")).toBe("node one");
  expect(await readdir(join(directory, "engine"))).toEqual(["node"]);
  if (process.platform !== "win32") expect((await stat(engine)).mode & 0o777).toBe(0o700);
});
