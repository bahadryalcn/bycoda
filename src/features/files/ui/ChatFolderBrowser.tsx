import { TextField } from "../../../shared/ui/TextField";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n/technical";
import { useEffect, useRef, useState } from "react";
import {
  browseDirectory,
  isLocalDirectory,
  openPathWithDefaultApp,
  openLiveRemoteFolder,
  pickNativeFolders,
  prepareLocalFileCopy,
  type FolderListing,
} from "../../../platform/tauri/fs";
import { IS_MAC, IS_WIN } from "../../../platform/tauri/platform";
import {
  explorerMappingFor,
  localExplorerPath,
  saveExplorerMapping,
} from "../../../shared/lib/remoteExplorerPaths";
import { displayPath, isEqualOrInside } from "../../../shared/lib/paths";
import { Modal } from "../../../shared/ui/Modal";
import { ArrowUp, ExternalLink, FolderOpen } from "../../../shared/ui/icons";
import { FileTypeIcon } from "./FileTypeIcon";
import type { OpenFileFn } from "../../search/model/search";

/** Browse folders belonging to another machine without granting file access. */
export function ChatFolderBrowser({
  path,
  onOpenFile,
  onClose,
  revealOnOpen = false,
}: {
  path: string;
  onOpenFile?: OpenFileFn;
  onClose: () => void;
  revealOnOpen?: boolean;
}) {
  useLocale();
  const [directory, setDirectory] = useState(path);
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [error, setError] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const actionPending = useRef(false);
  const busy = pendingAction !== null;
  const [reload, setReload] = useState(0);
  const [copyProgress, setCopyProgress] = useState<string>();
  const [editingMapping, setEditingMapping] = useState(false);
  const [remoteRoot, setRemoteRoot] = useState(path);
  const [localRoot, setLocalRoot] = useState("");
  const revealRequested = useRef(false);
  const copyAbort = useRef<AbortController | null>(null);
  const revealLabel = IS_MAC
    ? "Reveal in Finder"
    : IS_WIN
      ? "Reveal in File Explorer"
      : "Open in File Manager";
  const entries = listing?.entries;
  const parent = listing?.parent;

  function configureMapping() {
    const mapping = explorerMappingFor(directory);
    setRemoteRoot(mapping?.remoteRoot ?? directory);
    setLocalRoot(mapping?.localRoot ?? "");
    setEditingMapping(true);
    setActionError(undefined);
  }

  async function runAction(action: string, work: () => Promise<void>) {
    if (actionPending.current) return;
    actionPending.current = true;
    setPendingAction(action);
    setActionError(undefined);
    try {
      await work();
    } catch (reason) {
      setActionError(String(reason));
    } finally {
      actionPending.current = false;
      setPendingAction(null);
    }
  }

  async function openMappedDirectory(localPath: string) {
    if (!(await isLocalDirectory(localPath)))
      throw new Error(
        "The shared folder is unavailable on this computer. Check its connection or update the shared folder path.",
      );
    await openPathWithDefaultApp(localPath);
  }

  async function revealDirectory() {
    const localPath = localExplorerPath(directory);
    if (!localPath) {
      configureMapping();
      return;
    }
    await runAction("reveal", () => openMappedDirectory(localPath));
  }

  async function openLocalCopy(file: string) {
    if (actionPending.current) return;
    copyAbort.current?.abort();
    const controller = new AbortController();
    copyAbort.current = controller;
    await runAction(`copy:${file}`, async () => {
      try {
        const local = await prepareLocalFileCopy(file, {
          signal: controller.signal,
          onProgress: (received, total) =>
            setCopyProgress(`${Math.round(total ? (received / total) * 100 : 100)}%`),
        });
        if (!controller.signal.aborted) await openPathWithDefaultApp(local);
      } catch (reason) {
        if (!controller.signal.aborted) throw reason;
      } finally {
        if (copyAbort.current === controller) copyAbort.current = null;
        setCopyProgress(undefined);
      }
    });
  }

  async function openLiveFolder() {
    await runAction("live", () => openLiveRemoteFolder(directory));
  }

  async function saveMapping() {
    await runAction("mapping", async () => {
      if (!isEqualOrInside(directory, remoteRoot))
        throw new Error("The connected folder must contain the folder currently being browsed.");
      if (!(await isLocalDirectory(localRoot.trim())))
        throw new Error(
          "The shared folder is unavailable on this computer. Check its connection or update the shared folder path.",
        );
      saveExplorerMapping(remoteRoot, localRoot);
      const localPath = localExplorerPath(directory);
      if (localPath) await openMappedDirectory(localPath);
      setEditingMapping(false);
    });
  }

  useEffect(() => {
    return () => copyAbort.current?.abort();
  }, []);
  useEffect(() => {
    if (revealOnOpen && !revealRequested.current) {
      revealRequested.current = true;
      void revealDirectory();
    }
    // Only the initial request should open the OS file manager automatically.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    let cancelled = false;
    setListing(null);
    setError(undefined);
    void browseDirectory(directory).then(
      (folder) => {
        if (!cancelled) setListing(folder);
      },
      (reason) => {
        if (!cancelled) setError(String(reason));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [directory, reload]);

  return (
    <Modal
      languageDomain="technical"
      title={t("Folder on connected machine")}
      onClose={onClose}
      size="md"
      fitViewport
    >
      <div className="min-w-0 px-4 pb-4">
        <div className="flex min-w-0 items-center gap-2 border-b border-stroke pb-2">
          <Button
            iconOnly
            label={t("Parent folder")}
            variant="ghost"
            motion="none"
            type="button"
            aria-label={t("Parent folder")}
            title={t("Parent folder")}

            disabled={busy || !parent}
            onClick={() => parent && setDirectory(parent)}
          >
            <ArrowUp className="size-4" />
          </Button>
          <span className="min-w-0 break-all font-mono text-xs text-[var(--ui-text-secondary)]">
            {directory}
          </span>
        </div>
        <div className="flex flex-wrap gap-2 py-2">
          <Button
            variant="ghost"
            motion="none"
            type="button"
            disabled={busy || !listing?.canOpenFiles}
            loading={pendingAction === "live"}
            onClick={() => void openLiveFolder()}
          >
            {t("Open live folder (read-only)")}
          </Button>
          <Button
            variant="ghost"
            motion="none"
            type="button"
            disabled={busy}
            loading={pendingAction === "reveal"}
            onClick={() => void revealDirectory()}
          >
            {revealLabel}
          </Button>
          <Button
            variant="ghost"
            motion="none"
            type="button"
            disabled={busy}
            onClick={configureMapping}
          >
            {t("Shared folder settings")}
          </Button>
        </div>
        <p className="text-xs text-[var(--ui-text-secondary)]">
          {t(
            "Live folders show the connected computer’s current files. Remote changes are visible; writing is disabled.",
          )}
        </p>
        <p className="text-xs text-[var(--ui-text-secondary)]">
          {t("Local copies do not sync changes back to the connected machine.")}
        </p>
        {editingMapping ? (
          <form
            className="grid gap-2 border-b border-stroke pb-3 text-sm"
            onSubmit={(event) => {
              event.preventDefault();
              void saveMapping();
            }}
          >
            <p>
              {t(
                "Enter the shared folder path you can open on this computer. This mapping also applies to its files and subfolders.",
              )}
            </p>
            <label className="grid gap-1">
              {t("Folder on connected machine")}
              <TextField
                hideLabel
                label=""
                className="font-mono"
                value={remoteRoot}
                onChange={(event) => setRemoteRoot(event.target.value)}
                required
              />
            </label>
            <label className="grid gap-1">
              {t("Same folder on this computer")}
              <TextField
                hideLabel
                label=""
                className="font-mono"
                placeholder={IS_WIN ? t("\\\\MacBook\\share\\projects") : "/Volumes/share/projects"}
                value={localRoot}
                onChange={(event) => setLocalRoot(event.target.value)}
                required
              />
            </label>
            <Button
              variant="ghost"
              motion="none"
              type="button"
              disabled={busy}
              loading={pendingAction === "choose"}
              className="justify-self-start"
              onClick={() => {
                void runAction("choose", async () => {
                  const paths = await pickNativeFolders(t("Same folder on this computer"), false);
                  if (paths[0]) setLocalRoot(paths[0]);
                });
              }}
            >
              {t("Choose folder…")}
            </Button>
            <div className="flex gap-2">
              <Button
                variant="primary"
                motion="none"
                type="submit"
                disabled={busy}
                loading={pendingAction === "mapping"}
              >
                {t("Save and open")}
              </Button>
              <Button
                variant="ghost"
                motion="none"
                type="button"
                disabled={busy}
                onClick={() => setEditingMapping(false)}
              >
                {t("Cancel")}
              </Button>
            </div>
          </form>
        ) : null}
        {copyProgress ? (
          <p role="status" className="py-2 text-sm text-[var(--ui-text-secondary)]">
            {t("Downloading…")} {copyProgress}
          </p>
        ) : null}
        {actionError ? (
          <p role="alert" className="py-2 text-sm text-danger">
            {t("Could not open the shared folder: ")}
            {actionError}
          </p>
        ) : null}
        {error ? (
          <div role="alert" className="py-3 text-sm text-danger">
            {error}
            <Button variant="ghost" size="sm" onClick={() => setReload((value) => value + 1)}>
              {t("Retry")}
            </Button>
          </div>
        ) : !entries ? (
          <p role="status" className="py-3 text-sm text-[var(--ui-text-secondary)]">
            {t("Loading folder…")}
          </p>
        ) : entries.length === 0 ? (
          <p className="py-3 text-sm text-[var(--ui-text-secondary)]">
            {t("This folder is empty.")}
          </p>
        ) : (
          <>
            {!listing?.canOpenFiles ? (
              <p className="py-2 text-sm text-[var(--ui-text-secondary)]">
                {t(
                  "This folder is outside registered projects. To access its files, open a shared folder in your file manager.",
                )}
              </p>
            ) : null}
            <ul aria-label={t("Folder contents")} className="max-h-80 overflow-auto py-2">
              {[...entries]
                .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
                .map((entry) => (
                  <li key={entry.path} className="flex min-w-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      motion="none"
                      type="button"
                      disabled={busy || (!entry.isDir && (!listing?.canOpenFiles || !onOpenFile))}
                      className="flex min-w-0 flex-1 items-center gap-2 text-start disabled:cursor-not-allowed"
                      onClick={() => {
                        if (entry.isDir) setDirectory(entry.path);
                        else {
                          onOpenFile?.(entry.path, undefined, { exact: true });
                          onClose();
                        }
                      }}
                    >
                      {entry.isDir ? (
                        <FolderOpen className="size-4 shrink-0" />
                      ) : (
                        <FileTypeIcon name={entry.name} isDir={false} size={16} />
                      )}
                      <span
                        className="min-w-0 truncate text-sm"
                        title={displayPath(entry.path, directory)}
                      >
                        {entry.name}
                      </span>
                    </Button>
                    {!entry.isDir && listing?.canOpenFiles ? (
                      <Button
                        iconOnly
                        label={`${t("Open local copy")}: ${entry.name}`}
                        variant="ghost"
                        motion="none"
                        type="button"
                        disabled={busy}
                        loading={pendingAction === `copy:${entry.path}`}
                        title={t("Open local copy")}
                        aria-label={`${t("Open local copy")}: ${entry.name}`}

                        onClick={() => void openLocalCopy(entry.path)}
                      >
                        <ExternalLink className="size-4" />
                      </Button>
                    ) : null}
                  </li>
                ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}
