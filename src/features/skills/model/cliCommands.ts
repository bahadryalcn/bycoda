import type { NativeCommand } from "../../../integrations/harness/core/nativeCommands";
import type { ReportedCommand } from "../../../integrations/harness/core/reportedCommands";
import type { HarnessId } from "../../sessions/model/session";
import type { NativeSkill, Skill } from "./skills";

/**
 * Commands that belong to Claude Code or Codex itself and run inside the CLI.
 * They are merged from three places: what the running session reports (most
 * accurate, but only known after the first turn), what is on disk, and a short
 * table of built-ins. Everything here is a name, a description and a hint.
 */

/** A custom command found on disk (`.claude/commands/**.md`). */
export type DiskCommand = {
  name: string;
  description: string;
  argumentHint: string;
  scope: "project" | "user" | "plugin";
};

const SLASH_HARNESSES: readonly HarnessId[] = ["claude"];

/**
 * Built-ins that run over Claude Code's stream-json transport: the CLI marks
 * them `supportsNonInteractive` (or they are prompt commands). Terminal-only
 * ones (/clear, /vim, /login, ...) and ones Bycoda has its own UI for
 * (/compact, /model, /mcp) are left out on purpose. Codex commands here are
 * implemented through app-server RPC rather than passed to its terminal UI.
 */
const CURATED: Partial<Record<HarnessId, NativeCommand[]>> = {
  codex: [
    {
      name: "goal",
      invocation: "goal",
      description: "Set a persistent Codex goal, show its progress, pause or clear it",
      inputHint: "[<objective> | status | pause | resume | clear]",
      source: "codex",
      origin: "built-in",
    },
  ],
  claude: [
    {
      name: "goal",
      description: "Set a goal Claude checks before stopping",
      inputHint: "[<condition> | clear]",
    },
    {
      name: "init",
      description: "Initialize a new CLAUDE.md file with codebase documentation",
    },
    {
      name: "security-review",
      description: "Complete a security review of the pending changes on the current branch",
    },
    {
      name: "context",
      description: "Show current context usage",
      inputHint: "[all]",
    },
    {
      name: "usage",
      description: "Show session cost and plan usage",
      aliases: ["cost", "stats"],
    },
  ].map((command) => ({
    ...command,
    invocation: command.name,
    source: "claude" as const,
    origin: "built-in",
  })),
};

/** Reported by the CLI but terminal-only, or covered by Bycoda's own UI. */
const NOT_FOR_COMPOSER = new Set([
  "clear",
  "exit",
  "help",
  "login",
  "logout",
  "model",
  "resume",
  "terminal-setup",
  "theme",
  "vim",
]);

export function usesSlashCommands(harness: HarnessId): boolean {
  return SLASH_HARNESSES.includes(harness);
}

/** Codex invokes skills as `$name`; Claude Code uses `/name` for them. */
export function usesDollarSkills(harness: HarnessId): boolean {
  return harness === "codex";
}

export function mergeCliCommands(input: {
  harness: HarnessId;
  reported: readonly ReportedCommand[];
  disk: readonly DiskCommand[];
  /** Names that already mean something else (Bycoda commands, file skills). */
  taken: ReadonlySet<string>;
}): NativeSkill[] {
  const { harness, reported, disk, taken } = input;
  if (harness === "codex") {
    return (CURATED.codex ?? [])
      .filter((command) => !taken.has(command.name))
      .map((command) => ({ ...command, kind: "native" as const }));
  }
  if (!usesSlashCommands(harness)) return [];
  const out = new Map<string, NativeCommand>();
  const add = (command: NativeCommand) => {
    const name = command.name;
    if (!name || taken.has(name) || NOT_FOR_COMPOSER.has(name)) return;
    const known = out.get(name);
    if (!known) {
      out.set(name, command);
      return;
    }
    out.set(name, {
      ...known,
      description: known.description || command.description,
      inputHint: known.inputHint || command.inputHint,
    });
  };

  const live = new Set<string>();
  for (const item of reported) live.add(item.name.replace(/^\//, ""));

  // Disk first: it carries the richest text and the best label.
  for (const command of disk) {
    add({
      name: command.name,
      description: command.description,
      invocation: command.name,
      source: harness,
      origin: command.scope === "plugin" ? "plugin" : `${command.scope} command`,
      ...(command.argumentHint ? { inputHint: command.argumentHint } : {}),
    });
  }
  for (const command of CURATED[harness] ?? []) {
    // A session that lists its commands is authoritative about the built-ins.
    const listed = [command.name, ...(command.aliases ?? [])].some((name) => live.has(name));
    if (live.size === 0 || listed) add(command);
  }
  for (const item of reported) {
    const name = item.name.replace(/^\//, "");
    add({
      name,
      description: item.description ?? "",
      invocation: name,
      source: harness,
      origin: item.kind === "skill" ? "skill" : "session",
    });
  }
  return [...out.values()].map((command) => ({
    ...command,
    kind: "native" as const,
  }));
}

/** Skills Codex lists for `$`: its own report first, then skills on disk. */
export function mergeDollarSkills(input: {
  harness: HarnessId;
  reported: readonly ReportedCommand[];
  files: readonly Skill[];
  disabledPaths?: readonly string[];
}): Skill[] {
  if (!usesDollarSkills(input.harness)) return [];
  const out = new Map<string, Skill>();
  const disabled = new Set(input.disabledPaths ?? []);
  for (const item of input.reported) {
    if (item.kind !== "skill" || out.has(item.name) || (item.path && disabled.has(item.path)))
      continue;
    out.set(item.name, {
      kind: "native",
      name: item.name,
      description: item.description ?? "",
      invocation: item.name,
      source: input.harness,
      origin: "skill",
    });
  }
  for (const skill of input.files) {
    if (skill.kind !== "file" && skill.kind !== "builtin") continue;
    if (skill.kind === "file" && disabled.has(skill.path)) continue;
    // Preserve the disk path and Bycoda's precedence; prompt preparation
    // injects these files even when they belong to another provider.
    const reported = out.get(skill.name);
    out.set(
      skill.name,
      reported?.description && !skill.description
        ? { ...skill, description: reported.description }
        : skill,
    );
  }
  return [...out.values()];
}

/**
 * Leading `/name` that Claude Code itself should receive untouched. Filled as
 * catalogs load; the curated names are always known.
 */
const rawNames = new Map<HarnessId, Set<string>>();

export function registerCliCommands(harness: HarnessId, commands: readonly NativeCommand[]): void {
  const set = rawNames.get(harness) ?? new Set<string>();
  for (const command of commands) {
    set.add(command.name);
    for (const alias of command.aliases ?? []) set.add(alias);
  }
  rawNames.set(harness, set);
}

export function isCliCommandText(text: string, harness: HarnessId): boolean {
  if (harness === "codex") return /^\s*\/goal(?=\s|$)/.test(text);
  if (!usesSlashCommands(harness)) return false;
  const name = /^\s*\/([^\s/\\]+)(?=\s|$)/.exec(text)?.[1];
  if (!name) return false;
  if (rawNames.get(harness)?.has(name)) return true;
  return (CURATED[harness] ?? []).some(
    (command) => command.name === name || command.aliases?.includes(name),
  );
}
