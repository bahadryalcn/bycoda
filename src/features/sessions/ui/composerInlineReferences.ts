import type { ComposerReferenceContext } from "./ComposerHighlight";
import { scanInlineReferences } from "./composerInlineScan";
import type { Attachment } from "../model/session";
import type { ScopedMentionKind } from "../model/composerMentionScopes";
import type { ComposerCitation } from "../model/chatCitation";

export type InlineReferenceKind =
  | "attachment"
  | "missing"
  | "file"
  | "url"
  | "skill"
  | "group"
  | "quote"
  | "file-comment"
  | "mcp"
  | ScopedMentionKind;
export type InlineReference = {
  start: number;
  end: number;
  kind: InlineReferenceKind;
  value: string;
  label: string;
  detail?: string;
  tone?: string;
};

export type InlineReferenceContext = ComposerReferenceContext & {
  attachments: Attachment[];
  citations: number;
  citationSources?: readonly ComposerCitation[];
  modeEnd: number;
};

export function isInlineMentionMark({ kind }: InlineReference) {
  return kind === "crew" || kind === "note" || kind === "work-item";
}

/**
 * Resolve display ranges against the original draft. Widgets never rewrite the document.
 * An editor keeps the scan between edits instead (`composerInlineScan.ts`).
 */
export function composerInlineReferences(
  text: string,
  context: InlineReferenceContext,
): InlineReference[] {
  return scanInlineReferences(text, context).references;
}
