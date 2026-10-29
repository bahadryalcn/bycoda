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

/**
 * Image insertion for one open note: toolbar picker, pastes on the preview,
 * DOM drops on the editor body and native (Tauri) file drops. One insertion runs
 * at a time under the note's input owner; the markdown lands at the caret that
 * was current when the insertion started, and the draft owner applies it.
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
  const [imageDrag, setImageDrag] = useState(false);
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
      setImageDrag(false);
      try {
        const images = await load(work);
        if (images.length === 0) return;
        const currentBody =
          draftState.edits.current.body ?? draftState.saved?.body ?? draftState.base.body;
        const inserted = insertNoteImagesMarkdown(currentBody, range.start, range.end, images);
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
    [inputOwner, draftState, editorViewRef, modeRef],
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

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "leave") {
          setImageDrag(false);
          return;
        }
        const { x, y } = event.payload.position;
        const over = overDropZone(x, y);
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setImageDrag(over);
          return;
        }
        if (event.payload.type !== "drop") return;
        setImageDrag(false);
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
  }, [addDroppedImages, insertionRange, noteId]);

  /** DOM drag handlers for the editor body (the native path above covers Tauri drops). */
  const dropZoneHandlers = {
    onDragOver: (event: ReactDragEvent<HTMLDivElement>) => {
      if (!hasDroppedFiles(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setImageDrag(true);
    },
    onDragLeave: (event: ReactDragEvent<HTMLDivElement>) => {
      const next = event.relatedTarget as Node | null;
      if (next && event.currentTarget.contains(next)) return;
      setImageDrag(false);
    },
    onDrop: (event: ReactDragEvent<HTMLDivElement>) => {
      if (!hasDroppedFiles(event.dataTransfer)) return;
      event.preventDefault();
      setImageDrag(false);
      if (Date.now() - lastDropAt.current < 250) return;
      lastDropAt.current = Date.now();
      const files = [...event.dataTransfer.files];
      if (files.length === 0) return;
      const range = insertionRange();
      void addDroppedImages((work) => saveNoteImagesFromFiles(noteId, files, work), range);
    },
  };

  return {
    imageDrag,
    imageBusy,
    dropZoneRef,
    dropZoneHandlers,
    insertImage,
    pasteImages,
    onPreviewPaste,
  };
}
