import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { psQuote, runPowerShell } from "../windows";
import type { NativeHelperDeploymentInput } from "./deployment";

const prefix = "bycoda-native-deploy-cli-";
const children = new Set<ChildProcessWithoutNullStreams>();
let root: string;
let bundle: string;
let canonicalTemporaryDirectory: string;

beforeAll(async () => {
  canonicalTemporaryDirectory = await realpath(tmpdir());
  root = await realpath(await mkdtemp(join(canonicalTemporaryDirectory, prefix)));
  bundle = join(root, "isolated-host-cli.mjs");
  // Match the production Host bundler. This writes only the owned temporary
  // directory, never build/host, a package, an installation or a live profile.
  await build({
    entryPoints: [fileURLToPath(new URL("../cli.ts", import.meta.url))],
    outfile: bundle,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    banner: {
      js: "import { createRequire as __bycodaCreateRequire } from 'node:module'; var require = __bycodaCreateRequire(import.meta.url);",
    },
    loader: { ".ps1": "text", ".md": "text" },
    define: { "import.meta.hot": "undefined" },
    logLevel: "silent",
  });
});

afterAll(async () => {
  await Promise.all(
    [...children].map(async (child) => {
      const exited = new Promise<void>((done) => child.once("close", () => done()));
      child.kill();
      await exited;
    }),
  );
  if (!root) return;
  const target = resolve(root);
  if (
    !basename(target).startsWith(prefix) ||
    dirname(target).toLowerCase() !== canonicalTemporaryDirectory.toLowerCase() ||
    (await lstat(target)).isSymbolicLink() ||
    (await realpath(target)).toLowerCase() !== target.toLowerCase()
  ) {
    throw new Error("Unsafe deployment CLI test cleanup");
  }
  await rm(target, { recursive: true, force: true });
});

async function fixture() {
  const directory = join(root, randomUUID());
  const host = join(directory, "host");
  const profile = join(directory, "profile");
  const home = join(directory, "home");
  await Promise.all(
    [host, profile, home].map((path) => mkdir(path, { recursive: true, mode: 0o700 })),
  );
  const executable = join(directory, "selected-native-artifact.exe");
  // This is a hash-pinned synthetic artifact. Provisioning must not execute it.
  const bytes = Buffer.from("synthetic CLI deployment artifact; never executable\n");
  await writeFile(executable, bytes);
  const input: NativeHelperDeploymentInput = {
    version: 1,
    platform: process.platform as NativeHelperDeploymentInput["platform"],
    canonicalHostDirectory: await realpath(host),
    applicationIdentifier: "com.bycoda.desktop.dev",
    canonicalNativeProfileDirectory: await realpath(profile),
    sourceProfileId: randomUUID(),
    canonicalGUIExecutablePath: await realpath(executable),
    rawSha256: createHash("sha256").update(bytes).digest("hex"),
    executableSize: bytes.length,
    helperProtocol: 1,
    sourceBuildMetadata: { version: "isolated-cli-fixture" },
  };
  return { directory, host, profile, home, executable, bytes, input };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function runCli(f: Fixture, input: Uint8Array) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      ["systemroot", "windir", "temp", "tmp"].includes(key.toLowerCase()),
    ),
  );
  const child = spawn(process.execPath, [bundle, "native-authority-deploy", "--data-dir", f.host], {
    cwd: f.directory,
    env: {
      ...env,
      PATH: dirname(process.execPath),
      HOME: f.home,
      USERPROFILE: f.home,
      APPDATA: f.home,
      LOCALAPPDATA: f.home,
      XDG_CONFIG_HOME: f.home,
      XDG_DATA_HOME: f.home,
    },
    windowsHide: true,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.add(child);
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let outputBytes = 0;
  let timedOut = false;
  let overflow = false;
  let spawnError: Error | undefined;
  const collect = (target: Buffer[]) => (bytes: Buffer) => {
    outputBytes += bytes.length;
    if (outputBytes > 16 * 1024) {
      overflow = true;
      child.kill();
    } else target.push(bytes);
  };
  child.stdout.on("data", collect(stdout));
  child.stderr.on("data", collect(stderr));
  child.on("error", (error) => {
    spawnError = error;
  });
  child.stdin.on("error", () => {}); // A rejected bounded input may close early.
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, 20_000);
  const outcome = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) => {
    child.once("close", (code, signal) => done({ code, signal }));
  });
  child.stdin.end(input);
  // close follows actual exit and stdio settlement; a kill request is not exit.
  const result = await outcome;
  clearTimeout(timer);
  children.delete(child);
  if (spawnError) throw spawnError;
  expect(timedOut, "the provisioning branch must exit without a Host server").toBe(false);
  expect(overflow, "CLI output must remain bounded").toBe(false);
  return {
    ...result,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
  };
}

async function files(directory: string, base = ""): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...(await files(join(directory, entry.name), relative)));
    else found.push(relative);
  }
  return found.sort();
}

async function expectNoRuntime(f: Fixture, expectedHostFiles: string[]) {
  // Exact contents also reject host.db/WAL, running.json, engine/provider state,
  // and accidental use of the isolated default home instead of --data-dir.
  expect(await files(f.host)).toEqual(expectedHostFiles);
  expect(await files(f.home)).toEqual([]);
  expect(await files(f.profile)).toEqual([]);
  expect(await readFile(f.executable)).toEqual(f.bytes);
}

async function expectPrivate(paths: string[]) {
  if (process.platform !== "win32") {
    for (const path of paths) expect((await lstat(path)).mode & 0o077).toBe(0);
    return;
  }
  const output = await runPowerShell(`
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowed = @($sid,'S-1-5-18','S-1-5-32-544')
$result = @(foreach ($p in @(${paths.map(psQuote).join(",")})) {
  $acl = Get-Acl -LiteralPath $p -ErrorAction Stop
  $foreign = @($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | Where-Object { $_.AccessControlType -eq 'Allow' -and $allowed -notcontains $_.IdentityReference.Value })
  [pscustomobject]@{ ownerMatches = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $sid; foreignAllowRules = $foreign.Count }
})
ConvertTo-Json -InputObject $result -Compress
`);
  expect(JSON.parse(output)).toEqual(
    paths.map(() => ({ ownerMatches: true, foreignAllowRules: 0 })),
  );
}

async function expectRejected(f: Fixture, input: Uint8Array) {
  const result = await runCli(f, input);
  expect(result.code).toBe(1);
  expect(result.signal).toBeNull();
  expect(result.stdout).toBe("");
  await expectNoRuntime(f, []);
  expect(result.stderr.trim()).toBe("Native helper deployment unavailable");
}

describe("actual isolated native-authority-deploy CLI", () => {
  it("persists a private grant and minimal unqualified receipt without starting the Host", async () => {
    const f = await fixture();
    const result = await runCli(f, Buffer.from(JSON.stringify(f.input)));
    expect(result.code).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stderr).toBe("");
    const receipt = JSON.parse(result.stdout);
    expect(receipt).toEqual({
      version: 1,
      deploymentId: f.input.sourceProfileId,
      generation: expect.any(String),
      qualified: false,
    });
    expect(receipt.generation).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const relative = `native-authority/deployments/${f.input.sourceProfileId}.json`;
    const grant = join(f.host, relative);
    const original = await readFile(grant, "utf8");
    expect(Buffer.byteLength(original)).toBeLessThanOrEqual(8192);
    const saved = JSON.parse(original);
    expect(saved).toEqual({
      ...f.input,
      generation: receipt.generation,
      createdAt: expect.any(Number),
    });
    expect(Number.isSafeInteger(saved.createdAt) && saved.createdAt > 0).toBe(true);
    await expectPrivate([f.host, join(f.host, "native-authority"), dirname(grant), grant]);
    await expectNoRuntime(f, [relative]);

    const retry = await runCli(f, Buffer.from(JSON.stringify(f.input)));
    expect(retry.code).toBe(0);
    expect(retry.stderr).toBe("");
    expect(JSON.parse(retry.stdout)).toEqual(receipt);
    expect(await readFile(grant, "utf8")).toBe(original);
    await expectNoRuntime(f, [relative]);
  });

  it("rejects malformed JSON without echoing the supplied input", async () => {
    const f = await fixture();
    await expectRejected(f, Buffer.from("privateFixtureSentinel-must-never-be-echoed"));
  });

  it("rejects malformed UTF8 with the same generic failure and no grant", async () => {
    await expectRejected(await fixture(), Uint8Array.from([0xc3, 0x28]));
  });

  it("rejects otherwise valid JSON exceeding the stdin byte limit", async () => {
    const f = await fixture();
    const valid = Buffer.from(JSON.stringify(f.input));
    expect(valid.length).toBeLessThan(8192);
    await expectRejected(f, Buffer.concat([valid, Buffer.alloc(8193 - valid.length, 0x20)]));
  });

  it("rejects a noncanonical linked profile before publishing any grant", async () => {
    const f = await fixture();
    const alias = join(f.directory, "profile-alias");
    await symlink(f.profile, alias, process.platform === "win32" ? "junction" : "dir");
    await expectRejected(
      f,
      Buffer.from(JSON.stringify({ ...f.input, canonicalNativeProfileDirectory: alias })),
    );
    expect(await realpath(alias)).toBe(f.input.canonicalNativeProfileDirectory);
  });
});
