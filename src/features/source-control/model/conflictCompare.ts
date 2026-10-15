import type { GitConflictStages } from "../../../platform/tauri/fs";

export type CompareId = "sides" | "base-current" | "base-incoming";

export type Comparison = {
  id: CompareId;
  label: string;
  /** Left text, what the right one is shown as having changed. */
  original: string;
  current: string;
  /** Why this pair cannot be shown, when it cannot. */
  unavailable?: string;
};

/**
 * The pairs the read-only Compare view offers for a conflicted file: current
 * against incoming, and each of them against the common base. A missing version
 * (stage) compares as an empty file; a missing base disables its two pairs,
 * since there was no common file to start from.
 */
export function comparisonsFor(stages: GitConflictStages): Comparison[] {
  const noBase = "There is no common base: the file was added on both sides";
  const base = stages.base ?? "";
  const ours = stages.ours ?? "";
  const theirs = stages.theirs ?? "";
  return [
    { id: "sides", label: "Current ↔ Incoming", original: ours, current: theirs },
    {
      id: "base-current",
      label: "Base ↔ Current",
      original: base,
      current: ours,
      unavailable: stages.base === null ? noBase : undefined,
    },
    {
      id: "base-incoming",
      label: "Base ↔ Incoming",
      original: base,
      current: theirs,
      unavailable: stages.base === null ? noBase : undefined,
    },
  ];
}

/** Sentences for a side git has no version of (it deleted the file, or never had it), shown above the diff. */
export function missingSideNotes(stages: GitConflictStages): string[] {
  const notes: string[] = [];
  if (stages.ours === null) notes.push("The current branch has no version of this file.");
  if (stages.theirs === null) notes.push("The incoming branch has no version of this file.");
  return notes;
}
