import { Tooltip } from "../../../shared/ui/Tooltip";
import { t, useLocale } from "../../../shared/i18n/technical";
import { Folder, RotateCcw, Save } from "../../../shared/ui/icons";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { Alert } from "../../../shared/ui/Alert";
import { hasActiveOverlay } from "../../../shared/ui/overlay";
import { isImeComposition } from "../../../shared/lib/keyboard";
import { IS_MAC, IS_WIN } from "../../../platform/tauri/platform";
import { isRemoteProjectPath } from "../../projects/model/recents";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { isTauri } from "@tauri-apps/api/core";
import type { Text } from "@codemirror/state";
import type { RecoveredEditorDraft } from "../model/editorDraftRecovery";
import { readEditorDraftRecovery } from "../data/editorDraftRecovery";
import {
  bindEditorDraftDocument,
  type EditorDraftDocument,
  type NativeCaptureState,
} from "../data/editorDraftPersistence";
import { MarkdownViewShell, useMarkdownMode } from "../../sessions/ui/MarkdownModeToggle";

import {
  basename,
  gitDiffFiles,
  gitFileDiff,
  gitStageContents,
  notifyGitChanged,
  openHtmlInChrome,
  readTextFile,
  revealPath,
  subscribeGitChanged,
  writeTextFile,
  type GitFileDiffKind,
} from "../../../platform/tauri/fs";
import { syncWatchedMtime, watchFile } from "../model/fileWatch";
import { displayPath } from "../../../shared/lib/paths";
import type { EditorNavigation, OpenFileFn } from "../../search/model/search";
import { MarkdownDocumentPreview } from "../../sessions/ui/MarkdownDocumentPreview";

import {
  detectLineEnding,
  type LineEnding,
  normalizeLineBreaks,
  restoreLineEnding,
} from "../editor/editorDoc";

import { FilePreviewSearch } from "./FilePreviewSearch";
import { InlineBlameToggle, useInlineBlameUnavailableReason } from "./InlineBlameToggle";

import { CodeMirrorEditor, type EditorCarry } from "./CodeMirrorEditor";
import {
  fileSourceEditorKey,
  fileSourceEditorProps,
  type FileSourceEditorContract,
} from "./fileSourceEditorProps";
import {
  exactMountedEditorDraftReceipt,
  useMountedEditorClosure,
  type EditorWorkTicket,
  type MountedEditorObserver,
} from "./useMountedEditorClosure";
import { HtmlPreview } from "./HtmlPreview";
import { PreviewSelection } from "./PreviewSelection";
import { DocumentMessage } from "./DocumentMessage";
export { CodeMirrorEditor } from "./CodeMirrorEditor";
type EditorNavigationRequest = EditorNavigation & { token: number };

export { FILE_EDITOR_AUTOSAVE_DELAY_MS } from "../editor/editorTiming";

const REVEAL_LABEL = IS_MAC
  ? "Reveal in Finder"
  : IS_WIN
    ? "Reveal in File Explorer"
    : "Open Containing Folder";

type Props = {
  path: string;
  /** Stable tab identity; filesystem relocation changes the path, not this document. */
  documentId?: string;
  recoveredEditorDraft?: RecoveredEditorDraft;
  cwd: string;
  active: boolean;
  /** False while another tab of the pane, or the hidden pane itself, covers this
   * editor: git and disk reloads wait and run once when it is shown again. */
  shown?: boolean;
  showDiff?: boolean;
  /** The side the Changes panel opened; saves looking it up before the first diff. */
  changeKind?: GitFileDiffKind;
  navigation?: EditorNavigationRequest | null;
  onDirtyChange: (path: string, dirty: boolean) => void;
  onErrorCountChange?: (path: string, count: number) => void;
  onOpenFile?: OpenFileFn;
};

type LoadState =
  | { status: "loading" }
  | { status: "ready"; content: string }
  | { status: "error"; message: string };

type SaveState = { status: "idle" | "saving" | "saved" } | { status: "error"; message: string };

export function FileEditor({
  path,
  documentId: suppliedDocumentId,
  recoveredEditorDraft,
  cwd,
  active,
  shown = true,
  showDiff = false,
  changeKind,
  navigation,
  onDirtyChange,
  onErrorCountChange,
  onOpenFile,
}: Props) {
  useLocale();
  const fallbackDocument = useRef({ path, id: crypto.randomUUID() });
  if (!suppliedDocumentId && fallbackDocument.current.path !== path)
    fallbackDocument.current = { path, id: crypto.randomUUID() };
  const documentId = suppliedDocumentId ?? fallbackDocument.current.id;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  /** Work skipped while hidden, replayed once on show. */
  const deferred = useRef({ git: false, disk: false, load: false });
  // The path whose "before" side has been looked up, found or not. Until then
  // the editor is not drawn: showing it plain first means tearing it down and
  // building the side-by-side pair a moment later.
  const [gitSettledPath, setGitSettledPath] = useState<string | null>(null);
  const changeKindRef = useRef(changeKind);
  changeKindRef.current = changeKind;
  const reloadGitRef = useRef<(() => void) | null>(null);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const [reloadKey, setReloadKey] = useState(0);
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [diskConflict, setDiskConflict] = useState(false);
  const [diskVerificationError, setDiskVerificationError] = useState<string | null>(null);
  const [editorRevision, setEditorRevision] = useState(0);
  const retainedEditor = useMemo(
    () => ({ current: null as EditorCarry | null }),
    [documentId, reloadKey, editorRevision],
  );
  const [recoveredText, setRecoveredText] = useState<string | undefined>();
  const recoveryReviewRef = useRef(false);
  const draftHandleRef = useRef<EditorDraftDocument | null>(null);
  const [draftPersistence, setDraftPersistence] = useState<NativeCaptureState | null>(null);
  const [draftAction, setDraftAction] = useState<"restore" | "replace" | null>(null);
  const draftActionRef = useRef(false);
  const draftViewGeneration = useRef(0);
  const [draftActionError, setDraftActionError] = useState<string | null>(null);
  const editorRootRef = useRef<HTMLDivElement>(null);
  const manualSaveRef = useRef(false);
  const [gitBase, setGitBase] = useState<{
    path: string;
    original: string;
    kind: GitFileDiffKind;
    lineEnding: LineEnding;
    eolOnly: boolean;
  } | null>(null);
  const markdown = isMarkdownPath(path);
  const svg = isSvgPath(path);
  const html = /\.html?$/i.test(basename(path));
  const saveRequestRef = useRef<((parent?: EditorWorkTicket) => Promise<boolean>) | null>(null);
  const editorAdmissionRef = useRef<MountedEditorObserver | null>(null);
  const requestSave = useCallback(async () => {
    if (manualSaveRef.current || !saveRequestRef.current) return;
    const ticket = editorAdmissionRef.current?.operation("manual-save");
    if (editorAdmissionRef.current && !ticket) return;
    manualSaveRef.current = true;
    try {
      await saveRequestRef.current(ticket ?? undefined);
    } finally {
      manualSaveRef.current = false;
      ticket?.();
    }
  }, []);
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        isImeComposition(event) ||
        hasActiveOverlay() ||
        event.altKey ||
        event.shiftKey ||
        !(IS_MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) ||
        (event.key.toLowerCase() !== "s" && event.code !== "KeyS")
      )
        return;
      const target = event.target instanceof Element ? event.target : null;
      // Leave other editors, composers and dialogs in charge of their own saves.
      const inEditor = !!target && editorRootRef.current?.contains(target);
      const inExplorer = !!target?.closest('[role="tree"], [data-explorer-root]');
      if (!inEditor && !inExplorer && target !== document.body) return;
      if (!saveRequestRef.current) return;
      event.preventDefault();
      if (!event.repeat) void requestSave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, requestSave]);
  const openingRef = useRef(false);
  const [openingChrome, setOpeningChrome] = useState(false);
  // The message belongs to the path it was raised for, so another file shows none.
  const [chromeFailure, setChromeFailure] = useState<{ path: string; message: string } | null>(
    null,
  );
  const chromeError = chromeFailure?.path === path ? chromeFailure.message : null;
  const setChromeError = (message: string | null) =>
    setChromeFailure(message === null ? null : { path, message });
  const goLive = async () => {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpeningChrome(true);
    setChromeError(null);
    try {
      if (pendingDiskRef.current) {
        throw new Error("This file changed on disk. Reload or save it before opening Chrome.");
      }
      if (dirtyRef.current && !(await saveRequestRef.current?.())) {
        throw new Error("Save the file successfully before opening Chrome.");
      }
      await saveQueue.current;
      await openHtmlInChrome(path);
    } catch (error) {
      setChromeError(error instanceof Error ? error.message : String(error));
    } finally {
      openingRef.current = false;
      setOpeningChrome(false);
    }
  };
  // Review tabs keep their own preference and expose the diff gutter by default.
  const [mode, setMode] = useMarkdownMode(
    showDiff ? `review:${path}` : path,
    showDiff ? "source" : "preview",
  );
  const setLoadedMode = useRef(setMode);
  useLayoutEffect(() => {
    setLoadedMode.current = setMode;
  }, [setMode]);
  const sourceNavigationToken = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (
      !navigation ||
      (!markdown && !svg && !html) ||
      sourceNavigationToken.current === navigation.token
    )
      return;
    sourceNavigationToken.current = navigation.token;
    setMode("source");
  }, [markdown, svg, html, navigation, setMode]);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveGeneration = useRef(0);
  const loadGeneration = useRef(0);
  const dirtyRef = useRef(false);
  const pendingDiskRef = useRef(false);
  const diskChangeVersion = useRef(0);
  const overwriteVersion = useRef<number | null>(null);
  const editVersion = useRef(0);
  const currentIdentity = useRef({ path, documentId });
  currentIdentity.current = { path, documentId };
  /** The file's text as last read or written; tells real disk changes from no-op events. */
  const diskTextRef = useRef<string | null>(null);
  const draftBaselineRef = useRef<string | null>(null);
  const latestDocumentRef = useRef<string | Text | null>(null);
  const eolRef = useRef<LineEnding>("\n");
  const onDirtyChangeRef = useRef(onDirtyChange);
  const loadedDocumentRef = useRef<{ id: string; reloadKey: number } | null>(null);
  const renderedDocumentRef = useRef<string | null>(null);
  const [admissionRetry, setAdmissionRetry] = useState(0);
  onDirtyChangeRef.current = onDirtyChange;

  const editorClosure = useMountedEditorClosure(
    (view) => {
      const actual = view?.read();
      const baseline = draftBaselineRef.current;
      const latest = latestDocumentRef.current;
      const text = actual?.text ?? null;
      const eol = eolRef.current === "\r\n" ? "crlf" : eolRef.current === "\r" ? "cr" : "lf";
      const binding = draftHandleRef.current?.observe();
      const ack = binding?.acknowledgedDraft;
      const origin = isRemoteProjectPath(path) ? "remote" : isTauri() ? "local-native" : "web";
      const receipt = exactMountedEditorDraftReceipt(binding, {
        origin,
        documentId,
        path,
        text,
        eol,
        diskBaseline: baseline,
      });
      const exactAck = receipt !== null;
      let busy: string | undefined;
      if (!actual || loadState.status !== "ready" || baseline === null || latest === null)
        busy = "Editor view is not ready";
      else if (
        currentIdentity.current.documentId !== documentId ||
        currentIdentity.current.path !== path ||
        loadedDocumentRef.current?.id !== documentId ||
        loadedDocumentRef.current.reloadKey !== reloadKey ||
        (actual.kind === "source" && text !== latest.toString())
      )
        busy = "Editor document is changing";
      else if (actual.composing) busy = "Editor composition is pending";
      else if (binding && (binding.documentId !== documentId || binding.path !== path))
        busy = "Editor draft binding is changing";
      else if (
        actual.pendingAutosave ||
        manualSaveRef.current ||
        draftActionRef.current ||
        binding?.initializationDecisionRequired
      )
        busy = "Editor action is pending";
      const missing = ["editor-disk-freshness"];
      if (origin !== "local-native") missing.push(`editor-${origin}-origin`);
      if (
        !binding?.ownerEpoch ||
        binding.disposed ||
        binding.error ||
        binding.phase === "unknown" ||
        binding.phase === "stale-owner"
      )
        missing.push("editor-native-binding");
      if (!exactAck) missing.push("editor-exact-draft-ack");
      if (actual?.kind === "merge") missing.push("editor-merge-history");
      return {
        ...(busy ? { busy } : {}),
        missingCoverage: missing,
        snapshot: {
          version: 1,
          qualified: false,
          documentId,
          path,
          origin,
          text,
          eol,
          diskBaseline: baseline,
          dirty: dirtyRef.current,
          readOnly: actual?.readOnly ?? null,
          viewReady: !!actual,
          composing: actual?.composing ?? null,
          editorKind: actual?.kind ?? null,
          mergeState: actual?.mergeState ?? null,
          diskConflict: pendingDiskRef.current,
          recoveryReview: recoveryReviewRef.current,
          draftBinding: {
            ownerEpoch: binding?.ownerEpoch ?? null,
            documentId: binding?.documentId ?? null,
            path: binding?.path ?? null,
            phase: binding?.phase ?? "missing",
            pending: binding?.pending ?? false,
            disposed: binding?.disposed ?? false,
            initializationDecisionRequired: binding?.initializationDecisionRequired ?? false,
            error: binding?.error
              ? String((binding.error as Error & { code?: string }).code ?? binding.error.name)
              : null,
            knownRevision: ack?.revision ?? null,
            knownState: ack?.state ?? null,
            exactBodyAcknowledged: exactAck,
            receipt: receipt ? { ...receipt } : null,
          },
        },
      };
    },
    JSON.stringify([documentId, path]),
    () => {
      if (deferred.current.disk || deferred.current.git || deferred.current.load) {
        deferred.current.load = false;
        setAdmissionRetry((value) => value + 1);
      }
    },
  );
  useLayoutEffect(() => {
    editorAdmissionRef.current = editorClosure;
  });

  const captureRelocatedDraft = useEffectEvent((handle: EditorDraftDocument) => {
    if (
      isTauri() &&
      !isRemoteProjectPath(path) &&
      loadedDocumentRef.current?.id === documentId &&
      dirtyRef.current &&
      latestDocumentRef.current !== null &&
      draftBaselineRef.current !== null
    ) {
      // Relocation preserves the actual immutable dirty document and baseline.
      handle.capture({
        captureId: crypto.randomUUID(),
        text: latestDocumentRef.current,
        diskBaseline: draftBaselineRef.current,
        eol: eolRef.current === "\r\n" ? "crlf" : eolRef.current === "\r" ? "cr" : "lf",
      });
    }
  });
  useEffect(() => {
    draftViewGeneration.current += 1;
    setDraftAction(null);
    draftActionRef.current = false;
    setDraftActionError(null);
    const handle = bindEditorDraftDocument({
      documentId,
      path,
      origin: isRemoteProjectPath(path) ? "remote" : isTauri() ? "local-native" : "web",
    });
    draftHandleRef.current = handle;
    const update = () => {
      editorClosure.changed();
      // Keep the previous state object when nothing rendered from it changed
      // (per-keystroke captureId churn must not re-render the editor).
      const next = handle.observe();
      setDraftPersistence((prev) => (prev && sameDraftView(prev, next) ? prev : next));
    };
    const unsubscribe = handle.subscribe(update);
    update();
    editorClosure.external(() => captureRelocatedDraft(handle));
    void handle.ready.then(update, update);
    return () => {
      unsubscribe();
      if (draftHandleRef.current === handle) draftHandleRef.current = null;
      // The manager still owns accepted captures and uncertain Native calls.
      handle.dispose();
    };
  }, [documentId, path, editorClosure]);

  const captureDraft = useCallback(
    (text: string | Text) => {
      if (!editorClosure.allowed()) return;
      if (
        currentIdentity.current.path !== path ||
        currentIdentity.current.documentId !== documentId
      )
        return;
      latestDocumentRef.current = text;
      editorClosure.changed();
      // Remote files need their own Host-owned origin contract. A local window
      // receipt must not accidentally stand in for that contract.
      if (!isTauri() || isRemoteProjectPath(path)) return;
      const handle = draftHandleRef.current;
      const baseline = draftBaselineRef.current;
      if (!handle || baseline === null) return;
      const owner = handle.observe();
      if (owner.documentId !== documentId || owner.path !== path) return;
      return handle.capture({
        captureId: crypto.randomUUID(),
        text,
        diskBaseline: baseline,
        eol: eolRef.current === "\r\n" ? "crlf" : eolRef.current === "\r" ? "cr" : "lf",
      });
    },
    [documentId, path, editorClosure],
  );

  const applyDiskContent = useCallback(
    (raw: string) => {
      editorClosure.changed();
      // CodeMirror documents are LF-only; keep the editor in that convention
      // and restore the file's own line endings on save. Feeding CRLF text
      // into the LF document doubles every line (see editorDoc.ts).
      eolRef.current = detectLineEnding(raw);
      setDiskVerificationError(null);
      diskTextRef.current = raw;
      draftBaselineRef.current = raw;
      const content = normalizeLineBreaks(raw);
      latestDocumentRef.current = content;
      setLoadState((current) => {
        if (current.status === "ready" && current.content === content) {
          return current;
        }
        return { status: "ready", content };
      });
      setDraft(content);
    },
    [editorClosure],
  );

  const reloadFromDisk = useCallback(
    async (force = false, parent?: EditorWorkTicket) => {
      const settled = editorClosure.operation("disk-read", parent);
      if (!settled) {
        editorClosure.external(() => {
          deferred.current.disk = true;
          if (dirtyRef.current) {
            pendingDiskRef.current = true;
            diskChangeVersion.current += 1;
            setDiskConflict(true);
          }
        });
        return;
      }
      const generation = ++loadGeneration.current;
      const edits = editVersion.current;
      try {
        const content = await readTextFile(path);
        settled.apply(() => {
          if (
            generation !== loadGeneration.current ||
            currentIdentity.current.path !== path ||
            currentIdentity.current.documentId !== documentId
          )
            return;
          // A reload choice applies only to the draft the owner saw when choosing it.
          if (force && edits !== editVersion.current) return;
          if (dirtyRef.current && !force) {
            // Keep unsaved edits; only a real change on disk blocks saving over it.
            pendingDiskRef.current =
              content !==
              (recoveryReviewRef.current ? draftBaselineRef.current : diskTextRef.current);
            setDiskConflict(pendingDiskRef.current);
            return;
          }
          pendingDiskRef.current = false;
          setDiskConflict(false);
          if (force && dirtyRef.current) {
            setRecoveredText(undefined);
            recoveryReviewRef.current = false;
            dirtyRef.current = false;
            setDirty(false);
            onDirtyChangeRef.current(path, false);
            setEditorRevision((value) => value + 1);
          }
          applyDiskContent(content);
          if (force) captureDraft(normalizeLineBreaks(content));
        });
      } catch (error: unknown) {
        if (
          generation !== loadGeneration.current ||
          currentIdentity.current.path !== path ||
          currentIdentity.current.documentId !== documentId
        )
          return;
        if (dirtyRef.current && !force) {
          pendingDiskRef.current = true;
          setDiskConflict(true);
          return;
        }
        if (force && dirtyRef.current) {
          setSaveState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
          return;
        }
        setLoadState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        settled();
      }
    },
    [applyDiskContent, captureDraft, documentId, path, editorClosure],
  );

  useEffect(() => {
    const loaded = loadedDocumentRef.current;
    if (loaded?.id === documentId && loaded.reloadKey === reloadKey) return;
    const settled = editorClosure.operation("document-load");
    if (!settled) {
      deferred.current.load = true;
      setLoadState((current) => (current.status === "loading" ? current : { status: "loading" }));
      return;
    }
    setRecoveredText(undefined);
    recoveryReviewRef.current = false;
    dirtyRef.current = false;
    setDirty(false);
    pendingDiskRef.current = false;
    setDiskConflict(false);
    overwriteVersion.current = null;
    let cancelled = false;
    setLoadState({ status: "loading" });
    setSaveState({ status: "idle" });
    const generation = ++loadGeneration.current;
    void (async () => {
      if (recoveredEditorDraft) {
        if (recoveredEditorDraft.documentId !== documentId || recoveredEditorDraft.path !== path)
          throw new Error(t("The recovery copy does not match this document."));
        const record = await readEditorDraftRecovery({
          ownerId: recoveredEditorDraft.ownerEpoch,
          documentId,
          revision: recoveredEditorDraft.revision,
          payloadDigest: recoveredEditorDraft.payloadDigest,
        });
        const handle = draftHandleRef.current;
        if (!handle) throw new Error(t("The recovery window is no longer available."));
        await handle.ready;
        const verifyLane = () => {
          const state = handle.observe();
          const acknowledged = state.acknowledgedDraft;
          if (
            state.ownerEpoch !== recoveredEditorDraft.ownerEpoch ||
            state.pending ||
            state.error ||
            state.disposed ||
            !acknowledged ||
            acknowledged.revision !== recoveredEditorDraft.revision ||
            acknowledged.payloadDigest !== recoveredEditorDraft.payloadDigest
          )
            throw new Error(
              t("Open the latest copy again from Recovery. Newer edits may still be pending."),
            );
        };
        verifyLane();
        let actual: string | null = null;
        let diskError: string | null = null;
        try {
          actual = await readTextFile(path);
        } catch (error) {
          diskError = error instanceof Error ? error.message : String(error);
        }
        if (cancelled || generation !== loadGeneration.current) return;
        verifyLane();
        const state = handle.observe();
        if (state.initializationDecisionRequired)
          handle.resolveInitialization({
            decision: "restore",
            revision: record.metadata.revision,
            payloadDigest: record.metadata.payloadDigest,
          });
        const payload = record.payload;
        diskTextRef.current = actual;
        draftBaselineRef.current = payload.diskBaseline;
        latestDocumentRef.current = payload.text;
        eolRef.current = payload.eol === "crlf" ? "\r\n" : payload.eol === "cr" ? "\r" : "\n";
        pendingDiskRef.current = actual === null || actual !== payload.diskBaseline;
        if (pendingDiskRef.current) diskChangeVersion.current += 1;
        setDiskConflict(pendingDiskRef.current);
        setDiskVerificationError(diskError);
        recoveryReviewRef.current = true;
        setRecoveredText(payload.text);
        setDraft(payload.text);
        setLoadedMode.current("source");
        loadedDocumentRef.current = { id: documentId, reloadKey };
        setLoadState({ status: "ready", content: normalizeLineBreaks(payload.diskBaseline) });
      } else {
        const content = await readTextFile(path);
        if (cancelled || generation !== loadGeneration.current) return;
        loadedDocumentRef.current = { id: documentId, reloadKey };
        settled.apply(() => applyDiskContent(content));
      }
    })()
      .catch((error: unknown) => {
        if (cancelled || generation !== loadGeneration.current) return;
        setLoadState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(settled);
    return () => {
      cancelled = true;
    };
  }, [
    applyDiskContent,
    documentId,
    path,
    reloadKey,
    recoveredEditorDraft,
    editorClosure,
    admissionRetry,
  ]);

  useEffect(() => {
    if (!showDiff) {
      setGitBase(null);
      return;
    }
    const relative = displayPath(path, cwd);
    if (!cwd || cwd === "~" || !relative || relative === path) {
      setGitBase(null);
      return;
    }
    let cancelled = false;
    let generation = 0;
    setGitBase(null);

    const listed = async () => {
      const { files } = await gitDiffFiles(cwd);
      return files.find((entry) => entry.relative === relative);
    };

    // Until a diff has arrived, a load takes the side the Changes panel named
    // and asks git for that diff alone. A later reload follows the file:
    // staging it moves the diff to the staged side instead of leaving an
    // empty one.
    let shown = false;
    const load = () => {
      const request = ++generation;
      const first = !shown;
      return (async () => {
        const opened = changeKindRef.current;
        let file = first && opened ? undefined : await listed();
        const kind: GitFileDiffKind =
          first && opened
            ? opened
            : opened === "staged" && file?.staged
              ? "staged"
              : opened === "unstaged" && file?.unstaged
                ? "unstaged"
                : file?.staged && !file.unstaged
                  ? "staged"
                  : "unstaged";
        const diff = await gitFileDiff(cwd, relative, kind);
        if (cancelled || request !== generation) return;
        shown = true;
        if (diff.binary || diff.tooLarge) {
          setGitBase(null);
          setGitSettledPath(path);
          return;
        }
        const original = normalizeLineBreaks(diff.original);
        // Normalized equality alone cannot distinguish autocrlf from a real
        // change, so only then is git asked whether it lists the file.
        const eolDiffers =
          diff.original !== diff.current && original === normalizeLineBreaks(diff.current);
        if (eolDiffers && first && opened) {
          file = await listed();
          if (cancelled || request !== generation) return;
        }
        setGitBase({
          path,
          original,
          kind,
          lineEnding: detectLineEnding(diff.original || diff.current),
          eolOnly: !!(file?.staged || file?.unstaged) && eolDiffers,
        });
        setGitSettledPath(path);
      })().catch(() => {
        if (cancelled || request !== generation) return;
        shown = true;
        setGitBase(null);
        setGitSettledPath(path);
      });
    };

    load();
    reloadGitRef.current = load;
    const onFocus = () => {
      if (!shownRef.current) deferred.current.git = true;
      else if (!document.hidden) load();
    };
    const onGit = onFocus;
    let timer = 0;
    const queued = new Set<EditorWorkTicket>();
    const onDisk = () => {
      const accepted = editorClosure.operation("diff-watch-reconcile");
      if (!accepted) {
        editorClosure.external(() => {
          deferred.current.git = true;
          deferred.current.disk = true;
          if (dirtyRef.current) {
            pendingDiskRef.current = true;
            diskChangeVersion.current += 1;
            setDiskConflict(true);
          }
        });
        return;
      }
      if (!shownRef.current) {
        deferred.current.git = true;
        deferred.current.disk = true;
        accepted();
        return;
      }
      queued.add(accepted);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const original = [...queued];
        queued.clear();
        timer = 0;
        void Promise.allSettled([load(), reloadFromDisk(false, original[0])]).then(() =>
          original.forEach((ticket) => ticket()),
        );
      }, 50);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const unsubGit = subscribeGitChanged(onGit, { cwd });
    const unsubWatch = watchFile(path, onDisk);
    return () => {
      cancelled = true;
      reloadGitRef.current = null;
      window.clearTimeout(timer);
      for (const ticket of queued) ticket();
      queued.clear();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      unsubGit();
      unsubWatch();
    };
  }, [cwd, path, reloadFromDisk, showDiff, editorClosure]);

  // Picking the file's other side in the Changes panel reuses this editor.
  const shownChangeKind = useRef(changeKind);
  useEffect(() => {
    if (shownChangeKind.current === changeKind) return;
    shownChangeKind.current = changeKind;
    reloadGitRef.current?.();
  }, [changeKind]);

  const gitDiff = gitBase?.path === path ? gitBase : null;
  const gitOriginal = gitDiff?.original ?? null;

  useEffect(() => {
    if (loadState.status !== "ready") return;
    let timer = 0;
    const queued = new Set<EditorWorkTicket>();
    const stop = watchFile(path, () => {
      const accepted = editorClosure.operation("watch-reconcile");
      if (!accepted) {
        editorClosure.external(() => {
          deferred.current.disk = true;
          if (dirtyRef.current) {
            pendingDiskRef.current = true;
            diskChangeVersion.current += 1;
            setDiskConflict(true);
          }
        });
        return;
      }
      if (dirtyRef.current) {
        // Block saving at once, then clear it if the text on disk is unchanged.
        pendingDiskRef.current = true;
        diskChangeVersion.current += 1;
        // Even while hidden: autosave stays blocked until this read clears it.
        void reloadFromDisk(false, accepted).finally(accepted);
        return;
      }
      if (!shownRef.current) {
        deferred.current.disk = true;
        accepted();
        return;
      }
      queued.add(accepted);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const original = [...queued];
        queued.clear();
        timer = 0;
        void reloadFromDisk(false, original[0]).finally(() =>
          original.forEach((ticket) => ticket()),
        );
      }, 50);
    });
    return () => {
      window.clearTimeout(timer);
      for (const ticket of queued) ticket();
      queued.clear();
      stop();
    };
  }, [loadState.status, path, reloadFromDisk, editorClosure]);

  // Catch up once on what changed while another tab was in front.
  useEffect(() => {
    if (!shown || editorClosure.closed()) return;
    const pending = deferred.current;
    if (pending.git) reloadGitRef.current?.();
    if (pending.disk) void reloadFromDisk();
    pending.git = false;
    pending.disk = false;
  }, [shown, reloadFromDisk, editorClosure, admissionRetry]);

  const save = useCallback(
    async (content: string, parent?: EditorWorkTicket) => {
      // Capture this exact write before queueing or awaiting filesystem work.
      const settled = editorClosure.operation("filesystem-save", parent);
      if (!settled) throw new Error(t("Preparing checkpoint…"));
      const capture = settled.apply(() => captureDraft(content));
      const draftHandle = draftHandleRef.current;
      const generation = ++saveGeneration.current;
      const allowedOverwrite = overwriteVersion.current;
      overwriteVersion.current = null;
      // Do not let an older watcher read replace the baseline of this save.
      loadGeneration.current += 1;
      setSaveState({ status: "saving" });
      const serializedContent = restoreLineEnding(content, eolRef.current);
      const operation = saveQueue.current.then(() => {
        if (pendingDiskRef.current && allowedOverwrite !== diskChangeVersion.current) {
          setDiskConflict(true);
          throw new Error("The file changed on disk. Choose reload or overwrite before saving.");
        }
        return writeTextFile(path, serializedContent);
      });
      saveQueue.current = operation.catch((error) => {
        console.warn("FileEditor operation failed", error);
      });
      try {
        await operation;
        if (capture && draftHandle) {
          // Native reporting is independent of the completed filesystem write.
          // A retry here must never repeat writeTextFile.
          void draftHandle.reportSaved(capture).catch(() => {});
        }
        if (
          currentIdentity.current.path !== path ||
          currentIdentity.current.documentId !== documentId
        )
          return;
        settled.apply(() => {
          recoveryReviewRef.current = false;
          diskTextRef.current = serializedContent;
          setDiskVerificationError(null);
          draftBaselineRef.current = serializedContent;
          pendingDiskRef.current = false;
          setDiskConflict(false);
          // Keep the reload prop at the saved baseline, so restoring the initial
          // text still changes it. CodeMirror preserves any newer dirty edits.
          setLoadState((current) =>
            current.status === "ready" ? { status: "ready", content } : current,
          );
        });
        await syncWatchedMtime(path);
        notifyGitChanged(cwd, "index");
        if (generation === saveGeneration.current) {
          setSaveState({ status: "saved" });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (generation === saveGeneration.current) {
          setSaveState({ status: "error", message });
        }
        throw error;
      } finally {
        settled();
      }
    },
    [cwd, path, documentId, captureDraft, editorClosure],
  );

  // Another editor on this file, showing the same text, wrote `content`: adopt
  // it as the disk baseline as this editor's own save would, so that write is
  // not mistaken for a change on disk.
  const peerSaved = useCallback(
    (content: string) => {
      const latest = latestDocumentRef.current;
      const serializedContent = restoreLineEnding(content, eolRef.current);
      loadGeneration.current += 1;
      recoveryReviewRef.current = false;
      diskTextRef.current = serializedContent;
      setDiskVerificationError(null);
      draftBaselineRef.current = serializedContent;
      pendingDiskRef.current = false;
      setDiskConflict(false);
      setLoadState((current) =>
        current.status === "ready" ? { status: "ready", content } : current,
      );
      const draftHandle = draftHandleRef.current;
      const capture = captureDraft(content);
      if (capture && draftHandle) void draftHandle.reportSaved(capture).catch(() => {});
      // Text typed after that save is still a draft here.
      if (latest !== null && latest.toString() !== content) captureDraft(latest);
      setSaveState({ status: "saved" });
    },
    [captureDraft],
  );

  const stageGit = useCallback(
    async (contents: string) => {
      const relative = displayPath(path, cwd);
      if (!cwd || cwd === "~" || !relative || relative === path) {
        throw new Error("Can't stage this file");
      }
      if (!gitDiff || gitDiff.kind !== "unstaged") {
        throw new Error("Only unstaged changes can be staged");
      }
      try {
        // Keep the index convention outside the selected text hunk.
        await gitStageContents(
          cwd,
          relative,
          restoreLineEnding(contents, gitDiff.lineEnding),
          restoreLineEnding(gitDiff.original, gitDiff.lineEnding),
        );
        notifyGitChanged(cwd, "index");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setSaveState({ status: "error", message });
        throw error;
      }
    },
    [cwd, path, gitDiff],
  );

  const dirtyChange = useCallback(
    (dirty: boolean) => {
      dirtyRef.current = dirty;
      setDirty(dirty);
      onDirtyChange(path, dirty);
      if (dirty) {
        setSaveState((current) => (current.status === "saving" ? current : { status: "idle" }));
        return;
      }
      if (pendingDiskRef.current) {
        pendingDiskRef.current = false;
        void reloadFromDisk();
      }
    },
    [onDirtyChange, path, reloadFromDisk],
  );

  const errorCountChange = useCallback(
    (count: number) => onErrorCountChange?.(path, count),
    [onErrorCountChange, path],
  );
  const edited = useCallback(() => {
    editVersion.current += 1;
  }, []);
  // Only previews read the draft; copying the whole text and re-rendering on
  // every keystroke is skipped while the source is what is on screen.
  const docChange = mode === "preview" ? setDraft : undefined;

  const resolveDraft = async (decision: "restore" | "replace") => {
    const handle = draftHandleRef.current;
    const record = draftPersistence?.currentDraft;
    if (!handle || !record || draftActionRef.current) return;
    const identity = handle.observe();
    if (identity.documentId !== documentId || identity.path !== path) return;
    const generation = draftViewGeneration.current;
    const settled = editorClosure.operation("draft-decision");
    if (!settled) {
      setDraftActionError(t("The editor is busy closing or moving. Try again in a moment."));
      return;
    }
    draftActionRef.current = true;
    setDraftAction(decision);
    setDraftActionError(null);
    try {
      if (decision === "restore" && dirtyRef.current) {
        throw new Error(t("Keep or save your current edits before restoring this draft."));
      }
      handle.resolveInitialization({
        decision,
        revision: record.metadata.revision,
        payloadDigest: record.metadata.payloadDigest,
      });
      if (decision === "restore") {
        const payload = record.payload;
        // Keep the original disk baseline distinct from the recovered document.
        // A changed disk file still requires the existing overwrite choice.
        draftBaselineRef.current = payload.diskBaseline;
        pendingDiskRef.current = diskTextRef.current !== payload.diskBaseline;
        if (pendingDiskRef.current) diskChangeVersion.current += 1;
        setDiskConflict(pendingDiskRef.current);
        eolRef.current = payload.eol === "crlf" ? "\r\n" : payload.eol === "cr" ? "\r" : "\n";
        recoveryReviewRef.current = true;
        setLoadState({ status: "ready", content: normalizeLineBreaks(payload.diskBaseline) });
        setDraft(payload.text);
        setRecoveredText(payload.text);
        setEditorRevision((value) => value + 1);
        setMode("source");
        captureDraft(payload.text);
      } else {
        const text = latestDocumentRef.current;
        if (text !== null) captureDraft(text);
      }
      await handle.flush();
    } catch (error) {
      if (generation === draftViewGeneration.current)
        setDraftActionError(error instanceof Error ? error.message : String(error));
    } finally {
      settled();
      if (generation === draftViewGeneration.current) {
        draftActionRef.current = false;
        setDraftAction(null);
      }
    }
  };

  const retryDraft = async () => {
    if (draftActionRef.current) return;
    const generation = draftViewGeneration.current;
    const settled = editorClosure.operation("draft-retry");
    if (!settled) {
      setDraftActionError(t("The editor is busy closing or moving. Try again in a moment."));
      return;
    }
    draftActionRef.current = true;
    setDraftAction("replace");
    setDraftActionError(null);
    try {
      await draftHandleRef.current?.retry();
    } catch (error) {
      if (generation === draftViewGeneration.current)
        setDraftActionError(error instanceof Error ? error.message : String(error));
    } finally {
      settled();
      if (generation === draftViewGeneration.current) {
        draftActionRef.current = false;
        setDraftAction(null);
      }
    }
  };

  const relativePath = path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path;
  const footerBlameReason = useInlineBlameUnavailableReason(cwd, path);
  const diffRelative = showDiff ? displayPath(path, cwd) : "";
  const diffPending =
    showDiff &&
    !!cwd &&
    cwd !== "~" &&
    !!diffRelative &&
    diffRelative !== path &&
    gitSettledPath !== path &&
    renderedDocumentRef.current !== documentId;

  if (loadState.status === "loading" || diffPending) {
    return (
      <div
        role="status"
        className="grid h-full min-w-0 place-items-center p-3 text-ui-caption text-(--ui-text-muted)"
      >
        <span className="max-w-full break-words text-center">
          {t("Opening ")}
          {basename(path)}…
        </span>
      </div>
    );
  }

  if (loadState.status === "error") {
    return (
      <div className="grid h-full place-items-center p-6">
        <Alert tone="danger" className="max-w-md" title={`${t("Couldn’t open ")}${basename(path)}`}>
          <p>{loadState.message}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              motion="none"
              type="button"
              onClick={() => setReloadKey((value) => value + 1)}
              className="shrink-0"
            >
              <RotateCcw className="icon-xs" strokeWidth={1.75} />
              {t("Retry")}
            </Button>
            {isRemoteProjectPath(path) ? null : (
              <Button
                size="sm"
                variant="ghost"
                motion="none"
                type="button"
                onClick={() =>
                  void revealPath(path).catch((error) => {
                    console.warn("FileEditor operation failed", error);
                  })
                }
                className="shrink-0"
              >
                <Folder className="icon-xs" strokeWidth={1.75} />
                {REVEAL_LABEL}
              </Button>
            )}
          </div>
        </Alert>
      </div>
    );
  }

  renderedDocumentRef.current = documentId;
  const saveAction = (
    <Button
      size="sm"
      variant={dirty || saveState.status === "error" ? "secondary" : "ghost"}
      aria-label={t("Save")}
      tooltip={t("Save")}
      shortcut="Mod+S"
      disabled={editorClosure.closed() || (!dirty && saveState.status !== "error")}
      loading={saveState.status === "saving"}
      loadingLabel={t("Saving…")}
      onClick={() => void requestSave()}
      className="shrink-0"
    >
      <Save className="icon-sm" />
      {t("Save")}
    </Button>
  );
  const saveStatus = (
    <span
      role="status"
      aria-live="polite"
      className={
        saveState.status === "error"
          ? "min-w-0 basis-full break-words py-1 text-(--ui-tone-danger-fg)"
          : "min-w-0 max-w-64 truncate"
      }
      title={saveState.status === "error" ? saveState.message : undefined}
    >
      {editorClosure.closed() ? (
        <span>{t("Preparing checkpoint…")}</span>
      ) : saveState.status === "saving" ? (
        <span>{t("Saving…")}</span>
      ) : saveState.status === "saved" && !dirty ? (
        <span>{t("Saved")}</span>
      ) : saveState.status === "error" ? (
        <span>
          {t("Save failed: ")}
          {saveState.message}
        </span>
      ) : dirty ? (
        <span className="sr-only">{t("Unsaved changes")}</span>
      ) : null}
    </span>
  );
  const hasMarkdownShell = Boolean(markdown || svg || html);
  // One document/save/recovery/capture binding list for the plain file and the
  // Markdown/SVG/HTML Source pane; they differ only in the view arguments below.
  const sourceEditorKey = fileSourceEditorKey(documentId, reloadKey, editorRevision);
  const sourceEditorContract: FileSourceEditorContract = {
    path,
    cwd,
    relativePath,
    content: loadState.content,
    initialDraft: recoveredText,
    recoveryReviewRef,
    pendingDiskRef,
    retainedState: retainedEditor,
    showDiff,
    gitOriginal,
    navigation,
    onDirtyChange: dirtyChange,
    onErrorCountChange: errorCountChange,
    onSave: save,
    onPeerSaved: peerSaved,
    saveRequestRef,
    onStageGit: showDiff && gitDiff?.kind === "unstaged" ? stageGit : undefined,
    onDocumentChange: captureDraft,
    captureObserver: editorClosure,
    onEdit: edited,
    onOpenFile,
  };

  return (
    <div ref={editorRootRef} className="flex h-full min-h-0 min-w-0 flex-col">
      {draftPersistence?.initializationDecisionRequired ? (
        <div
          role="status"
          className="flex shrink-0 flex-wrap items-center gap-2 border-b border-stroke px-2.5 py-1 text-ui-caption text-content"
        >
          <span className="min-w-0 flex-1">
            {t(
              "A saved draft is available. Restoring keeps its original disk baseline; review it before saving.",
            )}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={dirty}
            loading={draftAction === "restore"}
            onClick={() => void resolveDraft("restore")}
          >
            {t("Restore draft")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={draftAction === "replace"}
            disabled={draftAction === "restore"}
            onClick={() => void resolveDraft("replace")}
          >
            {t("Use current document")}
          </Button>
        </div>
      ) : null}
      {draftActionError || (draftPersistence?.error && draftPersistence.phase !== "unsupported") ? (
        <div
          role="alert"
          className="flex shrink-0 flex-wrap items-center gap-2 border-b border-stroke px-2.5 py-1 text-ui-caption text-(--ui-tone-danger-fg)"
        >
          <span className="min-w-0 flex-1 break-words">
            {draftActionError ??
              t("Draft recovery copy could not be confirmed. Keep this editor open.")}
          </span>
          {!draftPersistence?.initializationDecisionRequired &&
          draftPersistence?.phase !== "stale-owner" ? (
            <Button
              size="sm"
              variant="ghost"
              loading={draftAction !== null}
              onClick={() => void retryDraft()}
            >
              {t("Retry draft copy")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {diskConflict && (
        <div
          role="alert"
          className="flex shrink-0 flex-wrap items-center gap-2 border-b border-stroke px-2.5 py-1 text-ui-caption text-content"
        >
          <span className="min-w-0 flex-1">
            {diskVerificationError
              ? t(
                  "The disk version could not be verified. Reload reads it again; overwrite writes the recovered draft.",
                )
              : t(
                  "File changed on disk. Reload discards your edits; overwrite replaces the disk version.",
                )}
          </span>
          <Button
            size="sm"
            variant="ghost"
            tone="danger"
            disabled={saveState.status === "saving"}
            onClick={() => void reloadFromDisk(true)}
          >
            {t("Reload from disk")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            tone="danger"
            disabled={saveState.status === "saving"}
            onClick={() => {
              overwriteVersion.current = diskChangeVersion.current;
              void requestSave().finally(() => {
                overwriteVersion.current = null;
              });
            }}
          >
            {t("Overwrite disk version")}
          </Button>
        </div>
      )}
      {showDiff && gitDiff?.eolOnly && (
        <p
          role="status"
          className="shrink-0 border-b border-stroke px-3 py-1 text-ui-secondary text-(--ui-text-secondary)"
        >
          {gitDiff.kind === "staged" ? t("Staged") : t("Unstaged")}
          {t(" line-ending changes. Line breaks are normalized in this view.")}
        </p>
      )}
      {hasMarkdownShell ? (
        <MarkdownViewShell
          mode={mode}
          onModeChange={setMode}
          leading={
            <>
              {saveAction}
              {saveStatus}
            </>
          }
          preview={
            markdown ? (
              <PreviewSelection
                active={active && mode === "preview"}
                path={displayPath(path, cwd)}
                contentVersion={draft}
              >
                <FilePreviewSearch active={active && mode === "preview"} contentVersion={draft}>
                  <MarkdownDocumentPreview
                    text={draft}
                    documentPath={path}
                    metadataLabel={t("Properties")}
                    cwd={cwd}
                    onOpenFile={onOpenFile}
                  />
                </FilePreviewSearch>
              </PreviewSelection>
            ) : html ? (
              <HtmlPreview path={path} source={draft} active={active && mode === "preview"} />
            ) : (
              <SvgPreview source={draft} name={basename(path)} />
            )
          }
          source={
            <div
              data-file-editor-source-active={shown && mode === "source" ? "true" : "false"}
              inert={!shown || mode !== "source"}
              className="flex h-full min-h-0 min-w-0 flex-col"
            >
              <CodeMirrorEditor
                key={sourceEditorKey}
                {...fileSourceEditorProps(sourceEditorContract, {
                  active: active && mode === "source",
                  shown: shown && mode === "source",
                  onDocChange: docChange,
                })}
              />
            </div>
          }
        />
      ) : (
        <CodeMirrorEditor
          key={sourceEditorKey}
          {...fileSourceEditorProps(sourceEditorContract, { active, shown })}
        />
      )}
      {chromeError ? (
        <InlineError className="shrink-0 border-t border-stroke px-2.5 py-1">
          {chromeError}
        </InlineError>
      ) : null}
      <footer
        className={`flex min-h-[var(--ui-control-height-compact)] shrink-0 items-center gap-1 border-t border-stroke px-2.5 text-ui-micro text-[var(--ui-text-muted)] ${saveState.status === "error" ? "flex-wrap" : ""}`}
      >
        <Tooltip label={path} when={path === relativePath ? "overflow" : "always"}>
          <span className="min-w-0 flex-1 truncate font-mono">{relativePath}</span>
        </Tooltip>
        {html ? (
          <Button
            size="sm"
            iconOnly
            label={REVEAL_LABEL}
            variant="ghost"
            motion="none"
            type="button"
            disabled={isRemoteProjectPath(path)}
            onClick={() =>
              void revealPath(path).catch((error: unknown) => setChromeError(String(error)))
            }
            tooltip={REVEAL_LABEL}
            aria-label={REVEAL_LABEL}
          >
            <Folder className="icon-sm" />
          </Button>
        ) : null}
        {html ? (
          <Button
            size="sm"
            variant="ghost"
            motion="none"
            type="button"
            disabled={openingChrome || isRemoteProjectPath(path)}
            loading={openingChrome}
            onClick={() => void goLive()}
            tooltip={
              isRemoteProjectPath(path)
                ? t("Go Live is available for local HTML files.")
                : t("Save and open this HTML file in Google Chrome")
            }
            className="shrink-0"
          >
            {t("Go Live")}
          </Button>
        ) : null}
        <InlineBlameToggle reason={footerBlameReason} />
        {hasMarkdownShell ? null : saveAction}
        {hasMarkdownShell ? null : saveStatus}
      </footer>
    </div>
  );
}

/**
 * SVG is text, so it stays editable in CodeMirror and renders through an
 * `<img>` rather than inline. In that context the webview runs no script and
 * fetches no external reference the document asks for, which is what makes it
 * safe to preview a file the agent may have just written.
 */
function SvgPreview({ source, name }: { source: string; name: string }) {
  useLocale();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    const next = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [source]);

  if (!source.trim()) return <DocumentMessage title={t("Empty file")} />;
  if (failed)
    return (
      <DocumentMessage title={t("Couldn’t read this document")} error>
        {name}
      </DocumentMessage>
    );
  if (!url) return null;
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label={name}
      className="grid h-full min-w-0 place-items-center overflow-auto p-6"
    >
      <img
        src={url}
        alt={name}
        onError={() => setFailed(true)}
        className="max-h-full max-w-full object-contain"
      />
    </div>
  );
}

function sameDraftView(a: NativeCaptureState, b: NativeCaptureState): boolean {
  return (
    a.phase === b.phase &&
    a.pending === b.pending &&
    a.error === b.error &&
    a.disposed === b.disposed &&
    a.path === b.path &&
    a.ownerEpoch === b.ownerEpoch &&
    a.currentDraft === b.currentDraft &&
    a.acknowledgedDraft === b.acknowledgedDraft &&
    a.initializationDecisionRequired === b.initializationDecisionRequired
  );
}

function isSvgPath(path: string): boolean {
  return basename(path).toLowerCase().endsWith(".svg");
}

function isMarkdownPath(path: string): boolean {
  const name = basename(path).toLowerCase();
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  return [".md", ".mdx", ".markdown"].includes(extension);
}
