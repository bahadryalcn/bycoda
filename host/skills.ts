import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { DiscoveredSkill } from "../src/platform/tauri/fs";
import { skillInvocationFlags } from "../src/integrations/harness/core/skillPolicy";

/**
 * The file skills on this machine for a project, found the way the desktop
 * app finds them on its own computer (src-tauri skills.rs): `.agents/skills`
 * first, then each harness's folder, project before personal; same name,
 * earlier wins.
 */
const MAX_SKILLS = 300;
const MAX_CANDIDATES = 1000;
const MAX_FRONTMATTER_BYTES = 16 * 1024;

/** Migration only: recover the declared name rather than assuming its folder name. */
export function skillNameForPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const fallback = normalized.split("/").at(-2) ?? "";
  if (!/\/skill\.md$/i.test(normalized)) return fallback;
  try {
    return parseFrontmatter(readPrefix(path, MAX_FRONTMATTER_BYTES), fallback).name;
  } catch {
    return fallback;
  }
}

const HARNESS_DIRS: [string, string][] = [
  [".claude/skills", "claude"],
  [".cursor/skills", "cursor"],
  [".codex/skills", "codex"],
  [".opencode/skills", "opencode"],
  [".pi/skills", "pi"],
  [".omp/skills", "omp"],
  [".fx/skills", "fx"],
  [".grok/skills", "grok"],
  [".hermes/skills", "hermes"],
];

const isDir = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};
const isFile = (path: string) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

export function listHostSkills(
  project: string | null,
  home = homedir(),
  disabledPaths: string[] = [],
): DiscoveredSkill[] {
  const byName = new Map<string, DiscoveredSkill>();
  const disabled = new Set(disabledPaths.map((path) => canonical(path)).filter(Boolean));
  for (const skill of listSkillRootsInOrder(project, home)) {
    if (byName.size >= MAX_SKILLS) break;
    if (disabled.has(canonical(skill.path))) continue;
    if (!byName.has(skill.name)) byName.set(skill.name, skill);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type HostSkillCandidate = DiscoveredSkill & { active: boolean };

/**
 * Every installed copy, including same-name skills that `listHostSkills`
 * shadows, so an agent can compare alternatives instead of the first match.
 * `active` marks the copy that `/name` resolves to.
 */
export function listHostSkillCandidates(
  project: string | null,
  home = homedir(),
): { skills: HostSkillCandidate[]; truncated: boolean } {
  const names = new Set<string>();
  const skills: HostSkillCandidate[] = [];
  let truncated = false;
  for (const skill of listSkillRootsInOrder(project, home)) {
    if (skills.length >= MAX_CANDIDATES) {
      truncated = true;
      break;
    }
    // Same rule as listHostSkills: first copy of a name wins within its cap.
    const active = !names.has(skill.name) && names.size < MAX_SKILLS;
    if (active) names.add(skill.name);
    skills.push({ ...skill, active });
  }
  return { skills, truncated };
}

/** Highest priority first; the same real root is scanned once. */
function* listSkillRootsInOrder(project: string | null, home: string) {
  const seen = new Set<string>();
  function* add(root: string, scope: string, source: string, namespace?: string) {
    let key = root;
    try {
      key = realpathSync(root);
    } catch {
      /* missing root: nothing to scan */
    }
    if (seen.has(key)) return;
    seen.add(key);
    for (const skill of scanRoot(root, scope, source))
      yield namespace ? { ...skill, name: `${namespace}:${skill.name}` } : skill;
  }

  if (project) yield* add(join(project, ".agents/skills"), "project", "agents");
  yield* add(join(home, ".agents/skills"), "user", "agents");
  for (const [dir, source] of HARNESS_DIRS) {
    if (project) yield* add(join(project, dir), "project", source);
    yield* add(join(home, dir), "user", source);
  }
  yield* add(join(home, ".pi/agent/skills"), "user", "pi");
  yield* add(join(home, ".omp/agent/skills"), "user", "omp");
  yield* add(join(home, ".codex/skills/.system"), "user", "codex");
  const antigravity = join(home, ".gemini/antigravity/skills");
  if (isDir(antigravity)) yield* add(antigravity, "user", "antigravity");
  for (const plugin of claudePluginRoots(home, project)) {
    yield* add(plugin.root, plugin.scope, "claude", plugin.namespace);
  }
}

function scanRoot(root: string, scope: string, source: string): DiscoveredSkill[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const out: DiscoveredSkill[] = [];
  for (const folder of entries) {
    if (folder.startsWith(".") || folder === "skills-cursor") continue;
    const dir = join(root, folder);
    if (!isDir(dir)) continue;
    const file = [join(dir, "SKILL.md"), join(dir, "skill.md")].find(isFile);
    if (!file) continue;
    const fallback = slugName(folder);
    if (!fallback) continue;
    let text: string;
    try {
      text = readPrefix(file, MAX_FRONTMATTER_BYTES);
    } catch {
      continue;
    }
    const { name, description } = parseFrontmatter(text, fallback);
    if (!name) continue;
    out.push({
      ...skillInvocationFlags(text),
      name,
      description,
      path: file.replace(/\\/g, "/"),
      scope,
      source,
    } as DiscoveredSkill);
  }
  return out;
}

function readPrefix(path: string, max: number): string {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(max);
    const read = readSync(fd, buffer, 0, max, 0);
    return buffer.subarray(0, read).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

export function parseFrontmatter(
  text: string,
  fallback: string,
): { name: string; description: string } {
  const trimmed = text.replace(/^﻿/, "");
  if (!trimmed.startsWith("---")) return { name: fallback, description: "" };
  let rest = trimmed.slice(3).replace(/^\r?\n/, "");
  const end = rest.indexOf("\n---");
  if (end >= 0) rest = rest.slice(0, end);
  let name: string | undefined;
  let description = "";
  let inDescription = false;
  let folded = false;
  for (const raw of rest.split("\n")) {
    if (inDescription) {
      if (/^[ \t]/.test(raw)) {
        const piece = raw.trim();
        if (!piece) continue;
        if (description) description += folded ? " " : "\n";
        description += piece;
        continue;
      }
      inDescription = false;
    }
    const line = raw.trimEnd().trimStart();
    if (line.startsWith("name:")) name = unquote(line.slice(5));
    else if (line.startsWith("description:")) {
      const value = line.slice(12).trim();
      if (value.startsWith(">") || value.startsWith("|")) {
        inDescription = true;
        folded = value.startsWith(">");
        description = "";
      } else description = unquote(value);
    }
  }
  return {
    name: name && validName(name) ? name : fallback,
    description: description.trim(),
  };
}

const unquote = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
    ? trimmed.slice(1, -1)
    : trimmed;
};

const validName = (name: string) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) && name.length <= 64;

export function slugName(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
  return slug;
}

/** Skill folders of enabled Claude Code plugins, project ones first. */
export function claudePluginRoots(
  home: string,
  project: string | null,
): { root: string; scope: string; namespace: string }[] {
  let registry: unknown;
  try {
    registry = JSON.parse(
      readFileSync(join(home, ".claude/plugins/installed_plugins.json"), "utf8"),
    );
  } catch {
    return [];
  }
  const plugins = (registry as { plugins?: Record<string, unknown> })?.plugins;
  if (!plugins || typeof plugins !== "object") return [];
  const settings = [
    ...(project
      ? [join(project, ".claude/settings.local.json"), join(project, ".claude/settings.json")]
      : []),
    join(home, ".claude/settings.json"),
  ];
  const enabled = (id: string) => {
    for (const path of settings) {
      try {
        const value = JSON.parse(readFileSync(path, "utf8"))?.enabledPlugins?.[id];
        if (typeof value === "boolean") return value;
      } catch {
        /* no such settings file */
      }
    }
    return true;
  };
  const resolveHome = (raw: string) =>
    raw === "~"
      ? home
      : raw.startsWith("~/")
        ? join(home, raw.slice(2))
        : isAbsolute(raw)
          ? raw
          : join(home, raw);
  const roots: { root: string; scope: string; namespace: string }[] = [];
  for (const [id, installed] of Object.entries(plugins)) {
    if (!enabled(id)) continue;
    const namespace = id.includes("@") ? id.slice(0, id.lastIndexOf("@")) : id;
    if (!validName(namespace)) continue;
    const entries = Array.isArray(installed)
      ? installed
      : installed && typeof installed === "object"
        ? [installed]
        : [];
    for (const entry of entries as Record<string, unknown>[]) {
      if (typeof entry?.installPath !== "string") continue;
      const scopeValue = entry.scope;
      let scope = "user";
      if (scopeValue === "project" || scopeValue === "local") {
        if (!project || typeof entry.projectPath !== "string") continue;
        const owner = resolve(resolveHome(entry.projectPath));
        const inside = resolve(project);
        const child = relative(owner, inside);
        if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) continue;
        scope = "project";
      } else if (scopeValue !== undefined && scopeValue !== "user") continue;
      roots.push({ root: join(resolveHome(entry.installPath), "skills"), scope, namespace });
    }
  }
  return roots.sort((a, b) => (a.scope === "project" ? 0 : 1) - (b.scope === "project" ? 0 : 1));
}

// ---- Copying a skill between machines -------------------------------------
// `skill_export` / `skill_import`: same names, arguments and results as the
// desktop's Tauri commands (src-tauri skills.rs).

const MAX_TRANSFER_FILES = 200;
const MAX_TRANSFER_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TRANSFER_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_TRANSFER_PATH_LEN = 240;
const MAX_TRANSFER_DEPTH = 16;
const WINDOWS_DEVICE_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

export type SkillFile = { path: string; data: string };
export type SkillBundle = { name: string; files: SkillFile[] };

const tooLargeFile = (path: string) =>
  `${path} is larger than 2 MiB, which is the most one file can be when copying a skill.`;
const TOO_LARGE_TOTAL =
  "This skill is more than 8 MiB in total, which is the most that can be copied.";
const TOO_MANY_FILES = `This skill has more than ${MAX_TRANSFER_FILES} files, which is the most that can be copied.`;

/** A relative, `/`-separated path that stays inside the skill folder on every
 * platform (the same rules as the desktop). */
function validateTransferPath(path: string): void {
  const bad = (why: string): never => {
    throw new Error(`Cannot copy file "${path}": ${why}.`);
  };
  if (!path || path.length > MAX_TRANSFER_PATH_LEN) bad("its path is empty or too long");
  if (path.startsWith("/")) bad("its path is not relative");
  for (const segment of path.split("/")) {
    if (!segment || segment === "." || segment === "..")
      bad('its path has an empty, "." or ".." part');
    if (Buffer.byteLength(segment) > 255) bad("a name in its path is too long");
    if (/[\u0000-\u001f\u007f-\u009f\\:*?"<>|]/.test(segment))
      bad("its name has a character that is not allowed");
    if (segment.endsWith(".") || segment.endsWith(" "))
      bad("a name in its path ends with a dot or space");
    if (WINDOWS_DEVICE_NAMES.has(segment.split(".")[0].toUpperCase()))
      bad("its name is reserved on Windows");
  }
}

const canonical = (path: string): string | undefined => {
  try {
    const real = realpathSync.native(path).replace(/\\/g, "/");
    return process.platform === "win32" ? real.replace(/^\/\/\?\//, "").toLowerCase() : real;
  } catch {
    return undefined;
  }
};

/** Only the exact listed folder may be deleted; never follow a skill link. */
export function deleteHostSkill(path: unknown, project: string | null, home = homedir()): void {
  if (typeof path !== "string" || !path || path.length > 4096 || path.includes("\0"))
    throw new Error("Invalid skill path");
  const normalize = (value: string) => {
    const normalized = resolve(value).replace(/\\/g, "/");
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  };
  const listed = listHostSkills(project, home).find(
    (skill) => normalize(skill.path) === normalize(path),
  );
  if (!listed) throw new Error("That skill is not one of the skills found on this machine.");
  if (
    listed.name.includes(":") ||
    /\/(?:\.system|plugins)\//i.test(listed.path.replace(/\\/g, "/"))
  )
    throw new Error(
      "System and plugin skills are managed by their provider and cannot be deleted here.",
    );
  const dir = dirname(listed.path);
  const root = dirname(dir);
  const folderName = process.platform === "win32" ? basename(dir).toLowerCase() : basename(dir);
  // A linked skills root can also redirect deletion into another provider's files.
  // Links above the project or home folder (such as macOS's /var) are the
  // system's own layout and do not redirect a skill.
  const boundary = [project, home]
    .filter((value): value is string => !!value)
    .map(normalize)
    .find((base) => normalize(dir).startsWith(`${base}/`));
  for (let ancestor = dir; ; ancestor = dirname(ancestor)) {
    if (boundary && normalize(ancestor) === boundary) break;
    if (lstatSync(ancestor).isSymbolicLink())
      throw new Error("Linked skill folders cannot be deleted here.");
    if (dirname(ancestor) === ancestor) break;
  }
  if (
    lstatSync(dir).isSymbolicLink() ||
    lstatSync(listed.path).isSymbolicLink() ||
    canonical(dir) !== canonical(root) + "/" + folderName
  )
    throw new Error("Linked skill folders cannot be deleted here.");
  rmSync(dir, { recursive: true });
}

/** Every regular file of one listed skill's folder. Only folders that
 * `listHostSkills` itself returns for this project can be read. */
export function exportHostSkill(
  path: unknown,
  project: string | null,
  home = homedir(),
): SkillBundle {
  if (typeof path !== "string" || !path || path.length > 4096 || path.includes("\0"))
    throw new Error("Invalid skill path");
  const wanted = canonical(path);
  const listed =
    wanted !== undefined
      ? listHostSkills(project, home).find((skill) => canonical(skill.path) === wanted)
      : undefined;
  if (!listed) throw new Error("That skill is not one of the skills found on this machine.");
  if (!validName(listed.name))
    throw new Error(`${listed.name} cannot be copied: plugin skills are managed by their plugin.`);
  // Resolve first so a skill folder that is itself a link is read in place.
  const dir = dirname(realpathSync.native(path));
  const files: SkillFile[] = [];
  let total = 0;
  const walk = (folder: string, rel: string, depth: number) => {
    if (depth > MAX_TRANSFER_DEPTH)
      throw new Error(`This skill has folders nested deeper than ${MAX_TRANSFER_DEPTH} levels.`);
    for (const name of readdirSync(folder).sort()) {
      if (name === ".DS_Store") continue;
      const full = join(folder, name);
      const info = lstatSync(full);
      // Links could lead out of the skill folder; they are not copied.
      if (info.isSymbolicLink()) continue;
      const relPath = rel ? `${rel}/${name}` : name;
      if (info.isDirectory()) walk(full, relPath, depth + 1);
      else if (info.isFile()) {
        validateTransferPath(relPath);
        if (files.length >= MAX_TRANSFER_FILES) throw new Error(TOO_MANY_FILES);
        if (info.size > MAX_TRANSFER_FILE_BYTES) throw new Error(tooLargeFile(relPath));
        const bytes = readFileSync(full);
        if (bytes.length > MAX_TRANSFER_FILE_BYTES) throw new Error(tooLargeFile(relPath));
        total += bytes.length;
        if (total > MAX_TRANSFER_TOTAL_BYTES) throw new Error(TOO_LARGE_TOTAL);
        files.push({ path: relPath, data: bytes.toString("base64") });
      }
    }
  };
  walk(dir, "", 0);
  return { name: listed.name, files };
}

const exists = (path: string) => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

/** Writes a skill to `<home>/.agents/skills/<name>` and returns its SKILL.md
 * path. Fails with a `SKILL_EXISTS:` message when it is already there, unless
 * `overwrite`. File modes are not preserved: scripts arrive non-executable. */
export function importHostSkill(input: unknown, home = homedir()): string {
  const { name, files, overwrite } = (input && typeof input === "object" ? input : {}) as {
    name?: unknown;
    files?: unknown;
    overwrite?: unknown;
  };
  if (typeof name !== "string" || !validName(name))
    throw new Error(
      "Use a lowercase name with letters, numbers, and single hyphens (at most 64 characters).",
    );
  if (!Array.isArray(files)) throw new Error("A skill needs a list of files.");
  if (files.length > MAX_TRANSFER_FILES) throw new Error(TOO_MANY_FILES);
  const decoded: { path: string; bytes: Buffer }[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const file of files as Partial<SkillFile>[]) {
    if (!file || typeof file.path !== "string" || typeof file.data !== "string")
      throw new Error("Each file needs a path and data.");
    validateTransferPath(file.path);
    if (seen.has(file.path.toLowerCase()))
      throw new Error(`The file "${file.path}" appears twice.`);
    seen.add(file.path.toLowerCase());
    if (file.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data))
      throw new Error(`The file "${file.path}" is not valid data.`);
    const bytes = Buffer.from(file.data, "base64");
    if (bytes.length > MAX_TRANSFER_FILE_BYTES) throw new Error(tooLargeFile(file.path));
    total += bytes.length;
    if (total > MAX_TRANSFER_TOTAL_BYTES) throw new Error(TOO_LARGE_TOTAL);
    decoded.push({ path: file.path, bytes });
  }
  const main = ["SKILL.md", "skill.md"].find((candidate) =>
    decoded.some((file) => file.path === candidate),
  );
  if (!main) throw new Error("A skill needs a SKILL.md file at its top level.");

  const root = join(home, ".agents/skills");
  mkdirSync(root, { recursive: true });
  const dest = join(root, name);
  const replacing = exists(dest);
  if (replacing && overwrite !== true)
    throw new Error(`SKILL_EXISTS: A skill named ${name} already exists.`);

  // Dot-prefixed siblings are never listed as skills.
  const tag = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const staging = join(root, `.${name}.import-${tag}`);
  try {
    mkdirSync(staging);
    for (const file of decoded) {
      const target = join(staging, ...file.path.split("/"));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.bytes);
    }
  } catch (reason) {
    rmSync(staging, { recursive: true, force: true });
    throw reason;
  }

  if (replacing) {
    const old = join(root, `.${name}.old-${tag}`);
    try {
      renameSync(dest, old);
    } catch (reason) {
      rmSync(staging, { recursive: true, force: true });
      throw reason;
    }
    try {
      renameSync(staging, dest);
    } catch (reason) {
      try {
        renameSync(old, dest);
      } catch {
        /* nothing more to restore */
      }
      rmSync(staging, { recursive: true, force: true });
      throw reason;
    }
    rmSync(old, { recursive: true, force: true });
  } else {
    try {
      renameSync(staging, dest);
    } catch (reason) {
      rmSync(staging, { recursive: true, force: true });
      if (exists(dest)) throw new Error(`SKILL_EXISTS: A skill named ${name} already exists.`);
      throw reason;
    }
  }
  return join(dest, main).replace(/\\/g, "/");
}
