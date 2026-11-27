import { Text } from "../../../shared/ui/Text";
import { InlineError } from "../../../shared/ui/InlineError";
import { TextField } from "../../../shared/ui/TextField";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useId, useRef, useState } from "react";
import { Modal, ModalActions, ModalFooter } from "../../../shared/ui/Modal";
import { Divider } from "../../../shared/ui/Divider";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Surface } from "../../../shared/ui/Surface";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { ChevronRight, Folder, FolderPlus } from "../../../shared/ui/icons";
import { OPEN_CONNECTIONS_EVENT, remoteRequest, useRemoteMachines } from "../model/connections";
import { remoteProjectMachines } from "../model/localSync";
import { openRemoteProject } from "../model/remoteProjects";
import type { HostDirectory } from "../model/protocol";
import { RemoteDataStatus } from "./RemoteDataStatus";
import { subscribeRemoteRecovered } from "../model/remoteHealth";
import { connectionOutcome } from "../model/remoteConnection";
import { remoteBackoffDelay } from "../model/remotePollingPolicy";
import { isImeComposition } from "../../../shared/lib/keyboard";
import { errorText } from "../../../shared/lib/errors";

type RemoteProjectMachine = ReturnType<typeof remoteProjectMachines>[number];

/** Adds a project whose folder is on a connected machine. Sessions in it run
 * on that machine; the project otherwise behaves like any other in the rail. */
export function AddRemoteProjectDialog({
  onCancel,
  onOpen,
  machineId: fixedMachineId,
}: {
  onCancel: () => void;
  /** Receives the new project's rail key. */
  onOpen: (key: string) => void;
  /**
   * Browse only this machine: no machine switch, and no fallback to another one
   * when it is not connected. For a destination the caller already chose.
   */
  machineId?: string;
}) {
  useLocale();
  const {
    machines: allMachines,
    loaded,
    loading: machinesLoading,
    error: machinesError,
    refresh: refreshMachines,
  } = useRemoteMachines();
  const machines = remoteProjectMachines(allMachines).filter(
    (entry) => !fixedMachineId || entry.id === fixedMachineId,
  );
  const [machineId, setMachineId] = useState<string>();
  const machine = machines.find((entry) => entry.id === machineId) ?? machines[0];
  return (
    <Modal title={t("Open folder on a machine")} size="md" onClose={onCancel}>
      {/* Keyed by machine: browse state belongs to one machine and starts fresh for the next. */}
      <AddRemoteProjectForm
        key={machine?.id ?? ""}
        machines={machines}
        machine={machine}
        loaded={loaded}
        machinesLoading={machinesLoading}
        machinesError={machinesError}
        refreshMachines={refreshMachines}
        fixedMachine={!!fixedMachineId}
        onSelectMachine={setMachineId}
        onCancel={onCancel}
        onOpen={onOpen}
      />
    </Modal>
  );
}

function AddRemoteProjectForm({
  machines,
  machine,
  loaded,
  machinesLoading,
  machinesError,
  refreshMachines,
  fixedMachine,
  onSelectMachine,
  onCancel,
  onOpen,
}: {
  machines: RemoteProjectMachine[];
  machine: RemoteProjectMachine | undefined;
  loaded: boolean;
  machinesLoading: boolean;
  machinesError: string | undefined;
  refreshMachines: () => void;
  /** The caller chose the machine; an absent one is unavailable, not "none connected". */
  fixedMachine: boolean;
  onSelectMachine: (id: string) => void;
  onCancel: () => void;
  onOpen: (key: string) => void;
}) {
  useLocale();
  const formId = useId();
  const [path, setPath] = useState("");
  const [directory, setDirectory] = useState<HostDirectory>();
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [newName, setNewName] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const busy = loading || creating || opening;
  const busyReason = busy ? t("Wait for the current action to finish.") : undefined;
  const alive = useRef(true);
  const requestVersion = useRef(0);
  const requestedPath = useRef<string | undefined>(undefined);
  const browsing = useRef(false);
  /** Consecutive failed listings; the automatic retry waits longer after each. */
  const browseFailures = useRef(0);
  const mutation = useRef(false);
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
      browseFailures.current = 0;
      setDirectory(value);
      setPath((current) =>
        userInitiated || !current.trim() || current === next ? value.path : current,
      );
      setVerifiedAt(Date.now());
    } catch (reason) {
      if (alive.current && version === requestVersion.current) {
        browseFailures.current++;
        setBrowseError(errorText(reason));
      }
    } finally {
      if (version === requestVersion.current) {
        browsing.current = false;
        if (alive.current) setLoading(false);
      }
    }
  };

  useEffect(() => {
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
    const failures = browseFailures.current;
    const timer = setTimeout(wake, failures ? remoteBackoffDelay(failures) : 5_000);
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
    if (
      mutation.current ||
      !machine ||
      !path.trim() ||
      opening ||
      creating ||
      loading ||
      browseError ||
      machinesError
    )
      return;
    mutation.current = true;
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
      if (alive.current && version === requestVersion.current) setError(errorText(reason));
    } finally {
      mutation.current = false;
      if (alive.current && version === requestVersion.current) setOpening(false);
    }
  };

  const createFolder = async () => {
    if (mutation.current || !machine || !directory || creating || loading || !newName?.trim())
      return;
    mutation.current = true;
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
      if (alive.current && version === requestVersion.current) setError(errorText(reason));
    } finally {
      mutation.current = false;
      if (alive.current && version === requestVersion.current) setCreating(false);
    }
  };

  const noMachines = loaded && !(machinesError && !machine) && !machine;

  return (
    <form
      id={formId}
      onSubmit={(event) => {
        event.preventDefault();
        if (newName !== null) void createFolder();
        else void open();
      }}
      className="flex flex-col gap-3"
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
          <EmptyState
            size="inline"
            kind="empty"
            description={
              fixedMachine
                ? t("That machine is not available.")
                : t("No computers are connected yet.")
            }
          />
        </>
      ) : (
        <>
          {machines.length > 1 ? (
            <SearchableSelect
              label={t("Computer")}
              value={machine.id}
              options={machines.map((entry) => ({
                value: entry.id,
                label: entry.name,
                keywords: entry.ssh?.target ?? entry.endpoint,
              }))}
              disabled={creating || opening}
              onChange={(id) => {
                if (!mutation.current) onSelectMachine(id);
              }}
              searchable={false}
            />
          ) : null}
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
              if (event.key === "Enter" && !isImeComposition(event.nativeEvent)) {
                event.preventDefault();
                void browse(path.trim());
              }
            }}
            onChange={(event) => setPath(event.target.value)}
            label=""
            hideLabel
            fieldClassName="min-w-0 flex-1"
          />
          <nav aria-label={t("Locations")} className="flex flex-wrap items-center gap-1">
            <Button
              type="button"
              disabled={busy}
              onClick={() => void browse(directory?.home)}
              variant="ghost"
            >
              {t("Home folder")}
            </Button>
            {directory?.roots?.map((root) => (
              <Button
                key={root.path}
                type="button"
                disabled={busy}
                onClick={() => void browse(root.path)}
                variant="ghost"
              >
                {root.name}
              </Button>
            ))}
            <Button
              type="button"
              disabled={!directory || busy || !!browseError}
              disabledReason={
                busy
                  ? busyReason
                  : browseError
                    ? t("This folder could not be read. Choose another location first.")
                    : !directory
                      ? t("Wait for the folders to load.")
                      : undefined
              }
              onClick={() => setNewName("")}
              variant="ghost"
            >
              <FolderPlus className="icon-md" />
              {t("New folder")}
            </Button>
          </nav>
          <Divider decorative />
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
                loading={creating}
                disabled={!newName.trim()}
                onClick={() => void createFolder()}
                variant="secondary"
              >
                {t("Create")}
              </Button>
              <Button
                type="button"
                disabled={creating}
                disabledReason={busyReason}
                onClick={() => setNewName(null)}
                variant="secondary"
              >
                {t("Cancel")}
              </Button>
            </div>
          ) : null}
          {/* The list loads itself: the strip appears only while it works or after it failed. */}
          {loading || browseError ? (
            <RemoteDataStatus
              label={t("folders")}
              state={{
                phase: loading ? (directory ? "refreshing" : "loading") : "error",
                error: browseError,
                updatedAt: verifiedAt,
              }}
              onRefresh={() => void browse(requestedPath.current)}
              disabled={opening || creating}
            />
          ) : null}
          <Surface
            variant="card"
            padding="none"
            aria-label={t("Folders")}
            className="h-[min(340px,45vh)] min-h-24 overflow-y-auto"
          >
            <div className="p-1">
              {directory?.parent ? (
                <FolderRow name=".." busy={busy} onOpen={() => void browse(directory.parent!)} />
              ) : null}
              {directory?.entries.map((entry) => (
                <FolderRow
                  key={entry.path}
                  name={entry.name}
                  busy={busy}
                  onOpen={() => void browse(entry.path)}
                />
              ))}
              {directory && !directory.entries.length ? (
                <EmptyState
                  size="inline"
                  kind="empty"
                  inset="row"
                  description={t("No subfolders")}
                />
              ) : null}
              {!directory && loading ? (
                <LoadingText inset="row">{t("Loading folders…")}</LoadingText>
              ) : null}
            </div>
          </Surface>
          {error ? (
            <InlineError details={error}>{t("Could not open or create the folder.")}</InlineError>
          ) : null}
        </>
      )}
      <ModalFooter>
        <ModalActions>
          <Button type="button" onClick={cancel} variant="ghost">
            {t("Cancel")}
          </Button>
          {noMachines ? (
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
          ) : loaded && machine ? (
            <Button
              type="submit"
              form={formId}
              loading={opening}
              loadingLabel={t("Opening…")}
              disabled={
                creating ||
                newName !== null ||
                loading ||
                !!browseError ||
                !!machinesError ||
                !path.trim()
              }
              disabledReason={
                busy
                  ? busyReason
                  : newName !== null
                    ? t("Create or cancel the new folder first.")
                    : browseError || machinesError
                      ? t("This folder could not be read. Choose another location first.")
                      : !path.trim()
                        ? t("Enter a folder path first.")
                        : undefined
              }
              variant="primary"
            >
              {t("Open")}
            </Button>
          ) : null}
        </ModalActions>
      </ModalFooter>
    </form>
  );
}

function FolderRow({ name, onOpen, busy }: { name: string; onOpen: () => void; busy?: boolean }) {
  useLocale();
  return (
    <Button type="button" onClick={onOpen} disabled={busy} variant="item" fullWidth>
      <Folder className="icon-sm shrink-0" tone="muted" strokeWidth={1.75} />
      <Text size="inherit" tone="inherit" truncate className="min-w-0 flex-1">
        {name}
      </Text>
      <ChevronRight className="icon-xs shrink-0" tone="muted" />
    </Button>
  );
}
