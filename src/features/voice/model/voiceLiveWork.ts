import { stripAnsi } from "../../../shared/lib/ansi";
import { currentExecutionTools, inspectCommand } from "../../sessions/public/commandInspection";
import type { Session } from "../../sessions/public/session";
import type { VoiceToolActivityEntry } from "./voiceToolActivity";

export type VoiceLiveResultStatus = "done" | "failed" | "interrupted";
export type VoiceLiveAction = { id: string; name: string; status: VoiceLiveResultStatus };

/** Enums, counts and allowlisted tool names only: never command, output, path or argument text. */
export type VoiceLiveResult =
  | {
      kind: "tests";
      status: VoiceLiveResultStatus;
      passed: number;
      failed: number;
      skipped: number;
    }
  | { kind: "build" | "checks"; status: VoiceLiveResultStatus }
  | { kind: "changes"; status: "done"; files: number; additions: number; deletions: number }
  | { kind: "commands"; status: "failed"; count: number }
  | { kind: "actions"; status: VoiceLiveResultStatus; actions: VoiceLiveAction[] };

type CommandKind = "tests" | "build" | "checks";

const MAX_PARSED_OUTPUT = 64_000;
const MAX_ACTIONS = 8;
const packageRunner = "(?:pnpm|npm|yarn|bun)(?: run| exec)?";
const commandPatterns: readonly (readonly [CommandKind, RegExp])[] = [
  [
    "tests",
    new RegExp(
      `^(?:${packageRunner} (?:[\\w:-]*test[\\w:-]*|vitest|jest|playwright)|npx (?:vitest|jest|playwright)|vitest|jest|pytest|python -m pytest|cargo (?:nextest|test)|go test)(?:\\s|$)`,
    ),
  ],
  [
    "build",
    new RegExp(`^(?:${packageRunner} [\\w:-]*build[\\w:-]*|cargo build|go build)(?:\\s|$)`),
  ],
  [
    "checks",
    new RegExp(
      `^(?:${packageRunner} (?:check|lint|typecheck)[\\w:-]*|tsc(?:-rs)?|eslint|oxlint|cargo (?:check|clippy)|ruff|mypy)(?:\\s|$)`,
    ),
  ],
];
const commandPrefix = /^(?:[A-Za-z_]\w*=\S*\s+)*(?:rtk\s+)?(?:bykit\s+run\s+--\s+)?/;
const gitChange = /^git\s+(?:diff|commit)(?:\s|$)/;
const diffSummary =
  /^\s*(\d{1,9}) files? changed(?:, (\d{1,9}) insertions?\(\+\))?(?:, (\d{1,9}) deletions?\(-\))?\s*$/;
const testSummary = /^\s*(?:tests?:?\s+\d|=*\s*\d{1,9} (?:passed|failed)\b.* in [\d.]+m?s)/i;
const cargoSummary = /^\s*test result:/i;
const testCount = /(\d{1,9}) (passed|failed|skipped|ignored)\b/g;
const resultActions = new Set([
  "notes.create",
  "notes.update",
  "tasks.create",
  "tasks.update",
  "workspace.projects.create",
  "workspace.projects.select",
  "workspace.sessions.create",
  "workspace.sessions.open",
  "workspace.views.open",
]);
const actionStatus = { returned: "done", failed: "failed", uncertain: "interrupted" } as const;

function outputLines(error: string | undefined, output: string) {
  return stripAnsi([error, output].filter(Boolean).join("\n"))
    .slice(-MAX_PARSED_OUTPUT)
    .split(/\r?\n/);
}

function parseTestCounts(lines: readonly string[]) {
  const cargo = lines.filter((line) => cargoSummary.test(line));
  const summary = cargo.length ? cargo : lines.filter((line) => testSummary.test(line)).slice(-1);
  if (!summary.length) return undefined;
  const counts = { passed: 0, failed: 0, skipped: 0 };
  for (const line of summary) {
    for (const [, value, label] of line.matchAll(testCount)) {
      counts[label === "ignored" ? "skipped" : (label as keyof typeof counts)] += Number(value);
    }
  }
  return counts;
}

function parseDiff(lines: readonly string[]) {
  for (let index = lines.length - 1; index >= 0; index--) {
    const match = diffSummary.exec(lines[index]);
    if (match) {
      return {
        files: Number(match[1]),
        additions: Number(match[2] ?? 0),
        deletions: Number(match[3] ?? 0),
      };
    }
  }
  return undefined;
}

/**
 * A shell exit status proves one command's result only when nothing else shares
 * it: a pipe, `;` or `||` reports another program, and `a && b` hides which failed.
 */
function readCommand(text: string) {
  const segments = text
    .split(/&&|\|\||[;|\n]/)
    .map((segment) => segment.trim().replace(commandPrefix, ""))
    .filter((segment) => segment && !/^cd\s/.test(segment));
  const kind = commandPatterns.find(([, pattern]) =>
    segments.some((segment) => pattern.test(segment)),
  )?.[0];
  return {
    kind,
    git: segments.some((segment) => gitChange.test(segment)),
    exitProvesKind: segments.length === 1 && !/[;|\n]/.test(text),
  };
}

function worstStatus(statuses: readonly VoiceLiveResultStatus[]): VoiceLiveResultStatus {
  if (statuses.includes("failed")) return "failed";
  return statuses.includes("interrupted") ? "interrupted" : "done";
}

/** Reduces the caller-bound active turn to settled outcomes; the latest run of a kind wins. */
export function voiceLiveResults(
  session: Pick<Session, "busy" | "blocks"> | undefined,
  activities: readonly VoiceToolActivityEntry[],
): VoiceLiveResult[] {
  const latest = new Map<VoiceLiveResult["kind"], VoiceLiveResult>();
  const commandFailed = new Map<string, boolean>();
  for (const block of session ? currentExecutionTools(session.blocks).tools : []) {
    const inspection = inspectCommand(block, session?.busy === true);
    const { lifecycle } = inspection;
    if (!inspection.command.exact || lifecycle === "running" || lifecycle === "stopped") continue;
    const command = readCommand(inspection.command.text);
    const lines = outputLines(inspection.error, inspection.output);
    const diff = command.git && lifecycle === "done" ? parseDiff(lines) : undefined;
    if (diff) latest.set("changes", { kind: "changes", status: "done", ...diff });
    const counts = command.kind === "tests" ? parseTestCounts(lines) : undefined;
    let recognized = Boolean(diff);
    if (counts) {
      const status =
        counts.failed > 0
          ? "failed"
          : lifecycle === "failed" && !command.exitProvesKind
            ? "done"
            : lifecycle;
      latest.set("tests", { kind: "tests", status, ...counts });
      recognized = true;
    } else if (command.kind && command.exitProvesKind) {
      latest.set(
        command.kind,
        command.kind === "tests"
          ? { kind: "tests", status: lifecycle, passed: 0, failed: 0, skipped: 0 }
          : { kind: command.kind, status: lifecycle },
      );
      recognized = true;
    }
    // A later success of the identical command clears its earlier failure.
    commandFailed.set(inspection.command.text, lifecycle === "failed" && !recognized);
  }
  const failedCommands = [...commandFailed.values()].filter(Boolean).length;
  if (failedCommands)
    latest.set("commands", { kind: "commands", status: "failed", count: failedCommands });
  const actions: VoiceLiveAction[] = [];
  for (const entry of activities) {
    if (entry.state === "running" || entry.state === "waiting-owner") continue;
    if (
      entry.state === "returned" &&
      (entry.outcome === "accepted" ||
        entry.outcome === "cancelled" ||
        entry.outcome === "rejected")
    )
      continue;
    if (resultActions.has(entry.name)) {
      actions.push({ id: entry.id, name: entry.name, status: actionStatus[entry.state] });
    }
  }
  if (actions.length) {
    const recent = actions.slice(-MAX_ACTIONS).reverse();
    latest.set("actions", {
      kind: "actions",
      status: worstStatus(recent.map((action) => action.status)),
      actions: recent,
    });
  }
  const urgency = { failed: 0, interrupted: 1, done: 2 } as const;
  return [...latest.values()].sort((left, right) => urgency[left.status] - urgency[right.status]);
}
