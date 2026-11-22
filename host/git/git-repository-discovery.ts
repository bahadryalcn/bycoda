import { lstat, opendir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { truncateCodeUnits } from "../../src/shared/lib/text/truncate";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
import { hostGitExec } from "./git-exec-pool";

const SKIP = [
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  ".pnpm",
  ".pnpm-store",
  ".yarn",
  ".cache",
  ".next",
  ".nuxt",
  ".output",
  ".turbo",
  ".expo",
  ".artifacts",
  ".local-data",
  ".venv",
  "venv",
  "__pycache__",
  "target",
  "dist",
  "build",
  "coverage",
  "temp",
];
/** The size bound that stopped a scan early; the repositories found before it stay valid. */
export type RepositoryDiscoveryLimit = "entries" | "directories" | "depth" | "repositories";
export type RepositoryDiscoveryLimits = Record<RepositoryDiscoveryLimit, number>;
export type RepositoryDiscovery = {
  repositories: string[];
  /** Size bound that left part of the tree unscanned, or null when the whole tree was scanned. */
  limit: RepositoryDiscoveryLimit | null;
};

const DEFAULT_LIMITS: RepositoryDiscoveryLimits = {
  entries: 200_000,
  directories: 10_000,
  depth: 64,
  repositories: 256,
};
const LIMIT_NAMES = new Set<unknown>(["entries", "directories", "depth", "repositories"]);

// Node identifies known junction/symlink tags only. Windows attributes are needed
// to skip every reparse point before enumerating a child directory.
const windowsScan = (limits: RepositoryDiscoveryLimits) => String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$root=$env:BYCODA_REPOSITORY_SCAN_ROOT
$skip=@(${SKIP.map((name) => `'${name}'`).join(",")})
$queue=[Collections.Generic.Queue[object]]::new()
$queue.Enqueue(@($root,0))
$result=[Collections.Generic.List[string]]::new()
$entries=0; $directories=0; $limit=$null
:scan while($queue.Count -gt 0) {
  $item=$queue.Dequeue(); $directory=[string]$item[0]; $depth=[int]$item[1]
  if(++$directories -gt ${limits.directories}) { $limit='directories'; break scan }
  $directory=[IO.Path]::GetFullPath($directory)
  $rootPath=[IO.Path]::GetFullPath($root)
  $prefix=$rootPath.TrimEnd([IO.Path]::DirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar
  if(-not $directory.Equals($rootPath,[StringComparison]::OrdinalIgnoreCase) -and -not $directory.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'Repository discovery directory changed' }
  # Recheck queued paths and every ancestor immediately before enumeration.
  # This narrows replacement races; it does not create an atomic filesystem snapshot.
  $ancestor=$directory
  while($ancestor) {
    $attributes=[IO.File]::GetAttributes($ancestor)
    if(($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or ($attributes -band [IO.FileAttributes]::Directory) -eq 0) { throw 'Repository discovery directory changed' }
    $next=[IO.Path]::GetDirectoryName($ancestor)
    if($next -eq $ancestor) { break }
    $ancestor=$next
  }
  foreach($entry in [IO.DirectoryInfo]::new($directory).EnumerateFileSystemInfos()) {
    if(++$entries -gt ${limits.entries}) { $limit='entries'; break scan }
    if($skip -contains $entry.Name) { continue }
    $attributes=$entry.Attributes
    if(($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
    if(($attributes -band [IO.FileAttributes]::Directory) -eq 0) { continue }
    if($depth -ge ${limits.depth}) { if($null -eq $limit) { $limit='depth' }; continue }
    $path=$entry.FullName
    foreach($marker in $entry.EnumerateFileSystemInfos('.git')) {
      if($marker.Name -ine '.git' -or ($marker.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
      if($result.Count -ge ${limits.repositories}) { $limit='repositories'; break scan }
      $result.Add($path)
    }
    $queue.Enqueue(@($path,($depth+1)))
  }
}
ConvertTo-Json -Compress -InputObject @{ repositories=@($result.ToArray()); limit=$limit }
`;

export type OffThreadCommand = {
  file: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};
type DiscoveryFailure = {
  phase: "spawn" | "exit" | "timeout" | "output-limit" | "parse";
  exitCode: number | null;
  spawnCode: string | null;
  signal: string | null;
  stderr: string;
};

export type OffThreadResult = { stdout: string } | { failure: DiscoveryFailure };

function sanitizeStderr(stderr: string, command: OffThreadCommand): string {
  const argumentLines = new Set(
    command.args.flatMap((arg) => arg.split(/\r?\n/).map((line) => line.trim())),
  );
  const lines = stripVTControlCharacters(stderr)
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/[\p{Cc}\p{Cf}]/gu, " ").trim())
    .filter((line) => line && !argumentLines.has(line) && !line.startsWith("Command failed:"));
  const diagnosticLines =
    command.file === "powershell.exe"
      ? lines.filter(
          (line) => !/^(?:At line:|\+|CategoryInfo\s*:|FullyQualifiedErrorId\s*:)/i.test(line),
        )
      : lines;
  return truncateCodeUnits(diagnosticLines.join("\n"), 500);
}

export function discoveryCommandError(
  tool: "powershell" | "git",
  failure: DiscoveryFailure,
): Error {
  const { phase, exitCode, spawnCode, signal, stderr } = failure;
  const detail = exitCode ?? spawnCode ?? signal;
  const reason =
    phase === "timeout" ? "Repository discovery timed out" : "Repository discovery failed";
  const firstLine = stderr.split("\n", 1)[0];
  const context = `${tool} ${phase}${detail === null ? "" : ` ${detail}`}`;
  return new Error(`${reason} (${context})${firstLine ? `: ${firstLine}` : ""}`, {
    cause: failure,
  });
}

/**
 * Runs commands in order through the shared pool. Queueing and execution spend the same batch
 * deadline, so a late command does not start with a new timeout budget.
 */
export async function execFilesOffThread(
  commands: OffThreadCommand[],
  timeout: number,
  maxBuffer = 8 * 1024 * 1024,
): Promise<OffThreadResult[]> {
  const startedAt = monotonicNow();
  const results: OffThreadResult[] = [];
  for (const command of commands) {
    const remaining = Math.floor(timeout - elapsedSince(startedAt));
    if (remaining <= 0) {
      results.push({
        failure: { phase: "timeout", exitCode: null, spawnCode: null, signal: null, stderr: "" },
      });
      continue;
    }
    const { file, args, cwd, env } = command;
    try {
      const { stdout } = await hostGitExec.exec(file, args, {
        lane: "background",
        // The budget measures the scan, not its wait behind other background scans (a project
        // with many worktrees queues one discovery per checkout at once).
        nativeTimeout: true,
        cwd,
        env,
        timeout: remaining,
        maxBuffer,
      });
      results.push({ stdout });
    } catch (error) {
      const { code, killed, signal, stderr } = error as {
        code?: string | number | null;
        killed?: boolean;
        signal?: string | null;
        stderr?: string;
      };
      const outputLimit = code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
      const timedOut = code === "ETIMEDOUT" || killed;
      const spawnCode = typeof code === "string" && !outputLimit && !timedOut ? code : null;
      results.push({
        failure: {
          phase: outputLimit ? "output-limit" : timedOut ? "timeout" : spawnCode ? "spawn" : "exit",
          exitCode: typeof code === "number" ? code : null,
          spawnCode,
          signal: signal ?? null,
          stderr: sanitizeStderr(stderr ?? "", command),
        },
      });
    }
  }
  return results;
}

export function readWindowsRepositoryScan(scan: OffThreadResult): RepositoryDiscovery {
  if ("failure" in scan) throw discoveryCommandError("powershell", scan.failure);
  const output = scan.stdout.trim();
  const cause: DiscoveryFailure = {
    phase: "parse",
    exitCode: 0,
    spawnCode: null,
    signal: null,
    stderr: "",
  };
  if (!output) throw new Error("Repository discovery returned no output", { cause });
  let found: { repositories?: unknown; limit?: unknown } | null;
  try {
    found = JSON.parse(output);
  } catch {
    throw new Error("Repository discovery returned malformed JSON", { cause });
  }
  const { repositories, limit = null } = found ?? {};
  if (
    !Array.isArray(repositories) ||
    repositories.some((path) => typeof path !== "string") ||
    (limit !== null && !LIMIT_NAMES.has(limit))
  )
    throw new Error("Repository discovery returned invalid paths", { cause });
  return { repositories, limit: limit as RepositoryDiscoveryLimit | null };
}

/**
 * Explicit repository discovery includes ignored source roots, never dependency caches or links.
 * A size bound ends the scan with the repositories found so far; a deadline or a directory that
 * changed under the scan still fails, because neither says anything about the remaining tree.
 */
export async function nestedRepositoryCandidates(
  root: string,
  remaining: () => number,
  override: Partial<RepositoryDiscoveryLimits> = {},
): Promise<RepositoryDiscovery> {
  const limits = { ...DEFAULT_LIMITS, ...override };
  if (process.platform === "win32") {
    const [scan] = await execFilesOffThread(
      [
        {
          file: "powershell.exe",
          args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", windowsScan(limits)],
          env: { BYCODA_REPOSITORY_SCAN_ROOT: root },
        },
      ],
      remaining(),
      1024 * 1024,
    );
    return readWindowsRepositoryScan(scan);
  }
  const skip = new Set(SKIP);
  const queue = [{ path: root, depth: 0 }];
  const repositories: string[] = [];
  let entries = 0;
  let limit: RepositoryDiscoveryLimit | null = null;
  for (let index = 0; index < queue.length; index++) {
    if (remaining() <= 0) throw new Error("Repository discovery timed out");
    if (index >= limits.directories) return { repositories, limit: "directories" };
    const directory = queue[index];
    const metadata = await lstat(directory.path);
    const physical = await realpath(directory.path);
    const contained = relative(root, physical);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      physical !== directory.path ||
      contained === ".." ||
      contained.startsWith(`..${sep}`) ||
      isAbsolute(contained)
    )
      throw new Error("Repository discovery directory changed");
    for await (const entry of await opendir(directory.path)) {
      if (remaining() <= 0) throw new Error("Repository discovery timed out");
      if (++entries > limits.entries) return { repositories, limit: "entries" };
      if (skip.has(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (directory.depth >= limits.depth) {
        limit ??= "depth";
        continue;
      }
      const path = join(directory.path, entry.name);
      const metadata = await lstat(path);
      if (!metadata.isDirectory() || metadata.isSymbolicLink() || (await realpath(path)) !== path)
        continue;
      const git = await lstat(join(path, ".git")).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (git && !git.isSymbolicLink() && (git.isFile() || git.isDirectory())) {
        if (repositories.length >= limits.repositories)
          return { repositories, limit: "repositories" };
        repositories.push(path);
      }
      queue.push({ path, depth: directory.depth + 1 });
    }
  }
  return { repositories, limit };
}
