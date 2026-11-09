import type { GitConflictStages } from "../../../platform/tauri/fs";
import { sniffImageMime } from "../../files/public/filePreviewMetadata";

export type CompareId = "sides" | "base-current" | "base-incoming";
export type StageSide = "base" | "ours" | "theirs";

export type Comparison = {
  id: CompareId;
  label: string;
  /** The stages shown left and right. */
  sides: [StageSide, StageSide];
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
    {
      id: "sides",
      label: "Current ↔ Incoming",
      sides: ["ours", "theirs"],
      original: ours,
      current: theirs,
    },
    {
      id: "base-current",
      label: "Base ↔ Current",
      sides: ["base", "ours"],
      original: base,
      current: ours,
      unavailable: stages.base === null ? noBase : undefined,
    },
    {
      id: "base-incoming",
      label: "Base ↔ Incoming",
      sides: ["base", "theirs"],
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

/** What Compare shows for one version of an image file. */
export type ConflictImage =
  | { status: "missing" }
  | { status: "unreadable" }
  | { status: "image"; src: string; bytes: number };

/**
 * One version of an image file as a `data:` URL. The MIME comes from the
 * bytes, not the name, so a non-image named `*.png` (or a Git LFS pointer)
 * is reported as unreadable instead of being handed to the webview.
 */
export function conflictImage(stages: GitConflictStages, side: StageSide): ConflictImage {
  const encoded = stages.images?.[side];
  if (encoded === null || encoded === undefined) {
    return stages[side] === null ? { status: "missing" } : { status: "unreadable" };
  }
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  } catch {
    return { status: "unreadable" };
  }
  const mime = sniffImageMime(bytes);
  if (!mime) return { status: "unreadable" };
  return { status: "image", src: `data:${mime};base64,${encoded}`, bytes: bytes.length };
}
