import { lstat, opendir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { execFileAsync } from "../../src/shared/lib/processExecution.node";

const SKIP = [
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  ".pnpm",
  ".yarn",
  ".cache",
  ".next",
  ".nuxt",
  ".output",
  ".turbo",
  ".expo",
  "target",
  "dist",
  "build",
  "coverage",
  "temp",
];
const MAX_ENTRIES = 200_000;
const MAX_DIRECTORIES = 10_000;
const MAX_DEPTH = 64;
const MAX_REPOSITORIES = 256;

// Node identifies known junction/symlink tags only. Windows attributes are needed
// to skip every reparse point before enumerating a child directory.
const WINDOWS_SCAN = String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$root=$env:BYCODA_REPOSITORY_SCAN_ROOT
$skip=@(${SKIP.map((name) => `'${name}'`).join(",")})
$queue=[Collections.Generic.Queue[object]]::new()
$queue.Enqueue(@($root,0))
$result=[Collections.Generic.List[string]]::new()
$entries=0; $directories=0
while($queue.Count -gt 0) {
  $item=$queue.Dequeue(); $directory=[string]$item[0]; $depth=[int]$item[1]
  if(++$directories -gt ${MAX_DIRECTORIES}) { throw 'Repository discovery directory limit exceeded' }
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
    if(++$entries -gt ${MAX_ENTRIES}) { throw 'Repository discovery entry limit exceeded' }
    $name=[IO.Path]::GetFileName($path)
    if($skip -contains $name) { continue }
    $attributes=[IO.File]::GetAttributes($path)
    if(($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
    if(($attributes -band [IO.FileAttributes]::Directory) -eq 0) { continue }
    if($depth -ge ${MAX_DEPTH}) { throw 'Repository discovery depth limit exceeded' }
    $git=[IO.Path]::Combine($path,'.git')
    $gitAttributes=$null
    try { $gitAttributes=[IO.File]::GetAttributes($git) }
    catch [IO.FileNotFoundException] { }
    catch [IO.DirectoryNotFoundException] { }
    if($null -ne $gitAttributes) {
      if(($gitAttributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) {
        if($result.Count -ge ${MAX_REPOSITORIES}) { throw 'Too many nested repositories' }
        $result.Add($path)
      }
    }
    $queue.Enqueue(@($path,($depth+1)))
  }
}
ConvertTo-Json -Compress -InputObject @($result.ToArray())
`;

/** Explicit repository discovery includes ignored source roots, never dependency caches or links. */
export async function nestedRepositoryCandidates(
  root: string,
  remaining: () => number,
): Promise<string[]> {
  if (process.platform === "win32") {
    const timeout = remaining();
    if (timeout <= 0) throw new Error("Repository discovery timed out");
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_SCAN],
      {
        windowsHide: true,
        timeout,
        maxBuffer: 1024 * 1024,
        encoding: "utf8",
        env: { ...process.env, BYCODA_REPOSITORY_SCAN_ROOT: root },
      },
    );
    const candidates: unknown = JSON.parse(stdout.trim());
    if (!Array.isArray(candidates) || candidates.some((path) => typeof path !== "string"))
      throw new Error("Repository discovery returned invalid paths");
    return candidates;
  }
  const skip = new Set(SKIP);
  const queue = [{ path: root, depth: 0 }];
  const repositories: string[] = [];
  let entries = 0;
  for (let index = 0; index < queue.length; index++) {
    if (remaining() <= 0) throw new Error("Repository discovery timed out");
    if (index >= MAX_DIRECTORIES) throw new Error("Repository discovery directory limit exceeded");
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
      if (++entries > MAX_ENTRIES) throw new Error("Repository discovery entry limit exceeded");
      if (skip.has(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (directory.depth >= MAX_DEPTH)
        throw new Error("Repository discovery depth limit exceeded");
      const path = join(directory.path, entry.name);
      const metadata = await lstat(path);
      if (!metadata.isDirectory() || metadata.isSymbolicLink() || (await realpath(path)) !== path)
        continue;
      const git = await lstat(join(path, ".git")).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (git && !git.isSymbolicLink() && (git.isFile() || git.isDirectory())) {
        if (repositories.length >= MAX_REPOSITORIES)
          throw new Error("Too many nested repositories");
        repositories.push(path);
      }
      queue.push({ path, depth: directory.depth + 1 });
    }
  }
  return repositories;
}
