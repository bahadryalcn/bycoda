import { createReadStream } from "node:fs";
import { access, readFile, realpath, readlink, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import {
  delimiter,
  dirname,
  extname,
  join,
  basename,
  resolve,
  relative,
  isAbsolute,
} from "node:path";
import type { RemoteProvider } from "../src/features/connections/model/protocol";

const npmEntries: Record<string, string> = {
  codex: "node_modules/@openai/codex/bin/codex.js",
  claude: "node_modules/@anthropic-ai/claude-code/cli.js",
};

export const binaryNames: Record<RemoteProvider, string[]> = {
  codex: ["codex"],
  claude: ["claude"],
  cursor: ["cursor-agent", "agent"],
  grok: ["grok"],
  opencode: ["opencode"],
  pi: ["pi-coding-agent", "pi"],
  omp: ["omp"],
  fx: ["fx"],
  hermes: ["hermes"],
  // The ACP server is preferred over the agy CLI, matching the desktop resolver.
  antigravity:
    process.platform === "win32" ? ["agy_acp_server", "agy"] : ["agy_acp_server.par", "agy"],
  acp: [],
};

const providerDirectories = (provider: RemoteProvider): string[] => {
  const home = homedir();
  const localAppData = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
  const windows = process.platform === "win32";
  const extra: Partial<Record<RemoteProvider, string[]>> = {
    // The Codex app bundles a CLI it never puts on PATH; a real install wins.
    codex:
      process.platform === "darwin"
        ? [
            join(home, "Applications", "Codex.app", "Contents", "Resources"),
            "/Applications/Codex.app/Contents/Resources",
          ]
        : [],
    claude: [join(home, ".claude", "local"), join(home, ".local", "share", "claude")],
    grok: [join(home, ".grok", "bin")],
    opencode: [join(home, ".opencode", "bin")],
    fx: [join(home, ".fx", "bin")],
    hermes: [
      join(home, ".hermes", "hermes-agent", "venv", "bin"),
      join(home, ".hermes", "hermes-agent", ".venv", "bin"),
      ...(windows
        ? [
            join(localAppData, "hermes", "bin"),
            join(localAppData, "hermes", "hermes-agent", "venv", "Scripts"),
          ]
        : []),
    ],
    antigravity: [
      join(home, ".local", "share", "agy-acp"),
      ...(windows ? [join(localAppData, "agy-acp")] : []),
      join(home, ".local", "agy", "bin"),
      join(localAppData, "agy", "bin"),
    ],
  };
  return [
    ...new Set([
      ...(process.env.PATH ?? "").split(delimiter),
      join(home, ".local", "bin"),
      join(home, ".npm-global", "bin"),
      join(home, ".cargo", "bin"),
      join(home, "n", "bin"),
      join(home, ".bun", "bin"),
      ...(extra[provider] ?? []),
      ...(windows
        ? [join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "npm")]
        : ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/snap/bin"]),
    ]),
  ];
};

/** Whether a launcher name needs its content or package inspected to be trusted. */
function needsIdentityCheck(provider: RemoteProvider, name: string): boolean {
  return (
    (provider === "cursor" && name === "agent") ||
    (provider === "pi" && name === "pi") ||
    provider === "fx"
  );
}

/** An fx launcher shows its markers early; never read a whole large binary. */
const FX_SCAN_BYTES = 8 * 1024 * 1024;

/** Verify that an ambiguous launcher name belongs to requested provider. */
async function matchesProvider(
  candidate: string,
  provider: RemoteProvider,
  name: string,
): Promise<boolean> {
  if (provider === "cursor" && name === "agent") {
    try {
      if ((await readlink(candidate)).toLowerCase().includes("cursor-agent")) return true;
    } catch {
      /* not a symlink */
    }
    return fileContains(candidate, ["cursor-agent"], 64 * 1024);
  }
  if (provider === "pi" && name === "pi") return isPiLaunchCandidate(candidate);
  if (provider === "fx")
    return fileContains(
      candidate,
      ["vercel-labs/fx", "fx_model", "createfxagent", "fx acp"],
      FX_SCAN_BYTES,
    );
  return true;
}

/** Scan file content for any marker, stopping after optional byte limit. */
async function fileContains(
  path: string,
  markers: string[],
  maxBytes = Number.POSITIVE_INFINITY,
): Promise<boolean> {
  let read = 0;
  let carry = "";
  for await (const chunk of createReadStream(path, {
    highWaterMark: 64 * 1024,
  })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const length = Math.min(bytes.length, maxBytes - read);
    const text = (carry + bytes.subarray(0, length).toString("latin1")).toLowerCase();
    if (markers.some((marker) => text.includes(marker))) return true;
    carry = text.slice(-64);
    read += length;
    if (read >= maxBytes) break;
  }
  return false;
}

/** Marker strings that identify a Pi coding agent install. */
const PI_MARKERS = [
  "pi-coding-agent",
  "@earendil-works/pi",
  "@mariozechner/pi-coding-agent",
  "pi_coding_agent",
];

const PI_PACKAGE_NAMES = new Set([
  "@earendil-works/pi-coding-agent",
  "@mariozechner/pi-coding-agent",
]);

/**
 * npm's bin launcher for pi is a thin `#!/usr/bin/env node` stub whose only
 * job is to `createRequire(...)("./cli-runtime.js")` — the marker strings live
 * megabytes deeper in `dist/bundle/chunks/*.js`, past any reasonable head
 * scan. Identify the enclosing package instead: resolve symlinks (npm bins
 * symlink into `lib/node_modules/<pkg>/...`), then walk up to the nearest
 * `package.json` and check its exact `name` against supported Pi packages.
 */
async function isPiLaunchCandidate(candidate: string): Promise<boolean> {
  if (await fileContains(candidate, PI_MARKERS, 64 * 1024)) return true;
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(candidate)) {
    try {
      const launch = await providerLaunch(candidate, []);
      candidate = launch.args[0] ?? candidate;
    } catch {
      return false;
    }
  }
  let real: string;
  try {
    real = await realpath(candidate);
  } catch {
    return false;
  }
  let dir = dirname(real);
  // A scoped package's package.json sits two directories up from a nested
  // bin/script; a few hops bound the walk without leaving the package.
  for (let hop = 0; hop < 6; hop += 1) {
    const manifest = join(dir, "package.json");
    try {
      const pkg = JSON.parse(await readFile(manifest, "utf8")) as {
        name?: string;
      };
      const name = pkg.name?.toLowerCase();
      return name !== undefined && PI_PACKAGE_NAMES.has(name);
    } catch {
      /* not a package root; keep walking */
    }
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
  return false;
}

const RESOLVE_TTL_MS = 45_000;
const resolved = new Map<string, { at: number; path: string; size: number; mtimeMs: number }>();
const resolving = new Map<string, Promise<string>>();

/** Forget remembered provider launchers, e.g. after an install changes PATH. */
export function clearProviderResolution(): void {
  resolved.clear();
  resolving.clear();
}

/**
 * Resolve executable launcher for remote provider without running it. A
 * result is remembered briefly and revalidated by re-statting the launcher, so
 * listing models or starting a process does not rescan PATH each time.
 */
export async function resolveProvider(provider: RemoteProvider): Promise<string> {
  const key = [
    provider,
    process.platform,
    process.env.PATH ?? "",
    process.env.APPDATA ?? "",
    homedir(),
  ].join("\0");
  const known = resolved.get(key);
  if (known && Date.now() - known.at < RESOLVE_TTL_MS) {
    try {
      const info = await stat(known.path);
      if (info.isFile() && info.size === known.size && info.mtimeMs === known.mtimeMs)
        return known.path;
    } catch {
      /* moved or removed: scan again */
    }
    resolved.delete(key);
  }
  const running = resolving.get(key);
  if (running) return running;
  const scan = scanProvider(provider).then(async ({ path, name }) => {
    // Launchers whose identity depends on file or package content are not
    // remembered: a changed manifest must be noticed at once.
    if (!needsIdentityCheck(provider, name))
      try {
        const info = await stat(path);
        resolved.set(key, {
          at: Date.now(),
          path,
          size: info.size,
          mtimeMs: info.mtimeMs,
        });
      } catch {
        /* not remembered */
      }
    return path;
  });
  resolving.set(key, scan);
  const done = () => {
    if (resolving.get(key) === scan) resolving.delete(key);
  };
  scan.then(done, done);
  return scan;
}

async function scanProvider(provider: RemoteProvider): Promise<{ path: string; name: string }> {
  const windows = process.platform === "win32";
  const directories = providerDirectories(provider).filter(Boolean);
  const names = binaryNames[provider];
  // Antigravity prefers its ACP server anywhere over the agy CLI, like the desktop.
  const pairs =
    provider === "antigravity"
      ? names.flatMap((name) => directories.map((directory) => [directory, name] as const))
      : directories.flatMap((directory) => names.map((name) => [directory, name] as const));
  for (const [directory, name] of pairs) {
    for (const extension of windows ? [".exe", ".cmd", ".bat", ".com"] : [""]) {
      const candidate = join(directory.replace(/^"|"$/g, ""), name + extension);
      try {
        await access(candidate, windows ? constants.F_OK : constants.X_OK);
        if (!(await stat(candidate)).isFile()) continue;
        await providerLaunch(candidate, []);
        if (!(await matchesProvider(candidate, provider, name))) continue;
        return { path: candidate, name };
      } catch {
        /* try the next installed launcher */
      }
    }
  }
  throw new Error(
    `${provider} is not installed on this host or is missing from its PATH. Install its native CLI or standard npm package.`,
  );
}

/** A path inside `root` after resolving links, or undefined when it escapes. */
async function containedFile(root: string, path: string): Promise<string | undefined> {
  try {
    const realRoot = await realpath(root);
    const real = await realpath(path);
    const inside = relative(realRoot, real);
    if (!inside || inside.startsWith("..") || isAbsolute(inside)) return;
    return (await stat(real)).isFile() ? path : undefined;
  } catch {
    return;
  }
}

const SHIM_PATH = String.raw`"(?:%dp0%\\|%~dp0)([^"%]+)"`;
/** `"%_prog%" | "<bundled node.exe>"`, then the target and `%*`, as written by npm's cmd-shim. */
const SHIM_LAUNCH = new RegExp(String.raw`(?:("%_prog%")|${SHIM_PATH})?\s*${SHIM_PATH}\s+%\*`, "gi");

/** Read the target of an npm/installer `.cmd` shim instead of running it through cmd.exe.
 * Only targets inside the shim's directory are accepted; nested shims are not followed. */
async function npmShimLaunch(
  command: string,
  args: string[],
): Promise<{ command: string; args: string[] } | undefined> {
  const text = (await readFile(command, "utf8").catch(() => "")).slice(0, 64 * 1024);
  const match = [...text.matchAll(SHIM_LAUNCH)].at(-1);
  if (!match) return;
  const root = dirname(command);
  const local = (path: string) => resolve(root, path.replace(/\\/g, "/"));
  const entry = await containedFile(root, local(match[3]));
  if (!entry || /\.(cmd|bat)$/i.test(entry)) return;
  if (match[2]) {
    // Installer shims that ship their own node.exe next to the script.
    if (!/(^|[\\/])node\.exe$/i.test(match[2])) return;
    const node = await containedFile(root, local(match[2]));
    return node ? { command: node, args: [entry, ...args] } : undefined;
  }
  // "%_prog%" is node only when the shim selects node; other interpreters are unsupported.
  if (match[1] && !/SET\s+"_prog=(?:%dp0%\\node\.exe|node)"/i.test(text)) return;
  if (match[1] || /\.[cm]?js$/i.test(entry))
    return { command: process.execPath, args: [entry, ...args] };
  return /\.(exe|com)$/i.test(entry) ? { command: entry, args } : undefined;
}

/** npm's Windows .cmd wrappers cannot be spawned directly. Run their known
 * package entry point with the bundled Node, preserving argv without a shell.
 * Custom .cmd/.bat wrappers are deliberately not interpreted as shell text. */
export async function providerLaunch(
  command: string,
  args: string[],
  platform = process.platform,
): Promise<{ command: string; args: string[] }> {
  if (platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    const provider = basename(command, extname(command)).toLowerCase();
    if (provider === "pi" || provider === "pi-coding-agent") {
      // Read the exact supported package's bin metadata instead of executing or
      // interpreting an npm shell shim. Reject bin paths outside the package.
      for (const name of PI_PACKAGE_NAMES) {
        const root = join(dirname(command), "node_modules", name);
        try {
          const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
            name?: string;
            bin?: string | Record<string, string>;
          };
          if (pkg.name !== name) continue;
          const bin = typeof pkg.bin === "string" ? pkg.bin : (pkg.bin?.[provider] ?? pkg.bin?.pi);
          if (typeof bin !== "string") continue;
          const entry = resolve(root, bin);
          const contained = relative(root, entry);
          if (!contained || contained.startsWith("..") || isAbsolute(contained)) continue;
          const realRoot = await realpath(root);
          const realEntry = await realpath(entry);
          const realContained = relative(realRoot, realEntry);
          if (!realContained || realContained.startsWith("..") || isAbsolute(realContained))
            continue;
          if ((await stat(entry)).isFile())
            return { command: process.execPath, args: [entry, ...args] };
        } catch {
          /* try the other supported Pi package */
        }
      }
      throw new Error("Missing Pi npm entry point");
    }
    const npmEntry = npmEntries[provider];
    if (npmEntry) {
      const entry = join(dirname(command), npmEntry);
      if ((await stat(entry).catch(() => undefined))?.isFile())
        return { command: process.execPath, args: [entry, ...args] };
    }
    const shim = await npmShimLaunch(command, args);
    if (shim) return shim;
    throw new Error("Unsupported Windows provider launcher");
  }
  if (/\.(cjs|mjs|js)$/i.test(command))
    return { command: process.execPath, args: [command, ...args] };
  return { command, args };
}
