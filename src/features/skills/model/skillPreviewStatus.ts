/**
 * What the skill preview footer reports about the open document. Each state is distinct so a
 * read-only skill is never described as saved and an editable clean skill is never blank.
 * The footer maps these to `t()` labels in SkillsPage.tsx.
 */
export type SkillPreviewStatus =
  | "failed"
  | "loading"
  | "saving"
  | "dirty"
  | "read-only"
  | "saved"
  | "clean";

export interface SkillPreviewStatusInput {
  /** The document could not be read; the footer reports the failure first. */
  readError: boolean;
  /** The document text has been read from disk. */
  loaded: boolean;
  saving: boolean;
  /** The draft differs from the text read from disk. */
  dirty: boolean;
  /** The skill can be edited here (native, on this computer). */
  editable: boolean;
  /** This exact draft was just written to disk by this screen. */
  savedDraft: boolean;
}

export function skillPreviewStatus(input: SkillPreviewStatusInput): SkillPreviewStatus {
  if (input.readError) return "failed";
  if (!input.loaded) return "loading";
  if (input.saving) return "saving";
  if (input.dirty) return "dirty";
  if (!input.editable) return "read-only";
  return input.savedDraft ? "saved" : "clean";
}
