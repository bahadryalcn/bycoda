import type { Block } from "./session";
import { blockLifecycle, type DockAgentStatus } from "./activityDock";
import { boundedToolPreview } from "./toolInspection";
import { toolCallLabel, toolCallState } from "./transcriptActivity";

/**
 * One pure reading of a command-like tool block, shared by Command details, its
 * Copy action and the complete tool inspector, so they cannot disagree.
 */
export type CommandInspection = {
  command: {
    text: string;
    /** True when `text` is the retained exact command, not a display title. */
    exact: boolean;
    /** The retained command was cut to the inspection size limit. */
    truncated: boolean;
  };
  /** Failure text; present only for a failed call. Never repeated in `output`. */
  error?: string;
  /** Reconciled output (see `reconcileToolText`); empty when nothing was reported. */
  output: string;
  /** Part of the output was cut or dropped upstream. The full text may not exist. */
  outputTruncated: boolean;
  lifecycle: DockAgentStatus;
  /** Present while only a bounded remote summary is held locally. */
  remote?: { revision: number; bytes: number };
};

/**
 * Merges candidate result texts, in priority order, without repeating
 * themselves: a text contained in an already kept (fuller) one is dropped, and a
 * fuller text replaces the shorter kept ones it contains (in the earlier slot).
 * Distinct texts are all kept, so no information is lost to a "longest wins"
 * guess.
 */
export function reconcileToolText(candidates: readonly (string | undefined)[]): string[] {
  const kept: string[] = [];
  for (const raw of candidates) {
    const text = raw?.trim();
    if (!text) continue;
    if (kept.some((existing) => existing.includes(text))) continue;
    const firstContained = kept.findIndex((existing) => text.includes(existing));
    if (firstContained === -1) {
      kept.push(text);
      continue;
    }
    const rest = kept.filter((existing) => !text.includes(existing));
    rest.splice(Math.min(firstContained, rest.length), 0, text);
    kept.length = 0;
    kept.push(...rest);
  }
  return kept;
}

/**
 * Output precedence, one rule for every surface:
 * 1. `tool.output` is the canonical retained result (subagent step blocks);
 * 2. `tool.detail` is a transcript block's own result (its failure text when the
 *    call failed, which is returned as `error` instead);
 * 3. `preview.output` is a bounded preview and is subordinate: it never hides
 *    fuller canonical text, and it only adds text the canonical result lacks.
 */
export function toolResultTexts(block: Block): { error?: string; output: string[] } {
  const tool = block.tool;
  const failed = toolCallState(block) === "rejected";
  const detail = tool?.detail?.trim();
  const error = failed && detail ? detail : undefined;
  const canonical = [tool?.output, failed ? undefined : detail];
  const output = reconcileToolText([...canonical, tool?.preview?.output]).filter(
    (text) => !error || (!error.includes(text) && !text.includes(error)),
  );
  return { ...(error ? { error } : {}), output };
}

/** The exact retained command when there is one, else the best display text. */
export function commandText(block: Block): CommandInspection["command"] {
  const preview = boundedToolPreview(block.tool?.preview);
  const inspection = preview?.inspection;
  if (inspection?.kind === "command" && inspection.text) {
    return { text: inspection.text, exact: true, truncated: inspection.truncated === true };
  }
  const text =
    preview?.title?.trim() ||
    block.tool?.title?.trim() ||
    block.text?.trim() ||
    toolCallLabel(block);
  return { text, exact: false, truncated: false };
}

export function inspectCommand(block: Block, busy: boolean): CommandInspection {
  const { error, output } = toolResultTexts(block);
  const remote = block.remoteContent;
  return {
    command: commandText(block),
    ...(error ? { error } : {}),
    output: output.join("\n\n"),
    outputTruncated: block.tool?.outputTruncated === true,
    lifecycle: blockLifecycle(block, busy),
    ...(remote ? { remote: { revision: remote.revision, bytes: remote.bytes } } : {}),
  };
}

/** Text for Copy: the exact command, the status line, the error, then the output. */
export function commandCopyText(inspection: CommandInspection, statusLabel: string): string {
  return [inspection.command.text, statusLabel, inspection.error, inspection.output]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Why there is no output to read, or null when there is some. Derived from
 * provider-reported lifecycle only; shell text is never parsed to claim silence.
 */
export type EmptyOutputReason = "running" | "done" | "failed" | "stopped" | "interrupted";

export function emptyOutputReason(inspection: CommandInspection): EmptyOutputReason | null {
  if (inspection.output) return null;
  return inspection.lifecycle;
}
