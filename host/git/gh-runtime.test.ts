import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { checksumFor, GH_CLI_VERSION, GhRuntime, ghAsset } from "./gh-runtime";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

const RELEASE = `https://github.com/cli/cli/releases/download/v${GH_CLI_VERSION}`;
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function tempDirectory(name: string) {
  const directory = await mkdtemp(join(tmpdir(), `bycoda-${name}-`));
  directories.push(directory);
  return directory;
}

/** A PATH folder holding a fake `gh`; the fake decides what `auth` answers. */
async function binaryIn(directory: string, name = "gh") {
  await mkdir(directory, { recursive: true });
  const path = join(directory, name);
  await writeFile(path, "fake");
  return path;
}

/** Fake release host: serves the checksums file and the archive bytes for one asset. */
function releaseFetch(file: string, archive: Buffer, listed = sha(archive)) {
  return vi.fn(async (url: string | URL | Request) => {
    const text = String(url);
    if (text.endsWith("_checksums.txt"))
      return new Response(`${listed}  ${file}\n${"0".repeat(64)}  other.tar.gz\n`);
    if (text === `${RELEASE}/${file}`) return new Response(archive);
    return new Response("missing", { status: 404 });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

/** Fake gh: extraction writes the member; `--version` reports the pinned release. */
function fakeGh(options: { signedIn?: string[]; tokens?: Record<string, string> } = {}) {
  return vi.fn(async (file: string, args: string[], _options: unknown) => {
    if (args[0] === "-xf" || args[0] === "-xzf") {
      const stage = args[args.indexOf("-C") + 1]!;
      const member = args[args.length - 1]!;
      await mkdir(dirname(join(stage, member)), { recursive: true });
      await writeFile(join(stage, member), "gh-binary");
      return "";
    }
    if (args[0] === "--version") return `gh version ${GH_CLI_VERSION} (2026-10-23)\n`;
    if (args[0] === "auth" && args[1] === "status") {
      if (options.signedIn?.includes(file)) return "";
      throw new Error("You are not logged into any GitHub hosts.");
    }
    if (args[0] === "auth" && args[1] === "token") {
      const token = options.tokens?.[file];
      if (token) return `${token}\n`;
      throw new Error("no token");
    }
    return `ran ${file} ${args.join(" ")}`;
  });
}

describe("GitHub CLI asset mapping", () => {
  it("maps the six supported platforms to the official release assets", () => {
    const v = GH_CLI_VERSION;
    expect(ghAsset("win32", "x64", v)).toEqual({
      file: `gh_${v}_windows_amd64.zip`,
      entry: ["bin", "gh.exe"],
    });
    expect(ghAsset("win32", "arm64", v)).toEqual({
      file: `gh_${v}_windows_arm64.zip`,
      entry: ["bin", "gh.exe"],
    });
    expect(ghAsset("darwin", "x64", v)).toEqual({
      file: `gh_${v}_macOS_amd64.zip`,
      entry: [`gh_${v}_macOS_amd64`, "bin", "gh"],
    });
    expect(ghAsset("darwin", "arm64", v)).toEqual({
      file: `gh_${v}_macOS_arm64.zip`,
      entry: [`gh_${v}_macOS_arm64`, "bin", "gh"],
    });
    expect(ghAsset("linux", "x64", v)).toEqual({
      file: `gh_${v}_linux_amd64.tar.gz`,
      entry: [`gh_${v}_linux_amd64`, "bin", "gh"],
    });
    expect(ghAsset("linux", "arm64", v)).toEqual({
      file: `gh_${v}_linux_arm64.tar.gz`,
      entry: [`gh_${v}_linux_arm64`, "bin", "gh"],
    });
  });

  it("has no managed asset for unsupported architectures", () => {
    expect(ghAsset("linux", "ia32")).toBeUndefined();
    expect(ghAsset("freebsd", "x64")).toBeUndefined();
  });

  it("reads the release checksum for one asset, including binary-mode markers", () => {
    const text = `${"a".repeat(64)} *gh_2.103.2_linux_amd64.tar.gz\n${"B".repeat(64)}  gh_2.103.2_windows_amd64.zip\n`;
    expect(checksumFor(text, "gh_2.103.2_linux_amd64.tar.gz")).toBe("a".repeat(64));
    expect(checksumFor(text, "gh_2.103.2_windows_amd64.zip")).toBe("b".repeat(64));
    expect(checksumFor(text, "gh_2.103.2_macOS_arm64.zip")).toBeUndefined();
  });
});

describe("GitHub CLI resolution", () => {
  it("prefers gh on PATH over the managed copy", async () => {
    const base = await tempDirectory("gh-path");
    const onPath = await binaryIn(join(base, "path-bin"));
    const exec = fakeGh({ signedIn: [onPath] });
    const fetch = releaseFetch("unused", Buffer.from("x"));
    const runtime = new GhRuntime(join(base, "data"), {
      platform: "linux",
      arch: "x64",
      env: { PATH: join(base, "path-bin") },
      commonDirectories: [],
      exec,
      fetch,
    });
    expect(await runtime.run(base, ["pr", "list"])).toBe(`ran ${onPath} pr list`);
    expect(fetch).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalledWith(
      expect.stringContaining("tools"),
      expect.anything(),
      expect.anything(),
    );
  });

  it("applies per-call limits and keeps the default deadline otherwise", async () => {
    const base = await tempDirectory("gh-limits");
    const onPath = await binaryIn(join(base, "path-bin"));
    const exec = fakeGh({ signedIn: [onPath] });
    const runtime = new GhRuntime(join(base, "data"), {
      platform: "linux",
      arch: "x64",
      env: { PATH: join(base, "path-bin") },
      commonDirectories: [],
      exec,
      fetch: releaseFetch("unused", Buffer.from("x")),
    });
    await runtime.run(base, ["pr", "create"], { timeoutMs: 120_000, maxBuffer: 8 << 20 });
    expect(exec).toHaveBeenLastCalledWith(
      onPath,
      ["pr", "create"],
      expect.objectContaining({ timeout: 120_000, maxBuffer: 8 << 20 }),
    );
    await runtime.run(base, ["pr", "view"]);
    expect(exec.mock.lastCall?.[2]).toMatchObject({ timeout: 30_000 });
    expect(exec.mock.lastCall?.[2]).not.toHaveProperty("maxBuffer");
  });

  it("uses an install folder before installing when PATH has no gh", async () => {
    const base = await tempDirectory("gh-common");
    const installed = await binaryIn(join(base, "common"));
    const exec = fakeGh({ signedIn: [installed] });
    const fetch = releaseFetch("unused", Buffer.from("x"));
    const runtime = new GhRuntime(join(base, "data"), {
      platform: "linux",
      arch: "x64",
      env: { PATH: join(base, "empty") },
      commonDirectories: [join(base, "common")],
      exec,
      fetch,
    });
    expect(await runtime.run(base, ["repo", "view"])).toBe(`ran ${installed} repo view`);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("installs the pinned copy when nothing is found, then reuses it", async () => {
    const base = await tempDirectory("gh-install");
    const data = join(base, "data");
    const asset = ghAsset("linux", "x64")!;
    const archive = Buffer.from("release-archive");
    const fetch = releaseFetch(asset.file, archive);
    const exec = fakeGh({
      signedIn: [join(data, "tools", `gh-${GH_CLI_VERSION}`, ...asset.entry)],
    });
    const runtime = new GhRuntime(data, {
      platform: "linux",
      arch: "x64",
      env: { PATH: join(base, "empty") },
      commonDirectories: [],
      exec,
      fetch,
    });
    const managed = join(data, "tools", `gh-${GH_CLI_VERSION}`, ...asset.entry);
    const [first, second] = await Promise.all([
      runtime.run(base, ["pr", "list"]),
      runtime.run(base, ["pr", "view"]),
    ]);
    expect(first).toBe(`ran ${managed} pr list`);
    expect(second).toBe(`ran ${managed} pr view`);
    // One checksums download and one archive download for two concurrent first uses.
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      `${RELEASE}/gh_${GH_CLI_VERSION}_checksums.txt`,
      `${RELEASE}/${asset.file}`,
    ]);
    const extracts = exec.mock.calls.filter(([, args]) => args[0] === "-xzf");
    expect(extracts).toHaveLength(1);
    expect(extracts[0]![0]).toBe("tar");
    expect(extracts[0]![1]).toContain(asset.entry.join("/"));
    expect(extracts[0]![2]).toMatchObject({ timeout: expect.any(Number) });
    expect(
      await readFile(join(data, "tools", `gh-${GH_CLI_VERSION}`, ".install-complete"), "utf8"),
    ).toBe(GH_CLI_VERSION);
    const status = await runtime.status();
    expect(status).toMatchObject({ managed: true, installing: false, lastError: undefined });

    await runtime.run(base, ["pr", "status"]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("installs the Windows zip with the system tar.exe and the gh.exe member", async () => {
    const base = await tempDirectory("gh-win");
    const data = join(base, "data");
    const asset = ghAsset("win32", "x64")!;
    const fetch = releaseFetch(asset.file, Buffer.from("zip"));
    const exec = fakeGh({
      signedIn: [join(data, "tools", `gh-${GH_CLI_VERSION}`, "bin", "gh.exe")],
    });
    const runtime = new GhRuntime(data, {
      platform: "win32",
      arch: "x64",
      env: { PATH: "", SystemRoot: "C:\\Windows" },
      commonDirectories: [],
      exec,
      fetch,
    });
    await runtime.run(base, ["pr", "list"]);
    const extract = exec.mock.calls.find(([, args]) => args[0] === "-xf");
    expect(extract?.[0]).toMatch(/System32[\\/]tar\.exe$/);
    expect(extract?.[1]).toContain("bin/gh.exe");
  });
});

describe("GitHub CLI install verification", () => {
  it("refuses an archive whose SHA-256 does not match the release checksum", async () => {
    const base = await tempDirectory("gh-badsum");
    const data = join(base, "data");
    const asset = ghAsset("linux", "x64")!;
    const fetch = releaseFetch(asset.file, Buffer.from("tampered"), "f".repeat(64));
    const exec = fakeGh();
    const runtime = new GhRuntime(data, {
      platform: "linux",
      arch: "x64",
      env: { PATH: join(base, "empty") },
      commonDirectories: [],
      exec,
      fetch,
    });
    await expect(runtime.run(base, ["pr", "list"])).rejects.toThrow("verification failed");
    expect(exec).not.toHaveBeenCalledWith("tar", expect.anything(), expect.anything());
    expect(existsSync(join(data, "tools", `gh-${GH_CLI_VERSION}`))).toBe(false);
    expect(await runtime.status()).toMatchObject({
      managed: false,
      lastError: expect.stringContaining("verification failed"),
    });
  });

  it("reports a bounded wait when the first install is still running", async () => {
    const base = await tempDirectory("gh-wait");
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
    const runtime = new GhRuntime(join(base, "data"), {
      platform: "linux",
      arch: "x64",
      env: { PATH: join(base, "empty") },
      commonDirectories: [],
      exec: fakeGh(),
      fetch,
      waitMs: 20,
    });
    await expect(runtime.run(base, ["pr", "list"])).rejects.toThrow("still being installed");
  });

  it("refuses a platform without a published release asset", async () => {
    const base = await tempDirectory("gh-arch");
    const runtime = new GhRuntime(join(base, "data"), {
      platform: "linux",
      arch: "ia32",
      env: { PATH: join(base, "empty") },
      commonDirectories: [],
      exec: fakeGh(),
      fetch: releaseFetch("unused", Buffer.from("x")),
      waitMs: 1000,
    });
    await expect(runtime.run(base, ["pr", "list"])).rejects.toThrow("not published for linux-ia32");
  });
});

describe("GitHub CLI sign-in", () => {
  it("reuses a token from another gh on this computer when the chosen gh is signed out", async () => {
    const base = await tempDirectory("gh-token");
    const signedOut = await binaryIn(join(base, "first"));
    const signedIn = await binaryIn(join(base, "second"));
    const exec = fakeGh({ signedIn: [], tokens: { [signedIn]: "ghp_from_other_install" } });
    const runtime = new GhRuntime(join(base, "data"), {
      platform: "linux",
      arch: "x64",
      env: { PATH: [join(base, "first"), join(base, "second")].join(delimiter) },
      commonDirectories: [],
      exec,
    });
    expect(await runtime.run(base, ["pr", "list"])).toBe(`ran ${signedOut} pr list`);
    const call = exec.mock.calls.find(([file, args]) => file === signedOut && args[0] === "pr");
    expect(call?.[2]).toMatchObject({
      env: expect.objectContaining({ GH_TOKEN: "ghp_from_other_install" }),
    });
    // The sign-in probe is cached: a second call does not re-run `auth status`.
    const probes = () =>
      exec.mock.calls.filter(([, args]) => args[0] === "auth" && args[1] === "status").length;
    const before = probes();
    await runtime.run(base, ["pr", "view"]);
    expect(probes()).toBe(before);
  });

  it("tells the owner the exact sign-in command when no credential exists", async () => {
    const base = await tempDirectory("gh-signin");
    await binaryIn(join(base, "path-bin"));
    const runtime = new GhRuntime(join(base, "data"), {
      platform: "linux",
      arch: "x64",
      env: { PATH: join(base, "path-bin") },
      commonDirectories: [],
      exec: fakeGh({ signedIn: [] }),
    });
    await expect(runtime.run(base, ["pr", "list"])).rejects.toThrow(
      /Run gh auth login in a terminal/,
    );
  });

  it("names the managed copy's own path when only the managed install exists", async () => {
    const base = await tempDirectory("gh-managed-signin");
    const data = join(base, "data");
    const asset = ghAsset("linux", "x64")!;
    const managed = join(data, "tools", `gh-${GH_CLI_VERSION}`, ...asset.entry);
    const runtime = new GhRuntime(data, {
      platform: "linux",
      arch: "x64",
      env: { PATH: join(base, "empty") },
      commonDirectories: [],
      exec: fakeGh({ signedIn: [] }),
      fetch: releaseFetch(asset.file, Buffer.from("archive")),
    });
    await expect(runtime.run(base, ["pr", "list"])).rejects.toThrow(`"${managed}" auth login`);
  });
});

describe("GitHub CLI environment", () => {
  it("hides prompts and keeps the caller's environment for every call", async () => {
    const base = await tempDirectory("gh-env");
    const onPath = await binaryIn(join(base, "path-bin"));
    const exec = fakeGh({ signedIn: [onPath] });
    const runtime = new GhRuntime(join(base, "data"), {
      platform: "linux",
      arch: "x64",
      env: { PATH: join(base, "path-bin"), KEEP_ME: "1" },
      commonDirectories: [],
      exec,
    });
    await runtime.run(base, ["pr", "list"]);
    const call = exec.mock.calls.find(([, args]) => args[0] === "pr");
    expect(call?.[2]).toMatchObject({
      cwd: base,
      timeout: 30_000,
      env: expect.objectContaining({
        KEEP_ME: "1",
        GH_PROMPT_DISABLED: "1",
        GIT_TERMINAL_PROMPT: "0",
      }),
    });
  });
});
