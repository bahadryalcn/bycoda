import { t, useLocale } from "../../../shared/i18n/technical";
import { AlertCircle, Folder, RotateCcw } from "../../../shared/ui/icons";
import { IS_MAC, IS_WIN } from "../../../platform/tauri/platform";
import { isRemoteProjectPath } from "../../projects/model/recents";

import { useCallback, useEffect, useRef, useState } from "react";
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

import { CodeMirrorEditor } from "./CodeMirrorEditor";
import { HtmlPreview } from "./HtmlPreview";
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
  cwd: string;
  active: boolean;
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
  cwd,
  active,
  showDiff = false,
  changeKind,
  navigation,
  onDirtyChange,
  onErrorCountChange,
  onOpenFile,
}: Props) {
  useLocale();
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
  const saveRequestRef = useRef<(() => Promise<boolean>) | null>(null);
  const openingRef = useRef(false);
  const [openingChrome, setOpeningChrome] = useState(false);
  const [chromeError, setChromeError] = useState<string | null>(null);
  useEffect(() => setChromeError(null), [path]);
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
  /** The file's text as last read or written; tells real disk changes from no-op events. */
  const diskTextRef = useRef<string | null>(null);
  const eolRef = useRef<LineEnding>("\n");
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;

  const applyDiskContent = useCallback((raw: string) => {
    // CodeMirror documents are LF-only; keep the editor in that convention
    // and restore the file's own line endings on save. Feeding CRLF text
    // into the LF document doubles every line (see editorDoc.ts).
    eolRef.current = detectLineEnding(raw);
    diskTextRef.current = raw;
    const content = normalizeLineBreaks(raw);
    setLoadState((current) => {
      if (current.status === "ready" && current.content === content) {
        return current;
      }
      return { status: "ready", content };
    });
    setDraft(content);
  }, []);

  const reloadFromDisk = useCallback(
    async (force = false) => {
      const generation = ++loadGeneration.current;
      try {
        const content = await readTextFile(path);
        if (generation !== loadGeneration.current) return;
        if (dirtyRef.current && !force) {
          // Keep unsaved edits; only a real change on disk blocks saving over it.
          pendingDiskRef.current = content !== diskTextRef.current;
          return;
        }
        pendingDiskRef.current = false;
        if (force && dirtyRef.current) {
          dirtyRef.current = false;
          onDirtyChangeRef.current(path, false);
        }
        applyDiskContent(content);
      } catch (error: unknown) {
        if (generation !== loadGeneration.current) return;
        if (dirtyRef.current && !force) {
          pendingDiskRef.current = true;
          return;
        }
        setLoadState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [applyDiskContent, path],
  );

  useEffect(() => {
    dirtyRef.current = false;
    pendingDiskRef.current = false;
    let cancelled = false;
    setLoadState({ status: "loading" });
    setSaveState({ status: "idle" });
    const generation = ++loadGeneration.current;
    void readTextFile(path)
      .then((content) => {
        if (cancelled || generation !== loadGeneration.current) return;
        applyDiskContent(content);
      })
      .catch((error: unknown) => {
        if (cancelled || generation !== loadGeneration.current) return;
        setLoadState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [applyDiskContent, path, reloadKey]);

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
      void (async () => {
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
      if (!document.hidden) load();
    };
    const onGit = () => {
      if (!document.hidden) load();
    };
    let timer = 0;
    const onDisk = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        load();
        void reloadFromDisk();
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
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      unsubGit();
      unsubWatch();
    };
  }, [cwd, path, reloadFromDisk, showDiff]);

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
    const stop = watchFile(path, () => {
      if (dirtyRef.current) {
        // Block saving at once, then clear it if the text on disk is unchanged.
        pendingDiskRef.current = true;
        void reloadFromDisk();
        return;
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void reloadFromDisk();
      }, 50);
    });
    return () => {
      window.clearTimeout(timer);
      stop();
    };
  }, [loadState.status, path, reloadFromDisk]);

  const save = useCallback(
    async (content: string) => {
      const generation = ++saveGeneration.current;
      setSaveState({ status: "saving" });
      const serializedContent = restoreLineEnding(content, eolRef.current);
      const operation = saveQueue.current.then(() => writeTextFile(path, serializedContent));
      saveQueue.current = operation.catch((error) => {
        console.warn("FileEditor operation failed", error);
      });
      try {
        await operation;
        diskTextRef.current = serializedContent;
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
      }
    },
    [cwd, path],
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
        await gitStageContents(cwd, relative, restoreLineEnding(contents, gitDiff.lineEnding));
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

  const relativePath = path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path;
  const footerBlameReason = useInlineBlameUnavailableReason(cwd, path);
  const diffRelative = showDiff ? displayPath(path, cwd) : "";
  const diffPending =
    showDiff &&
    !!cwd &&
    cwd !== "~" &&
    !!diffRelative &&
    diffRelative !== path &&
    gitSettledPath !== path;

  if (loadState.status === "loading" || diffPending) {
    return (
      <div className="grid h-full place-items-center text-[12px] text-content/45">
        {t("Opening ")}
        {basename(path)}…
      </div>
    );
  }

  if (loadState.status === "error") {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-md text-center">
          <AlertCircle className="mx-auto mb-3 size-5 text-red-400" />
          <p className="text-[13px] text-content">
            {t("Couldn’t open ")}
            {basename(path)}
          </p>
          <p className="mt-1 text-[12px] leading-5 text-content/50">{loadState.message}</p>
          <button
            type="button"
            onClick={() => setReloadKey((value) => value + 1)}
            className="mx-auto mt-4 flex h-7 items-center gap-1.5 rounded-md bg-content/10 px-2.5 text-[12px] text-content hover:bg-content/15"
          >
            <RotateCcw className="size-3" strokeWidth={1.75} />
            {t("Retry")}
          </button>
          {isRemoteProjectPath(path) ? null : (
            <button
              type="button"
              onClick={() =>
                void revealPath(path).catch((error) => {
                  console.warn("FileEditor operation failed", error);
                })
              }
              className="mx-auto mt-2 flex h-7 items-center gap-1.5 rounded-md bg-content/10 px-2.5 text-[12px] text-content hover:bg-content/15"
            >
              <Folder className="size-3" strokeWidth={1.75} />
              {REVEAL_LABEL}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {showDiff && gitDiff?.eolOnly && (
        <p
          role="status"
          className="shrink-0 border-b border-stroke px-3 py-1 text-[12px] text-content/60"
        >
          {gitDiff.kind === "staged" ? t("Staged") : t("Unstaged")}
          {t(" line-ending changes. Line breaks are normalized in this view.")}
        </p>
      )}
      {markdown || svg || html ? (
        <MarkdownViewShell
          mode={mode}
          onModeChange={setMode}
          preview={
            markdown ? (
              <FilePreviewSearch active={active && mode === "preview"} contentVersion={draft}>
                <MarkdownDocumentPreview
                  text={draft}
                  metadataLabel="Properties"
                  cwd={cwd}
                  onOpenFile={onOpenFile}
                />
              </FilePreviewSearch>
            ) : html ? (
              <HtmlPreview path={path} source={draft} active={active && mode === "preview"} />
            ) : (
              <SvgPreview source={draft} />
            )
          }
          source={
            <div className="flex h-full min-h-0 min-w-0 flex-col">
              <CodeMirrorEditor
                key={`${path}:${reloadKey}`}
                path={path}
                cwd={cwd}
                commentPath={relativePath}
                value={loadState.content}
                showDiff={showDiff}
                gitOriginal={gitOriginal}
                active={active && mode === "source"}
                navigation={navigation}
                onDirtyChange={dirtyChange}
                onErrorCountChange={errorCountChange}
                onSave={save}
                saveRequestRef={saveRequestRef}
                canAutosave={() => !pendingDiskRef.current}
                onStageGit={showDiff && gitDiff?.kind === "unstaged" ? stageGit : undefined}
                // HTML must retain source edits when switching back to its live view.
                onDocChange={html || mode === "preview" ? setDraft : undefined}
                onOpenFile={onOpenFile}
              />
            </div>
          }
        />
      ) : (
        <CodeMirrorEditor
          key={`${path}:${reloadKey}`}
          path={path}
          cwd={cwd}
          commentPath={relativePath}
          value={loadState.content}
          showDiff={showDiff}
          gitOriginal={gitOriginal}
          active={active}
          saveRequestRef={saveRequestRef}
          navigation={navigation}
          onDirtyChange={dirtyChange}
          onErrorCountChange={errorCountChange}
          onSave={save}
          canAutosave={() => !pendingDiskRef.current}
          onStageGit={showDiff && gitDiff?.kind === "unstaged" ? stageGit : undefined}
          onOpenFile={onOpenFile}
        />
      )}
      {chromeError ? (
        <p
          role="alert"
          className="shrink-0 border-t border-stroke px-2.5 py-1 text-[12px] text-red-400"
        >
          {chromeError}
        </p>
      ) : null}
      <footer className="flex h-6 shrink-0 items-center border-t border-stroke px-2.5 font-mono text-[10.5px] text-content/40">
        <span className="min-w-0 flex-1 truncate" title={path}>
          {relativePath}
        </span>
        {html ? (
          <button
            type="button"
            disabled={isRemoteProjectPath(path)}
            onClick={() =>
              void revealPath(path).catch((error: unknown) => setChromeError(String(error)))
            }
            title={REVEAL_LABEL}
            aria-label={REVEAL_LABEL}
            className="mr-2 shrink-0 rounded px-1.5 py-0.5 text-content/75 hover:bg-content/10 disabled:opacity-40"
          >
            <Folder className="size-3" />
          </button>
        ) : null}
        {html ? (
          <button
            type="button"
            disabled={openingChrome || isRemoteProjectPath(path)}
            onClick={() => void goLive()}
            title={
              isRemoteProjectPath(path)
                ? t("Go Live is available for local HTML files.")
                : t("Save and open this HTML file in Google Chrome")
            }
            className="mr-2 shrink-0 rounded px-1.5 py-0.5 font-sans text-[11px] text-content/75 hover:bg-content/10 hover:text-content disabled:opacity-40"
          >
            {openingChrome ? t("Opening…") : t("Go Live")}
          </button>
        ) : null}
        <InlineBlameToggle reason={footerBlameReason} />
        {saveState.status === "saving" ? (
          <span>{t("Saving…")}</span>
        ) : saveState.status === "saved" ? (
          <span>{t("Saved")}</span>
        ) : saveState.status === "error" ? (
          <span className="max-w-64 truncate text-red-400" title={saveState.message}>
            {t("Save failed: ")}
            {saveState.message}
          </span>
        ) : null}
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
function SvgPreview({ source }: { source: string }) {
  useLocale();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const next = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [source]);

  if (!url) return null;
  return (
    <div className="grid h-full place-items-center overflow-auto p-6">
      <img src={url} alt="" className="max-h-full max-w-full object-contain" />
    </div>
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
