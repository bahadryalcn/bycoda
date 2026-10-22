import type {
  GitChangedFile,
  GitConflictFile,
  GitConflictKind,
  GitDiffIndex,
  GitOperation,
} from "../../../platform/tauri/fs";

/** A conflict kind, or `unknown` when an older host only said which paths conflict. */
export type ConflictRowKind = GitConflictKind | "unknown";

export type ConflictRow = Omit<GitConflictFile, "kind"> & { kind: ConflictRowKind };

type KindInfo = {
  /** Git's own two-letter code for the kind (`git status`). */
  letter: string;
  label: string;
  title: string;
};

const KIND_INFO: Record<ConflictRowKind, KindInfo> = {
  "both-modified": {
    letter: "UU",
    label: "Both modified",
    title: "Both modified: the current branch and the incoming branch changed this file",
  },
  "both-added": {
    letter: "AA",
    label: "Both added",
    title: "Both added: the current branch and the incoming branch each added this file",
  },
  "deleted-by-us": {
    letter: "DU",
    label: "Deleted by current",
    title: "Deleted by us: the current branch deleted this file, the incoming branch changed it",
  },
  "deleted-by-them": {
    letter: "UD",
    label: "Deleted by incoming",
    title: "Deleted by them: the incoming branch deleted this file, the current branch changed it",
  },
  "added-by-us": {
    letter: "AU",
    label: "Added by current",
    title: "Added by us: only the current branch has this file",
  },
  "added-by-them": {
    letter: "UA",
    label: "Added by incoming",
    title: "Added by them: only the incoming branch has this file",
  },
  "both-deleted": {
    letter: "DD",
    label: "Both deleted",
    title: "Both deleted: neither branch has this file any more",
  },
  unknown: {
    letter: "U",
    label: "Unmerged",
    title: "Unmerged: this file has a merge conflict",
  },
};

export function conflictKindInfo(kind: ConflictRowKind): KindInfo {
  return KIND_INFO[kind];
}

export type ConflictChoiceId = "current" | "incoming" | "both" | "keep" | "delete";

export type ConflictChoice = {
  id: ConflictChoiceId;
  label: string;
  title: string;
  /** Which side's version the choice takes: `both` joins the two in the file. */
  side: "ours" | "theirs" | "both";
};

const CURRENT: ConflictChoice = {
  id: "current",
  label: "Current",
  title: "Keep the current branch's version of the whole file",
  side: "ours",
};
const INCOMING: ConflictChoice = {
  id: "incoming",
  label: "Incoming",
  title: "Keep the incoming version of the whole file",
  side: "theirs",
};
const BOTH: ConflictChoice = {
  id: "both",
  label: "Both",
  title: "Keep both sides of every conflict, current first",
  side: "both",
};
const keep = (side: "ours" | "theirs"): ConflictChoice => ({
  id: "keep",
  label: "Keep file",
  title: "Keep the file and stage it",
  side,
});
const remove = (side: "ours" | "theirs"): ConflictChoice => ({
  id: "delete",
  label: "Delete file",
  title: "Delete the file and stage the deletion",
  side,
});

/**
 * The whole-file choices for a conflict. Content conflicts take a side or both;
 * when one side deleted the file (or only one side has it) the choice is to
 * keep it or delete it. `side` is the stage whose state the choice adopts, and
 * a side that deleted the file means deleting it (`git rm`, not `checkout`).
 */
export function conflictChoices(kind: ConflictRowKind): ConflictChoice[] {
  switch (kind) {
    case "both-modified":
    case "both-added":
      return [CURRENT, INCOMING, BOTH];
    case "unknown":
      return [CURRENT, INCOMING];
    case "deleted-by-us":
      return [keep("theirs"), remove("ours")];
    case "deleted-by-them":
      return [keep("ours"), remove("theirs")];
    case "added-by-us":
      return [keep("ours"), remove("theirs")];
    case "added-by-them":
      return [keep("theirs"), remove("ours")];
    case "both-deleted":
      return [remove("ours")];
  }
}

/** Whether the file exists in the working tree to open or mark resolved as is. */
export function conflictHasFile(kind: ConflictRowKind): boolean {
  return kind !== "both-deleted";
}

/** Compare reads the stage versions; with nothing to compare it is not offered. */
export function conflictCanCompare(kind: ConflictRowKind): boolean {
  return kind !== "both-deleted" && kind !== "unknown";
}

/** What the Changes panel lists: conflicts first, and files once each. */
export type ConflictState = {
  conflicts: ConflictRow[];
  /** `index.files` without the conflicted paths. */
  files: GitChangedFile[];
  operation: GitOperation | null;
  /** Where the conflicts came from: the index, the older polling commands, or nowhere. */
  source: "index" | "legacy" | "none";
};

export type LegacyConflictStatus = {
  operation: GitOperation | null;
  conflicts: string[];
};

/**
 * Conflict state for the panel. An index that carries `conflicts` is the whole
 * truth. One from an older host does not: its unmerged files sit in `files` as
 * ordinary rows, so the paths from the older status commands (when the host
 * has them) are lifted out of `files` instead. With neither, nothing extra.
 */
export function resolveConflictState(
  cwd: string,
  index: GitDiffIndex | null,
  legacy: LegacyConflictStatus | null,
): ConflictState {
  const files = index?.files ?? [];
  if (index?.conflicts) {
    return {
      conflicts: index.conflicts,
      files,
      operation: index.operation ?? null,
      source: "index",
    };
  }
  if (!legacy || (legacy.conflicts.length === 0 && !legacy.operation)) {
    return {
      conflicts: [],
      files,
      operation: legacy?.operation ?? null,
      source: legacy ? "legacy" : "none",
    };
  }
  const listed = new Map(files.map((file) => [file.relative, file]));
  const base = cwd.replace(/[\\/]+$/, "");
  return {
    conflicts: legacy.conflicts.map((relative) => ({
      path: listed.get(relative)?.path ?? `${base}/${relative}`,
      relative,
      kind: "unknown" as const,
    })),
    files: files.filter((file) => !legacy.conflicts.includes(file.relative)),
    operation: legacy.operation,
    source: "legacy",
  };
}

/** Whether the index of this project is missing conflict info that a poll of
 * the older commands could supply. */
export function needsLegacyConflictPoll(index: GitDiffIndex | null): boolean {
  return index !== null && index.conflicts === undefined;
}

const NAMED_FILES = 3;

/** Shown in place of the Commit button's action while conflicts remain. */
export function commitBlockedMessage(conflicts: readonly { relative: string }[]): string | null {
  if (conflicts.length === 0) return null;
  const names = conflicts.slice(0, NAMED_FILES).map((conflict) => conflict.relative);
  const more = conflicts.length - names.length;
  const list = more > 0 ? `${names.join(", ")} and ${more} more` : names.join(", ");
  return `Resolve ${conflicts.length === 1 ? "the merge conflict" : `${conflicts.length} merge conflicts`} before committing: ${list}`;
}

/** The banner's one-line summary: "Merge in progress · 3 conflicts". */
export function operationSummary(label: string, conflictCount: number): string {
  const conflicts =
    conflictCount === 0
      ? "no conflicts left"
      : conflictCount === 1
        ? "1 conflict"
        : `${conflictCount} conflicts`;
  return `${label} in progress · ${conflicts}`;
}

/** The conflicted file after `current` in `relatives`, wrapping; null when no other has a conflict. */
export function nextConflictedFile(
  relatives: readonly string[],
  current: string | null,
): string | null {
  const others = relatives.filter((relative) => relative !== current);
  if (others.length === 0) return null;
  const at = current === null ? -1 : relatives.indexOf(current);
  // The first listed path after the current one; the current may have left the list.
  const after =
    at < 0 ? undefined : relatives.slice(at + 1).find((relative) => relative !== current);
  return after ?? others[0];
}

/** Whether two conflict lists would render the same rows. */
export function sameConflicts(
  a: readonly GitConflictFile[] | undefined,
  b: readonly GitConflictFile[] | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((file, i) => file.relative === b[i].relative && file.kind === b[i].kind);
}
