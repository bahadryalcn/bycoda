import { afterEach, expect, it, vi } from "vitest";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tunnelExecutable } from "./tunnel-providers";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it("discovers executables in quoted and unquoted PATH directories containing spaces", async () => {
  const root = await mkdtemp(join(tmpdir(), "bycoda-tunnel-path-"));
  roots.push(root);
  const directory = join(root, "provider bin");
  await mkdir(directory);
  const executable = join(
    directory,
    process.platform === "win32" ? "cloudflared.exe" : "cloudflared",
  );
  await writeFile(executable, "placeholder");
  await chmod(executable, 0o755);
  for (const path of [directory, `"${directory}"`]) {
    vi.stubEnv("PATH", path);
    expect(await tunnelExecutable("cloudflare")).toBe(executable);
  }
});
