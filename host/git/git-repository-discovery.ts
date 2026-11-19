import { lstat, opendir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { execFileAsync } from "../../src/shared/lib/processExecution.node";

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
  foreach($path in [IO.Directory]::EnumerateFileSystemEntries($directory)) {
    if(++$entries -gt ${limits.entries}) { $limit='entries'; break scan }
    $name=[IO.Path]::GetFileName($path)
    if($skip -contains $name) { continue }
    $attributes=[IO.File]::GetAttributes($path)
    if(($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
    if(($attributes -band [IO.FileAttributes]::Directory) -eq 0) { continue }
    if($depth -ge ${limits.depth}) { if($null -eq $limit) { $limit='depth' }; continue }
    $git=[IO.Path]::Combine($path,'.git')
    $gitAttributes=$null
    try { $gitAttributes=[IO.File]::GetAttributes($git) }
    catch [IO.FileNotFoundException] { }
    catch [IO.DirectoryNotFoundException] { }
    if($null -ne $gitAttributes) {
      if(($gitAttributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) {
        if($result.Count -ge ${limits.repositories}) { $limit='repositories'; break scan }
        $result.Add($path)
      }
    }
    $queue.Enqueue(@($path,($depth+1)))
  }
}
ConvertTo-Json -Compress -InputObject @{ repositories=@($result.ToArray()); limit=$limit }
`;

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
    const timeout = remaining();
    if (timeout <= 0) throw new Error("Repository discovery timed out");
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", windowsScan(limits)],
      {
        windowsHide: true,
        timeout,
        maxBuffer: 1024 * 1024,
        encoding: "utf8",
        env: { ...process.env, BYCODA_REPOSITORY_SCAN_ROOT: root },
      },
    );
    const found: { repositories?: unknown; limit?: unknown } | null = JSON.parse(stdout.trim());
    const { repositories, limit = null } = found ?? {};
    if (
      !Array.isArray(repositories) ||
      repositories.some((path) => typeof path !== "string") ||
      (limit !== null && !LIMIT_NAMES.has(limit))
    )
      throw new Error("Repository discovery returned invalid paths");
    return { repositories, limit: limit as RepositoryDiscoveryLimit | null };
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
