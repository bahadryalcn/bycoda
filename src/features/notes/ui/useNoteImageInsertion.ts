import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type RefObject,
} from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { EditorView } from "@codemirror/view";
import { pickImageFiles } from "../../../platform/tauri/fs";
import { t } from "../../../shared/i18n";
import { droppedFileCount, droppedFileTypes } from "../../../shared/lib/externalDrop";
import type { ExternalDropVerdict } from "../../../shared/lib/externalDrop";
import { useExternalDropFeedback } from "../../../shared/hooks/useExternalDropFeedback";
import { filesFromClipboard } from "../../sessions/model/attachments";
import {
  insertNoteImagesMarkdown,
  saveNoteImagesFromFiles,
  saveNoteImagesFromPaths,
  NoteImageApplicationError,
  noteImageApplicationErrors,
  type NoteImageAsset,
} from "../noteImages";
import { draftInputOwner, type Draft } from "../noteDrafts";
import { noteInputWorkError, type NoteInputWork } from "../notesInputOwners";

type NoteInputOwner = ReturnType<typeof draftInputOwner>;
type InsertionRange = { start: number; end: number };

function hasDroppedFiles(data: DataTransfer | null): data is DataTransfer {
  if (!data) return false;
  return [...data.types].some((type) => type === "Files" || type === "application/x-moz-file");
}

const IMAGE_PATH = /\.(png|jpe?g|gif|webp|bmp|ico|svg|tiff?|heic|heif|avif)$/i;
const HAS_EXTENSION = /\.[a-z0-9]{1,5}$/i;

/** A drag is refused only when every file is known not to be an image (folders stay unknown). */
function onlyNonImages(kinds: { types?: string[]; paths?: string[] }): boolean {
  if (kinds.types?.length)
    return kinds.types.every((type) => type !== "" && !type.startsWith("image/"));
  if (kinds.paths?.length)
    return kinds.paths.every((path) => HAS_EXTENSION.test(path) && !IMAGE_PATH.test(path));
  return false;
}

/**
 * Image insertion for one open note: toolbar picker, pastes on the preview,
 * DOM drops on the editor body and native (Tauri) file drops. One insertion runs
 * at a time under the note's input owner; the markdown lands at the captured
 * caret, or at the end if text changed while loading so no later edits are replaced.
 *
 * While files are dragged over the editor body it carries the shared drop mark and the cursor
 * badge says "Insert image" (or why it cannot). Text drags are not touched here: the editor
 * keeps its own text drop and caret behaviour.
 */
export function useNoteImageInsertion({
  noteId,
  inputOwner,
  draftState,
  bodyRef,
  modeRef,
  toolbarTargetRef,
  editorViewRef,
  previewViewRef,
  previewRangeRef,
  onInserted,
  onError,
}: {
  noteId: string;
  inputOwner: NoteInputOwner;
  draftState: Draft;
  bodyRef: RefObject<string>;
  modeRef: RefObject<string>;
  toolbarTargetRef: RefObject<"source" | "preview">;
  editorViewRef: RefObject<EditorView | null>;
  previewViewRef: RefObject<EditorView | null>;
  previewRangeRef: RefObject<{ from: number; to: number } | null>;
  /** Applies the new body inside the insertion's input work. */
  onInserted: (body: string) => void;
  onError: (message: string) => void;
}) {
  const { show: showDrop, hide: hideDrop } = useExternalDropFeedback();
  const [imageBusy, setImageBusy] = useState(false);
  const [outcome, setOutcome] = useState<object | null>(null);
  const outcomeCommit = useRef<{ token: object; committed(): void } | null>(null);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Retirement keeps the original draft/result, never reads a removed view.
      outcomeCommit.current?.committed();
      outcomeCommit.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    if (outcomeCommit.current?.token === outcome) {
      outcomeCommit.current.committed();
      outcomeCommit.current = null;
    }
  }, [outcome]);
  const imageBusyRef = useRef(false);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const lastDropAt = useRef(0);
  // The draft owner's callbacks change identity with each render; reading the
  // committed ones here keeps the native drop subscription stable.
  const owners = useRef({ onInserted, onError });
  useLayoutEffect(() => {
    owners.current = { onInserted, onError };
  });

  const insertionRange = useCallback((): InsertionRange => {
    if (
      (modeRef.current === "preview" ||
        (modeRef.current === "split" && toolbarTargetRef.current === "preview")) &&
      previewRangeRef.current &&
      previewViewRef.current
    ) {
      const { from, to } = previewViewRef.current.state.selection.main;
      return { start: previewRangeRef.current.from + from, end: previewRangeRef.current.from + to };
    }
    const view = editorViewRef.current;
    if (!view || modeRef.current === "preview") {
      const end = bodyRef.current.length;
      return { start: end, end };
    }
    const { from, to } = view.state.selection.main;
    return { start: from, end: to };
  }, [bodyRef, editorViewRef, modeRef, previewRangeRef, previewViewRef, toolbarTargetRef]);

  const addDroppedImages = useCallback(
    async (load: (work: NoteInputWork) => Promise<NoteImageAsset[]>, range: InsertionRange) => {
      if (imageBusyRef.current) return;
      const work = inputOwner.operation("image-insertion");
      if (!work) {
        if (!inputOwner.closed()) owners.current.onError(noteInputWorkError(inputOwner).message);
        return;
      }
      imageBusyRef.current = true;
      setImageBusy(true);
      hideDrop();
      const initialBody =
        draftState.edits.current.body ?? draftState.saved?.body ?? draftState.base.body;
      try {
        const images = await load(work);
        if (images.length === 0) return;
        const currentBody =
          draftState.edits.current.body ?? draftState.saved?.body ?? draftState.base.body;
        const unchanged = currentBody === initialBody;
        const inserted = insertNoteImagesMarkdown(
          currentBody,
          unchanged ? range.start : currentBody.length,
          unchanged ? range.end : currentBody.length,
          images,
        );
        work.apply(() => {
          owners.current.onInserted(inserted.value);
          const unresolved = noteImageApplicationErrors(images);
          if (unresolved.length) {
            (draftState.imageApplicationErrors ??= []).push(
              ...unresolved.map((error) => ({
                asset: { ...error.asset },
                message: error.message,
              })),
            );
            owners.current.onError(unresolved[0].message);
          }
        });
        if (unchanged)
          window.requestAnimationFrame(() => {
            const view = editorViewRef.current;
            if (!view || modeRef.current === "preview") return;
            view.focus();
            view.dispatch({
              selection: {
                anchor: Math.min(inserted.cursor, view.state.doc.length),
              },
              scrollIntoView: true,
            });
          });
      } catch (err: unknown) {
        work.apply(() => {
          const unresolved = noteImageApplicationErrors(err);
          if (unresolved.length || err instanceof NoteImageApplicationError) {
            // The conserved service request bounds these unresolved outcomes;
            // keep its exact successful asset separate from canonical Markdown.
            (draftState.imageApplicationErrors ??= []).push(
              ...(unresolved.length ? unresolved : [err as NoteImageApplicationError]).map(
                (error) => ({ asset: { ...error.asset }, message: error.message }),
              ),
            );
          }
          owners.current.onError(err instanceof Error ? err.message : String(err));
        });
      } finally {
        const committed = () => {
          imageBusyRef.current = false;
          work();
        };
        if (mounted.current) {
          const token = {};
          outcomeCommit.current = { token, committed };
          setImageBusy(false);
          setOutcome(token);
          // Public completion may let its caller render. The actual operation
          // stays charged until this exact private outcome commits in layout.
        } else committed();
      }
    },
    [inputOwner, draftState, editorViewRef, modeRef, hideDrop],
  );

  /** What releasing the dragged files on the editor would do right now. */
  const dropVerdict = useCallback(
    (kinds: { count: number; types?: string[]; paths?: string[] }): ExternalDropVerdict => {
      if (imageBusyRef.current)
        return { kind: "blocked", reason: t("Wait for the current image to finish inserting") };
      if (inputOwner.closed())
        return { kind: "blocked", reason: t("This note cannot be changed right now") };
      if (onlyNonImages(kinds))
        return { kind: "blocked", reason: t("Only images can be inserted here") };
      return {
        kind: "accept",
        label: kinds.count > 1 ? t("Insert {p0} images", { p0: kinds.count }) : t("Insert image"),
      };
    },
    [inputOwner],
  );

  const pasteImages = useCallback(
    (files: File[]) => {
      const range = insertionRange();
      void addDroppedImages((work) => saveNoteImagesFromFiles(noteId, files, work), range);
    },
    [addDroppedImages, insertionRange, noteId],
  );

  const insertImage = useCallback(async () => {
    // Read the caret before the dialog takes focus from the editor.
    const range = insertionRange();
    await addDroppedImages(async (work) => {
      const paths = await pickImageFiles();
      return paths?.length ? saveNoteImagesFromPaths(noteId, paths, work) : [];
    }, range);
  }, [addDroppedImages, insertionRange, noteId]);

  // The editor takes its own pastes; this catches a paste on the preview.
  const onPreviewPaste = (event: ReactClipboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || modeRef.current !== "preview") return;
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, [contenteditable='true']")) return;
    const images = filesFromClipboard(event.clipboardData).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (images.length === 0) return;
    event.preventDefault();
    pasteImages(images);
  };

  // Native drops arrive as webview events with physical or logical coordinates.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const toClientPoint = (x: number, y: number) => {
      const scale = window.devicePixelRatio || 1;
      if (scale !== 1 && (x > window.innerWidth || y > window.innerHeight)) {
        return { x: x / scale, y: y / scale };
      }
      return { x, y };
    };
    const overDropZone = (x: number, y: number) => {
      const zone = dropZoneRef.current;
      if (!zone) return false;
      const point = toClientPoint(x, y);
      const rect = zone.getBoundingClientRect();
      return (
        point.x >= rect.left &&
        point.x <= rect.right &&
        point.y >= rect.top &&
        point.y <= rect.bottom
      );
    };

    let nativePaths: string[] = [];
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "leave") {
          nativePaths = [];
          hideDrop();
          return;
        }
        const { x, y } = event.payload.position;
        const over = overDropZone(x, y);
        if (event.payload.type === "enter" || event.payload.type === "over") {
          if (event.payload.type === "enter") nativePaths = event.payload.paths ?? [];
          if (!over) hideDrop();
          else {
            const point = toClientPoint(x, y);
            showDrop(
              dropZoneRef.current,
              dropVerdict({ count: nativePaths.length, paths: nativePaths }),
              { clientX: point.x, clientY: point.y },
            );
          }
          return;
        }
        if (event.payload.type !== "drop") return;
        nativePaths = [];
        hideDrop();
        if (!over || Date.now() - lastDropAt.current < 250) return;
        lastDropAt.current = Date.now();
        const range = insertionRange();
        const paths = event.payload.paths;
        void addDroppedImages((work) => saveNoteImagesFromPaths(noteId, paths, work), range);
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [addDroppedImages, insertionRange, noteId, showDrop, hideDrop, dropVerdict]);

  /** DOM drag handlers for the editor body (the native path above covers Tauri drops). */
  const dropZoneHandlers = {
    onDragOver: (event: ReactDragEvent<HTMLDivElement>) => {
      if (!hasDroppedFiles(event.dataTransfer)) return;
      event.preventDefault();
      const verdict = dropVerdict({
        count: droppedFileCount(event.dataTransfer),
        types: droppedFileTypes(event.dataTransfer),
      });
      event.dataTransfer.dropEffect = verdict.kind === "accept" ? "copy" : "none";
      showDrop(event.currentTarget, verdict, event);
    },
    onDragLeave: (event: ReactDragEvent<HTMLDivElement>) => {
      const next = event.relatedTarget as Node | null;
      if (next && event.currentTarget.contains(next)) return;
      hideDrop();
    },
    onDrop: (event: ReactDragEvent<HTMLDivElement>) => {
      if (!hasDroppedFiles(event.dataTransfer)) return;
      event.preventDefault();
      hideDrop();
      if (Date.now() - lastDropAt.current < 250) return;
      lastDropAt.current = Date.now();
      const files = [...event.dataTransfer.files];
      if (files.length === 0) return;
      const range = insertionRange();
      void addDroppedImages((work) => saveNoteImagesFromFiles(noteId, files, work), range);
    },
  };

  return {
    // The shared drop mark and cursor badge replace the in-editor drop overlay, so a consumer that
    // still draws one from this flag never shows it.
    imageDrag: false,
    imageBusy,
    dropZoneRef,
    dropZoneHandlers,
    insertImage,
    pasteImages,
    onPreviewPaste,
  };
}
