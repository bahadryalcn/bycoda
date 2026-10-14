import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LAYER } from "../../../shared/lib/layers";
import { OverlayParent, useOverlay } from "../../../shared/ui/overlay";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { ArrowUp, ChevronRight, Folder, FolderPlus } from "../../../shared/ui/icons";
import { OPEN_CONNECTIONS_EVENT, remoteRequest, useRemoteMachines } from "../model/connections";
import { remoteProjectMachines } from "../model/localSync";
import { openRemoteProject } from "../model/remoteProjects";
import type { HostDirectory } from "../model/protocol";
import { RemoteDataStatus } from "./RemoteDataStatus";

/** Adds a project whose folder is on a connected machine. Sessions in it run
 * on that machine; the project otherwise behaves like any other in the rail. */
export function AddRemoteProjectDialog({
  onCancel,
  onOpen,
}: {
  onCancel: () => void;
  /** Receives the new project's rail key. */
  onOpen: (key: string) => void;
}) {
  useLocale();
  const {
    machines: allMachines,
    loaded,
    loading: machinesLoading,
    error: machinesError,
    refresh: refreshMachines,
  } = useRemoteMachines();
  const machines = remoteProjectMachines(allMachines);
  const [machineId, setMachineId] = useState<string>();
  const machine = machines.find((entry) => entry.id === machineId) ?? machines[0];
  const [path, setPath] = useState("");
  const [directory, setDirectory] = useState<HostDirectory>();
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [newName, setNewName] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const requestVersion = useRef(0);
  const requestedPath = useRef<string | undefined>(undefined);
  const [browseError, setBrowseError] = useState("");
  const [verifiedAt, setVerifiedAt] = useState<number>();
  const cancel = () => {
    alive.current = false;
    requestVersion.current++;
    onCancel();
  };
  const dialogRoot = useRef<HTMLFormElement>(null);
  const overlayId = useOverlay(dialogRoot, true, cancel);
  // Set on every mount: development StrictMode mounts, unmounts and mounts
  // again, and responses after the first cleanup must still be shown.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const browse = async (next?: string) => {
    if (!machine) return;
    const version = ++requestVersion.current;
    requestedPath.current = next;
    setLoading(true);
    setNewName(null);
    setOpening(false);
    setError("");
    setBrowseError("");
    try {
      const value = await remoteRequest<HostDirectory>(
        machine.id,
        "projects.browse",
        { path: next },
        false,
        true,
      );
      if (!alive.current || version !== requestVersion.current) return;
      setDirectory(value);
      setPath(value.path);
      setVerifiedAt(Date.now());
    } catch (reason) {
      if (alive.current && version === requestVersion.current)
        setBrowseError(String(reason).replace(/^Error: /, ""));
    } finally {
      if (alive.current && version === requestVersion.current) setLoading(false);
    }
  };

  useEffect(() => {
    setDirectory(undefined);
    requestVersion.current++;
    setNewName(null);
    setCreating(false);
    setPath("");
    setVerifiedAt(undefined);
    if (machine) void browse();
  }, [machine?.id]);

  const open = async () => {
    if (!machine || !path.trim() || opening || creating || loading || browseError || machinesError)
      return;
    const version = ++requestVersion.current;
    setOpening(true);
    setLoading(false);
    setError("");
    try {
      const project = await openRemoteProject(
        (method, params) => remoteRequest(machine.id, method, params, false, true),
        machine.environmentId,
        path.trim(),
      );
      if (alive.current && version === requestVersion.current) onOpen(project.key);
    } catch (reason) {
      if (alive.current && version === requestVersion.current)
        setError(String(reason).replace(/^Error: /, ""));
    } finally {
      if (alive.current && version === requestVersion.current) setOpening(false);
    }
  };

  const createFolder = async () => {
    if (!machine || !directory || creating || loading || !newName?.trim()) return;
    const version = ++requestVersion.current;
    setCreating(true);
    setError("");
    try {
      const value = await remoteRequest<HostDirectory>(
        machine.id,
        "projects.createDirectory",
        { path: directory.path, name: newName.trim() },
        false,
        true,
      );
      if (!alive.current || version !== requestVersion.current) return;
      setDirectory(value);
      setPath(value.path);
      setNewName(null);
      setVerifiedAt(Date.now());
    } catch (reason) {
      if (alive.current && version === requestVersion.current)
        setError(String(reason).replace(/^Error: /, ""));
    } finally {
      if (alive.current && version === requestVersion.current) setCreating(false);
    }
  };

  return createPortal(
    <OverlayParent.Provider value={overlayId}>
      <div className="fixed inset-0" style={{ zIndex: LAYER.dialog }}>
        <div className="absolute inset-0 bg-scrim/30" onMouseDown={cancel} />
        <form
          ref={dialogRoot}
          role="dialog"
          aria-modal="true"
          aria-label={t("Open folder on a machine")}
          onMouseDown={(event) => event.stopPropagation()}
          onSubmit={(event) => {
            event.preventDefault();
            if (newName !== null) void createFolder();
            else void open();
          }}
          className="absolute left-1/2 top-1/2 flex max-h-[85vh] w-[min(600px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-lg border border-stroke bg-background-base p-4 shadow-xl"
        >
          <div className="flex flex-col gap-1">
            <h2 className="text-[13px] font-medium leading-tight text-content">
              {t("Open folder on a machine")}
            </h2>
            <p className="text-[12px] leading-snug text-content/55">
              {t(
                "Sessions in this project run on that machine, using its checkout and its Codex or Claude Code sign-in. They keep running when you close ",
              )}
              {PRODUCT_IDENTITY.displayName}
              {t(" here.")}
            </p>
          </div>
          {machinesLoading || machinesError ? (
            <RemoteDataStatus
              label={t("machines")}
              state={{
                phase: machinesLoading ? (machines.length ? "refreshing" : "loading") : "error",
                error: machinesError,
              }}
              onRefresh={refreshMachines}
            />
          ) : null}
          {!loaded || (machinesError && !machine) ? null : !machine ? (
            <>
              <p className="text-[12px] leading-snug text-content/55">
                {t(
                  "No machines are connected yet. Add one in Settings, then open a folder on it here.",
                )}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={cancel}
                  className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/8 hover:text-content"
                >
                  {t("Cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    cancel();
                    window.dispatchEvent(new Event(OPEN_CONNECTIONS_EVENT));
                  }}
                  className="rounded-md bg-selection px-3 py-1.5 text-[12px] font-medium hover:bg-selection-hover"
                >
                  {t("Add a machine")}
                </button>
              </div>
            </>
          ) : (
            <>
              {machines.length > 1 ? (
                <SearchableSelect
                  label={t("Machine")}
                  value={machine.id}
                  options={machines.map((entry) => ({
                    value: entry.id,
                    label: entry.name,
                    keywords: entry.ssh?.target ?? entry.endpoint,
                  }))}
                  onChange={setMachineId}
                  searchable={false}
                />
              ) : (
                <p className="text-[12px] text-content/55">
                  {t("On ")}
                  <span className="text-content/80">{machine.name}</span>
                </p>
              )}
              <input
                aria-label={t("Folder path on the machine")}
                className="h-8 shrink-0 rounded-md border border-content/10 bg-content/3 px-2.5 font-mono text-[12px] text-content outline-none focus:border-content/25"
                placeholder="/home/me/code/my-app"
                value={path}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
                disabled={creating || opening}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void browse(path.trim());
                  }
                }}
                onChange={(event) => setPath(event.target.value)}
              />
              <nav
                aria-label={t("Locations")}
                className="flex flex-wrap items-center gap-1 border-b border-stroke pb-2"
              >
                <button
                  type="button"
                  aria-label={t("Parent folder")}
                  disabled={!directory?.parent || loading || creating || opening}
                  onClick={() => void browse(directory?.parent ?? undefined)}
                  className="rounded-md p-2 hover:bg-content/8 disabled:opacity-40"
                >
                  <ArrowUp className="size-4" />
                </button>
                <button
                  type="button"
                  disabled={loading || creating || opening}
                  onClick={() => void browse(directory?.home)}
                  className="rounded-md px-2 py-1.5 text-xs hover:bg-content/8"
                >
                  {t("Home folder")}
                </button>
                {directory?.roots?.map((root) => (
                  <button
                    key={root.path}
                    type="button"
                    disabled={loading || creating || opening}
                    onClick={() => void browse(root.path)}
                    className="rounded-md border border-stroke px-2 py-1.5 font-mono text-xs hover:bg-content/8"
                  >
                    {root.name}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={!directory || loading || creating || opening || !!browseError}
                  onClick={() => setNewName("")}
                  className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs hover:bg-content/8 disabled:opacity-40"
                >
                  <FolderPlus className="size-4" />
                  {t("New folder")}
                </button>
              </nav>
              {newName !== null ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    aria-label={t("New folder name")}
                    value={newName}
                    disabled={creating}
                    onChange={(event) => setNewName(event.target.value)}
                    className="min-w-0 flex-1 rounded-md border border-stroke bg-transparent px-2 py-1.5 text-xs"
                  />
                  <button
                    type="button"
                    disabled={creating || !newName.trim()}
                    onClick={() => void createFolder()}
                    className="rounded-md bg-selection px-3 py-1.5 text-xs"
                  >
                    {t("Create")}
                  </button>
                  <button
                    type="button"
                    disabled={creating}
                    onClick={() => setNewName(null)}
                    className="px-2 text-xs"
                  >
                    {t("Cancel")}
                  </button>
                </div>
              ) : null}
              <RemoteDataStatus
                label={t("folders")}
                state={{
                  phase: loading
                    ? directory
                      ? "refreshing"
                      : "loading"
                    : browseError
                      ? "error"
                      : directory
                        ? directory.entries.length
                          ? "ready"
                          : "empty"
                        : "loading",
                  error: browseError,
                  updatedAt: verifiedAt,
                }}
                onRefresh={() => void browse(browseError ? requestedPath.current : directory?.path)}
                disabled={opening || creating}
              />
              {directory && (loading || browseError) ? (
                <p className="text-[12px] text-content/55">
                  {t("Showing last loaded folder: ")}
                  {directory.path}
                </p>
              ) : null}
              <div
                aria-label={t("Folders")}
                className="h-[min(340px,45vh)] min-h-24 overflow-y-auto overscroll-contain rounded-md border border-content/10"
              >
                <div className="p-1">
                  {directory?.parent ? (
                    <FolderRow
                      name=".."
                      disabled={creating || opening || loading}
                      onOpen={() => void browse(directory.parent!)}
                    />
                  ) : null}
                  {directory?.entries.map((entry) => (
                    <FolderRow
                      key={entry.path}
                      name={entry.name}
                      disabled={creating || opening || loading}
                      onOpen={() => void browse(entry.path)}
                    />
                  ))}
                  {directory && !directory.entries.length ? (
                    <p className="px-2 py-1.5 text-[12px] text-content/45">{t("No subfolders")}</p>
                  ) : null}
                  {!directory && loading ? (
                    <p className="px-2 py-1.5 text-[12px] text-content/45">
                      {t("Loading folders…")}
                    </p>
                  ) : null}
                </div>
              </div>
              {error ? (
                <p
                  role="alert"
                  className="whitespace-pre-wrap break-words text-[12px] leading-snug text-danger/90"
                >
                  {error}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={cancel}
                  className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/8 hover:text-content"
                >
                  {t("Cancel")}
                </button>
                <button
                  type="submit"
                  disabled={
                    opening ||
                    creating ||
                    newName !== null ||
                    loading ||
                    !!browseError ||
                    !!machinesError ||
                    !path.trim()
                  }
                  className="rounded-md bg-selection px-3 py-1.5 text-[12px] font-medium hover:bg-selection-hover disabled:opacity-40"
                >
                  {opening ? t("Opening…") : t("Open")}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </OverlayParent.Provider>,
    document.body,
  );
}

function FolderRow({
  name,
  onOpen,
  disabled,
}: {
  name: string;
  onOpen: () => void;
  disabled?: boolean;
}) {
  useLocale();
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-content/75 hover:bg-content/8 hover:text-content"
    >
      <Folder className="size-3.5 shrink-0 text-content/45" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <ChevronRight className="size-3 shrink-0 text-content/30" />
    </button>
  );
}
