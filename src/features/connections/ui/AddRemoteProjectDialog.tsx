import { Alert } from "../../../shared/ui/Alert";
import { TextField } from "../../../shared/ui/TextField";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { useEffect, useRef, useState } from "react";
import { Modal } from "../../../shared/ui/Modal";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { ArrowUp, ChevronRight, Folder, FolderPlus } from "../../../shared/ui/icons";
import { OPEN_CONNECTIONS_EVENT, remoteRequest, useRemoteMachines } from "../model/connections";
import { remoteProjectMachines } from "../model/localSync";
import { openRemoteProject } from "../model/remoteProjects";
import type { HostDirectory } from "../model/protocol";
import { RemoteDataStatus } from "./RemoteDataStatus";
import { subscribeRemoteRecovered } from "../model/remoteHealth";
import { connectionOutcome } from "../model/remoteConnection";

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
  const browsing = useRef(false);
  const [browseError, setBrowseError] = useState("");
  const [verifiedAt, setVerifiedAt] = useState<number>();
  const cancel = () => {
    alive.current = false;
    requestVersion.current++;
    onCancel();
  };
  // Set on every mount: development StrictMode mounts, unmounts and mounts
  // again, and responses after the first cleanup must still be shown.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const browse = async (next?: string, userInitiated = true) => {
    if (!machine || (!userInitiated && browsing.current)) return;
    const version = ++requestVersion.current;
    browsing.current = true;
    requestedPath.current = next;
    setLoading(true);
    if (userInitiated) {
      setNewName(null);
      setOpening(false);
      setError("");
    }
    setBrowseError("");
    try {
      const value = await remoteRequest<HostDirectory>(
        machine.id,
        "projects.browse",
        { path: next },
        false,
        userInitiated,
      );
      if (!alive.current || version !== requestVersion.current) return;
      setDirectory(value);
      setPath((current) =>
        userInitiated || !current.trim() || current === next ? value.path : current,
      );
      setVerifiedAt(Date.now());
    } catch (reason) {
      if (alive.current && version === requestVersion.current)
        setBrowseError(String(reason).replace(/^Error: /, ""));
    } finally {
      if (version === requestVersion.current) {
        browsing.current = false;
        if (alive.current) setLoading(false);
      }
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

  useEffect(() => {
    if (!machine || !browseError || loading) return;
    const status = connectionOutcome(browseError).status;
    if (
      status !== "unreachable" &&
      status !== "host-not-running" &&
      !/RPC_TIMEOUT/.test(browseError)
    )
      return;
    const wake = () => {
      if (!document.hidden) void browse(requestedPath.current, false);
    };
    const stopRecovered = subscribeRemoteRecovered((environmentId) => {
      if (!environmentId || environmentId === machine.environmentId) wake();
    });
    const timer = setTimeout(wake, 5_000);
    window.addEventListener("online", wake);
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearTimeout(timer);
      stopRecovered();
      window.removeEventListener("online", wake);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [machine?.id, machine?.environmentId, browseError, loading]);

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

  return (
    <Modal
      title={t("Open folder on a machine")}
      description={
        t(
          "Sessions in this project run on that machine, using its checkout and its Codex or Claude Code sign-in. They keep running when you close ",
        ) +
        PRODUCT_IDENTITY.displayName +
        t(" here.")
      }
      size="md"
      onClose={cancel}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (newName !== null) void createFolder();
          else void open();
        }}
        className="flex flex-col gap-3 p-4"
      >
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
            <p className="text-ui-caption leading-snug text-(--ui-text-muted)">
              {t(
                "No machines are connected yet. Add one in Settings, then open a folder on it here.",
              )}
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={cancel} variant="ghost">
                {t("Cancel")}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  cancel();
                  window.dispatchEvent(new Event(OPEN_CONNECTIONS_EVENT));
                }}
                variant="primary"
              >
                {t("Add a machine")}
              </Button>
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
              <p className="text-ui-caption text-(--ui-text-muted)">
                {t("On ")}
                <span className="text-content">{machine.name}</span>
              </p>
            )}
            <TextField
              aria-label={t("Folder path on the machine")}

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
              label=""
              hideLabel
              fieldClassName="min-w-0 flex-1"
            />
            <nav
              aria-label={t("Locations")}
              className="flex flex-wrap items-center gap-1 border-b border-stroke pb-2"
            >
              <Button
                type="button"
                aria-label={t("Parent folder")}
                disabled={!directory?.parent || loading || creating || opening}
                onClick={() => void browse(directory?.parent ?? undefined)}
                variant="secondary"
                iconOnly
                label={t("Parent folder")}
              >
                <ArrowUp className="icon-md" />
              </Button>
              <Button
                type="button"
                disabled={loading || creating || opening}
                onClick={() => void browse(directory?.home)}
                variant="secondary"
              >
                {t("Home folder")}
              </Button>
              {directory?.roots?.map((root) => (
                <Button
                  key={root.path}
                  type="button"
                  disabled={loading || creating || opening}
                  onClick={() => void browse(root.path)}
                  variant="secondary"
                >
                  {root.name}
                </Button>
              ))}
              <Button
                type="button"
                disabled={!directory || loading || creating || opening || !!browseError}
                onClick={() => setNewName("")}
                variant="secondary"
              >
                <FolderPlus className="icon-md" />
                {t("New folder")}
              </Button>
            </nav>
            {newName !== null ? (
              <div className="flex items-center gap-2">
                <TextField
                  autoFocus
                  aria-label={t("New folder name")}
                  value={newName}
                  disabled={creating}
                  onChange={(event) => setNewName(event.target.value)}
                  label=""
                  hideLabel
                  fieldClassName="min-w-0 flex-1"
                />
                <Button
                  type="button"
                  disabled={creating || !newName.trim()}
                  onClick={() => void createFolder()}
                  variant="secondary"
                >
                  {t("Create")}
                </Button>
                <Button
                  type="button"
                  disabled={creating}
                  onClick={() => setNewName(null)}
                  variant="secondary"
                >
                  {t("Cancel")}
                </Button>
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
              <p className="text-ui-caption text-(--ui-text-muted)">
                {t("Showing last loaded folder: ")}
                {directory.path}
              </p>
            ) : null}
            <div
              aria-label={t("Folders")}
              className="h-[min(340px,45vh)] min-h-24 overflow-y-auto overscroll-contain rounded-md border border-stroke"
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
                  <p className="px-2 py-1.5 text-ui-caption text-(--ui-text-muted)">
                    {t("No subfolders")}
                  </p>
                ) : null}
                {!directory && loading ? (
                  <p className="px-2 py-1.5 text-ui-caption text-(--ui-text-muted)">
                    {t("Loading folders…")}
                  </p>
                ) : null}
              </div>
            </div>
            {error ? (
              <Alert role="alert" tone="danger">
                {error}
              </Alert>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={cancel} variant="ghost">
                {t("Cancel")}
              </Button>
              <Button
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
                variant="primary"
              >
                {opening ? t("Opening…") : t("Open")}
              </Button>
            </div>
          </>
        )}
      </form>
    </Modal>
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
    <Button type="button" onClick={onOpen} disabled={disabled} variant="item" fullWidth>
      <Folder className="icon-sm shrink-0 text-(--ui-text-muted)" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <ChevronRight className="icon-xs shrink-0 text-(--ui-text-muted)" />
    </Button>
  );
}
