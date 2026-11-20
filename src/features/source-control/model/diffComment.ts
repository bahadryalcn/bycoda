import type { UnifiedLine } from "./unifiedDiff";

export type DiffCommentTarget = {
  path: string;
  line: UnifiedLine;
};

export function diffCommentLocation({ path, line }: DiffCommentTarget): string {
  const number = line.kind === "del" ? line.oldNumber : line.newNumber;
  return number == null ? path : `${path}:${number}`;
}

const drafts = new Map<string, string>();

function draftKey(target: DiffCommentTarget): string {
  return `${target.line.kind}\0${diffCommentLocation(target)}`;
}

/** Unsent comment text per file line, so switching lines or reopening never loses it. */
export function readDiffCommentDraft(target: DiffCommentTarget): string {
  return drafts.get(draftKey(target)) ?? "";
}

/** An empty or blank draft is dropped, so only real text is kept. */
export function writeDiffCommentDraft(target: DiffCommentTarget, comment: string): void {
  if (comment.trim()) drafts.set(draftKey(target), comment);
  else drafts.delete(draftKey(target));
}

export function formatDiffComment(target: DiffCommentTarget, comment: string): string {
  const body = comment.replace(/\r\n?/g, "\n").trim();
  if (!body) return "";

  const marker = target.line.kind === "add" ? "+" : target.line.kind === "del" ? "-" : " ";
  const deleted = target.line.kind === "del" ? " (deleted line)" : "";
  const location = diffCommentLocation(target).replace(/`/g, "\\`");

  return [
    `Diff comment on \`${location}\`${deleted}:`,
    "",
    `> ${marker}${target.line.text}`,
    "",
    body,
  ].join("\n");
}
