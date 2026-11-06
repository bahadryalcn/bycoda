// TEMPORARY standalone probe: raw costs of the suspected primitives on this machine.
import { mkdtempSync, realpathSync, writeFileSync, rmSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
const time = (label, fn) => { const s = performance.now(); let r; try { r = fn(); } catch (e) { r = `ERR ${String(e.stderr ?? e).trim().slice(0, 120)}`; } console.log(`${(performance.now() - s).toFixed(1).padStart(8)}ms ${label} -> ${String(r).trim().slice(0, 160)}`); };
const short = mkdtempSync(join(tmpdir(), "bycoda-probe-"));
const long = realpathSync.native(short);
console.log({ tmpdir: tmpdir(), short, long, jsRealpath: realpathSync(short), promises: await realpath(short) });
writeFileSync(join(short, "a.txt"), "x");
for (const dir of [short, long]) for (let i = 0; i < 3; i++) {
  time(`git ls-files (${dir === short ? "short" : "long"}) #${i}`, () => execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "."], { cwd: dir, encoding: "utf8", stdio: "pipe" }));
  time(`git rev-parse (${dir === short ? "short" : "long"}) #${i}`, () => execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8", stdio: "pipe" }));
}
time("git --version", () => execFileSync("git", ["--version"], { encoding: "utf8" }));
time("where git", () => execFileSync("where", ["git"], { encoding: "utf8" }));
time("env GIT_CEILING", () => process.env.GIT_CEILING_DIRECTORIES ?? "(unset)");
rmSync(short, { recursive: true, force: true });
