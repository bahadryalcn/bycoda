import { afterEach, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { version } from "../package.json";

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
function fixture(badChecksum = false) {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-bootstrap-"));
  directories.push(dir);
  const base = join(dir, "host with spaces ' and $data");
  const source = join(dir, "source");
  const bin = join(dir, "tools");
  mkdirSync(source);
  mkdirSync(bin);
  writeFileSync(
    join(source, "bycoda-host"),
    `#!/bin/sh\ncase "$1" in\n--version) printf '%s\\n' ${quote(version)} ;;\nservice) printf 'service %s\\n' "$2" >> "$BYCODA_TEST_EVENTS" ;;\nconnection-info) printf '{"port":3774,"pid":123}\\n' ;;\n*) exit 1 ;;\nesac\n`,
    { mode: 0o755 },
  );
  const archive = join(dir, "host.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", source, "."]);
  const checksum = badChecksum
    ? "0".repeat(64)
    : createHash("sha256").update(readFileSync(archive)).digest("hex");
  writeFileSync(join(dir, "checksum"), `${checksum}  package.tar.gz\n`);
  writeFileSync(`${archive}.sha256`, `${checksum}  package.tar.gz\n`);
  // A local download fixture: run the real installer shell, without network or
  // a user service. Never change the test runner's HOME or installed services.
  writeFileSync(
    join(bin, "curl"),
    `#!/bin/sh\nfor arg do previous="$last"; last="$arg"; done\ncase "$previous" in -o) ;; *) exit 1 ;; esac\ncase "$last" in */checksum) cp "$BYCODA_TEST_CHECKSUM" "$last" ;; *) cp "$BYCODA_TEST_ARCHIVE" "$last" ;; esac\nprintf 'download\\n' >> "$BYCODA_TEST_DOWNLOADS"\n`,
    { mode: 0o755 },
  );
  const installer = readFileSync("src-tauri/src/remote_bootstrap.sh", "utf8");
  // The installer must never run against the real home directory of this machine.
  if (!installer.includes('BASE="$HOME/.bycoda-host"'))
    throw new Error("remote_bootstrap.sh no longer defines the expected host directory");
  const script = installer
    .replace('BASE="$HOME/.bycoda-host"', `BASE=${quote(base)}`)
    .replace("@@VERSION@@", quote(version))
    .replace("@@RELEASE@@", "'https://example.invalid/releases'");
  const run = (forceUpgrade = false, bundled = false) =>
    new Promise<{ code: number | null; out: string; error: string }>((resolve, reject) => {
      const child = spawn("sh", ["-s"], {
        env: {
          ...process.env,
          PATH: `${bin}:/usr/bin:/bin`,
          BYCODA_TEST_ARCHIVE: archive,
          BYCODA_TEST_CHECKSUM: join(dir, "checksum"),
          BYCODA_TEST_EVENTS: join(dir, "events"),
          BYCODA_TEST_DOWNLOADS: join(dir, "downloads"),
          BYCODA_HOST_FORCE_UPGRADE: forceUpgrade ? "1" : "0",
          ...(bundled ? { BYCODA_HOST_ARCHIVE: archive } : {}),
        },
        signal: AbortSignal.timeout(10_000),
      });
      let out = "";
      let error = "";
      child.stdout.on("data", (data) => {
        out += data;
      });
      child.stderr.on("data", (data) => {
        error += data;
      });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, out, error }));
      child.stdin.end(script);
    });
  return { dir, base, run, archive };
}
it.skipIf(process.platform === "win32")(
  "installs a verified package, handles unusual home paths, and reuses its host on reconnect",
  async () => {
    const { dir, base, run } = fixture();
    const first = await run();
    expect(first.error).toBe("");
    expect(first.code).toBe(0);
    expect(JSON.parse(first.out).port).toBe(3774);
    expect(existsSync(join(base, "bin/bycoda-host"))).toBe(true);
    expect((await run()).code).toBe(0);
    expect(readFileSync(join(dir, "downloads"), "utf8").trim().split("\n")).toHaveLength(2);
  },
);
it.skipIf(process.platform === "win32")(
  "updates an existing host only when requested, then restarts its service",
  async () => {
    const { dir, base, run } = fixture();
    expect((await run()).code).toBe(0);
    const oldRuntime = readFileSync(join(base, "runtime-path"), "utf8");
    expect((await run(true)).code).toBe(0);
    expect(readFileSync(join(base, "runtime-path"), "utf8")).not.toBe(oldRuntime);
    expect(readFileSync(join(dir, "events"), "utf8").trim().split("\n")).toEqual([
      "service install",
      "service uninstall",
      "service install",
    ]);
    expect(readFileSync(join(dir, "downloads"), "utf8").trim().split("\n")).toHaveLength(4);
  },
);
it.skipIf(process.platform === "win32")(
  "rejects a corrupted package before executing or publishing it",
  async () => {
    const { dir, base, run } = fixture(true);
    const result = await run();
    expect(result.code).not.toBe(0);
    expect(result.error).toContain("checksum mismatch");
    expect(existsSync(join(base, "bin/bycoda-host"))).toBe(false);
    expect(existsSync(join(dir, "events"))).toBe(false);
  },
);
it.skipIf(process.platform === "win32")(
  "installs and upgrades from the package bundled with the desktop without downloading",
  async () => {
    const { dir, base, run } = fixture();
    const first = await run(false, true);
    expect(first.error).toBe("");
    expect(first.code).toBe(0);
    expect(existsSync(join(base, "bin/bycoda-host"))).toBe(true);
    const oldRuntime = readFileSync(join(base, "runtime-path"), "utf8");
    expect((await run(true, true)).code).toBe(0);
    expect(readFileSync(join(base, "runtime-path"), "utf8")).not.toBe(oldRuntime);
    expect(existsSync(join(dir, "downloads"))).toBe(false);
  },
);
it.skipIf(process.platform === "win32")(
  "rejects a bundled package whose checksum does not match",
  async () => {
    const { base, run, archive } = fixture();
    writeFileSync(`${archive}.sha256`, `${"0".repeat(64)}  package.tar.gz\n`);
    const result = await run(false, true);
    expect(result.code).not.toBe(0);
    expect(result.error).toContain("checksum mismatch");
    expect(existsSync(join(base, "bin/bycoda-host"))).toBe(false);
  },
);
