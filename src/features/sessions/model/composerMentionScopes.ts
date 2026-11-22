import { NOTE_MENTION_PREFIX, NOTES_MENTION_SCOPE } from "../../notes";
import type { RankedFile } from "../../files";
import { CREWS_MENTION_SCOPE } from "./crewMentions";

export type ComposerMentionScope = typeof CREWS_MENTION_SCOPE | typeof NOTES_MENTION_SCOPE;
const SCOPE_HINT_PATH = "composer-mention-scope/";

export function composerMentionScope(query: string): ComposerMentionScope | undefined {
  const normalized = query.toLowerCase();
  if (normalized.startsWith(CREWS_MENTION_SCOPE)) return CREWS_MENTION_SCOPE;
  if (normalized.startsWith(NOTES_MENTION_SCOPE)) return NOTES_MENTION_SCOPE;
}

export function composerMentionScopeHint(
  scope: ComposerMentionScope,
  query: string,
  available: boolean,
): RankedFile[] {
  if (!available || !scope.startsWith(query.toLowerCase())) return [];
  return [
    {
      name: scope,
      path: `${SCOPE_HINT_PATH}${scope}`,
      relative: scope,
      score: 0,
      positions: [],
    },
  ];
}

export function composerMentionScopeHintOf(file: {
  path: string;
}): ComposerMentionScope | undefined {
  return file.path.startsWith(SCOPE_HINT_PATH)
    ? composerMentionScope(file.path.slice(SCOPE_HINT_PATH.length))
    : undefined;
}

export function scopedNoteMentionLabel(label: string): string {
  return `${NOTES_MENTION_SCOPE}${label.slice(NOTE_MENTION_PREFIX.length)}`;
}
