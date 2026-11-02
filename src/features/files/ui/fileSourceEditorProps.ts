import type { ComponentProps } from "react";
import type { CodeMirrorEditor } from "./CodeMirrorEditor";

type SourceEditorProps = ComponentProps<typeof CodeMirrorEditor>;

/**
 * Document, save, recovery and capture bindings every FileEditor source surface
 * shares (plain file and the Markdown/SVG/HTML Source pane). FileEditor remains
 * the single document, admission and save owner; this only lists what it hands
 * to CodeMirrorEditor so the two render paths cannot drift apart.
 */
export type FileSourceEditorContract = Pick<
  SourceEditorProps,
  | "path"
  | "cwd"
  | "retainedState"
  | "showDiff"
  | "gitOriginal"
  | "navigation"
  | "onDirtyChange"
  | "onErrorCountChange"
  | "onSave"
  | "onPeerSaved"
  | "saveRequestRef"
  | "onStageGit"
  | "onDocumentChange"
  | "captureObserver"
  | "onEdit"
  | "onOpenFile"
  | "initialDraft"
> & {
  relativePath: string;
  /** The loaded document text; the disk baseline recovered drafts diff against. */
  content: string;
  /** Explicit recovery copies stay dirty until a successful write; read at render. */
  recoveryReviewRef: { current: boolean };
  /** A pending disk change blocks autosave until reloaded or resolved. */
  pendingDiskRef: { current: boolean };
};

/** How a given surface exposes the shared editor. */
export type FileSourceEditorView = {
  /** Keyboard/command focus ownership; false keeps the pane inert to input. */
  active: boolean;
  /** False while covered: git and disk refreshes wait until shown again. */
  shown: boolean;
  /** Preview surfaces only: receives the whole text after each change. */
  onDocChange?: SourceEditorProps["onDocChange"];
};

/**
 * Remount identity of the editor: a different document, a disk reload or an
 * explicit revision bump replaces the view, anything else keeps the buffer.
 */
export function fileSourceEditorKey(
  documentId: string,
  reloadKey: number,
  editorRevision: number,
): string {
  return `${documentId}:${reloadKey}:${editorRevision}`;
}

/** The complete CodeMirrorEditor props for one FileEditor source surface (key is set by the caller). */
export function fileSourceEditorProps(
  contract: FileSourceEditorContract,
  view: FileSourceEditorView,
): SourceEditorProps {
  const { relativePath, content, recoveryReviewRef, pendingDiskRef, ...bindings } = contract;
  return {
    ...bindings,
    commentPath: relativePath,
    value: content,
    initialDirty: contract.initialDraft !== undefined && recoveryReviewRef.current,
    canAutosave: () => !pendingDiskRef.current && !recoveryReviewRef.current,
    active: view.active,
    shown: view.shown,
    onDocChange: view.onDocChange,
  };
}
