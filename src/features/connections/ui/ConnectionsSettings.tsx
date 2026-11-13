import { Text } from "../../../shared/ui/Text";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { invoke } from "@tauri-apps/api/core";
import {
  RemoteReconnectGroup,
  RevealedSetting,
} from "../../settings/public/ConnectionRecoverySettings";
import { Tab, TabList, TabPanel, Tabs } from "../../../shared/ui/Tabs";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Surface } from "../../../shared/ui/Surface";
import "./connections-settings.css";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { SshSetupPromptForm } from "./SshSetupPromptForm";
import { useConnectionRequestInbox } from "./useConnectionRequestInbox";
import { useSshSetupJob } from "./useSshSetupJob";
import { useMachineProbes } from "./useMachineProbes";
import { RemoteOutboxNotice } from "./RemoteOutboxNotice";
import { LocalHostUpdateNotice } from "./LocalHostUpdateNotice";
import { PhoneConnectionPanel } from "./PhoneConnectionPanel";
import { ExternalTunnelsPanel } from "./ExternalTunnelsPanel";
import { RemoteDataStatus } from "./RemoteDataStatus";
import { EMPTY_SSH_DRAFT, MachineForm, type MachineMethod, type SshDraft } from "./MachineForm";
import { MachineRow } from "./MachineRow";
import { RemoveMachineDialog } from "./RemoveMachineDialog";
import { useContext, useRef, useState } from "react";
import { Internet, Plus, RefreshCw } from "../../../shared/ui/icons";
import {
  connectMachine,
  disconnectMachine,
  refreshRemoteMachines,
  remoteRequest,
  updateMachine,
  useRemoteMachines,
} from "../model/connections";
import {
  draftFromMachine,
  editImpact,
  hostnameSuggestion,
  parseMachineDraft,
} from "../model/machineEdit";
import { syncNow } from "../../sync/model/syncClient";
import { notifyRemoteRecovered } from "../model/remoteHealth";
import { machineLabel } from "../model/machineIdentity";
import type { RemoteMachine } from "../model/protocol";

export function ConnectionsSettings() {
  useLocale();
  const revealed = useContext(RevealedSetting);
  const [lastReveal, setLastReveal] = useState<string | null>(null);
  const [view, setView] = useState("machines");
  const [visited, setVisited] = useState<string[]>(["machines"]);
  if (lastReveal !== revealed) {
    setLastReveal(revealed);
    const next =
      revealed === "connections-phone"
        ? "phone"
        : revealed === "connections-sharing"
          ? "tunnels"
          : revealed === "remote-machines" || revealed === "remote-auto-reconnect"
            ? "machines"
            : null;
    if (next) {
      setView(next);
      setVisited((current) => (current.includes(next) ? current : [...current, next]));
    }
  }
  const { machines, loaded, loading, error: loadError, refresh } = useRemoteMachines();
  const [adding, setAdding] = useState(false);
  // The machine whose definition the form edits; none when it adds one.
  const [editing, setEditing] = useState<RemoteMachine>();
  const [addDraft, setAddDraft] = useState<SshDraft>(EMPTY_SSH_DRAFT);
  const [editDraft, setEditDraft] = useState<SshDraft>(EMPTY_SSH_DRAFT);
  const draft = editing ? editDraft : addDraft;
  const submittedAddDraft = useRef<SshDraft | undefined>(undefined);
  const patchDraft = (patch: Partial<SshDraft>) =>
    (editing ? setEditDraft : setAddDraft)((current) => ({ ...current, ...patch }));
  const [connectionName, setConnectionName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryMachine, setRetryMachine] = useState<RemoteMachine>();
  const [notice, setNotice] = useState("");
  const { status, setStatus, needsUpdate } = useMachineProbes(machines, busy);
  const [updatingMachine, setUpdatingMachine] = useState<string>();
  const [removing, setRemoving] = useState<string>();
  const [revoking, setRevoking] = useState(false);
  const [removeMode, setRemoveMode] = useState<"revoke" | "local">("local");
  const [detailMachine, setDetailMachine] = useState<string>();
  const [rowMenu, setRowMenu] = useState<{
    machine: RemoteMachine;
    anchor: HTMLElement;
  }>();
  // The URL drafts live here so they survive switching method and closing the form.
  const [method, setMethod] = useState<MachineMethod>("ssh");
  const [url, setUrl] = useState("http://127.0.0.1:3776");
  const [token, setToken] = useState("");
  const submitting = useRef(false);
  // The running connection follows an edit, so its outcome is worded for one.
  const afterEdit = useRef(false);
  const { jobId, job, alive, progress, attach, clearSnapshot, cancel, respond } = useSshSetupJob({
    onDone: (next) => {
      submitting.current = false;
      setBusy(false);
      if (next.error)
        setError(
          afterEdit.current
            ? `${next.error}

${t("The new address is saved. Edit it again, or choose Reconnect to retry.")}`
            : next.error,
        );
      else if (next.machine) {
        setAdding(false);
        setEditing(undefined);
        const submitted = submittedAddDraft.current;
        if (submitted)
          setAddDraft((current) => (current === submitted ? EMPTY_SSH_DRAFT : current));
        setNotice(
          afterEdit.current
            ? t("{p0} is connected through its new address.", { p0: next.machine.name })
            : updatingMachine
              ? t("{p0} was updated and reconnected.", { p0: next.machine.name })
              : t(
                  "{p0} is connected. To work on it, click + next to Projects in the project rail and choose Open folder on a machine.",
                  { p0: next.machine.name },
                ),
        );
        setUpdatingMachine(undefined);
        setStatus((current) => ({
          ...current,
          [next.machine!.id]: "connected",
        }));
        refreshRemoteMachines();
        // Views that were waiting on this machine reload now.
        notifyRemoteRecovered(next.machine.environmentId);
      }
      afterEdit.current = false;
      submittedAddDraft.current = undefined;
    },
    onFailed: (reason) => {
      setError(String(reason));
      submitting.current = false;
      setBusy(false);
      submittedAddDraft.current = undefined;
    },
    onError: setError,
  });
  // Only an edit carries the Host port; adding installs on the default one.
  const sshFields = (withHostPort: boolean) => ({
    name: draft.name,
    target: draft.target,
    port: draft.port,
    alternate: draft.alternate,
    ...(withHostPort ? { remotePort: draft.remotePort } : {}),
  });
  const begin = async (machine?: RemoteMachine, upgrade = false, edited = false) => {
    if (submitting.current) return;
    setView("machines");
    const parsed = machine ? undefined : parseMachineDraft(sshFields(false));
    if (parsed && !parsed.ok) return setError(t(parsed.error));
    submitting.current = true;
    submittedAddDraft.current = machine ? undefined : addDraft;
    afterEdit.current = edited;
    setBusy(true);
    setError("");
    setNotice("");
    clearSnapshot();
    setConnectionName(machine?.name ?? (draft.name.trim() || draft.target.trim()));
    setRemoving(undefined);
    if (machine) {
      setAdding(false);
      setEditing(undefined);
    }
    setRetryMachine(machine);
    setUpdatingMachine(upgrade ? machine?.id : undefined);
    try {
      const id = machine
        ? await invoke<string>("remote_ssh_reconnect", {
            machineId: machine.id,
            ...(upgrade ? { upgrade: true } : {}),
          })
        : await invoke<string>("remote_ssh_begin", {
            target: draft.target.trim(),
            name: draft.name.trim(),
            port: draft.port ? Number(draft.port) : null,
            alternate: parsed?.ok ? parsed.value.alternate : null,
          });
      if (!alive.current) {
        await cancel(id);
        return;
      }
      attach(id);
    } catch (reason) {
      submitting.current = false;
      afterEdit.current = false;
      if (alive.current) {
        setError(String(reason));
        setBusy(false);
      }
    }
  };
  const connectUrl = () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    setRetryMachine(undefined);
    void connectMachine("", url, token)
      .then((machine) => {
        setToken("");
        setAdding(false);
        setNotice(t("{p0} is connected.", { p0: machine.name }));
      })
      .catch((reason) => setError(String(reason)))
      .finally(() => setBusy(false));
  };
  const startEdit = (machine: RemoteMachine) => {
    setView("machines");
    setEditing(machine);
    setEditDraft({ remotePort: "", alternate: "", ...draftFromMachine(machine) });
    setAdding(true);
    setError("");
    setNotice("");
    setRemoving(undefined);
    clearSnapshot();
  };
  const closeForm = () => {
    setAdding(false);
    setEditing(undefined);
    setEditDraft(EMPTY_SSH_DRAFT);
  };
  const startAdd = () => {
    closeForm();
    setView("machines");
    // A reopened form starts on SSH again; the URL and token drafts are kept.
    setMethod("ssh");
    setAdding(true);
    clearSnapshot();
    setError("");
    setNotice("");
    setRemoving(undefined);
  };
  // Saving is the user's own action, so it connects even when automatic
  // reconnecting is off. The connection runs as a setup job, the same one
  // Reconnect uses, which is where a new host key or password is answered.
  const save = async () => {
    if (!editing || busy) return;
    const parsed = parseMachineDraft(sshFields(true));
    if (!parsed.ok) return setError(t(parsed.error));
    const impact = editImpact(editing, parsed.value);
    if (!impact.changed) return closeForm();
    setBusy(true);
    setError("");
    try {
      const saved = await updateMachine(editing, parsed.value, impact.reconnect);
      closeForm();
      setBusy(false);
      if (impact.reconnect) await begin(saved, false, true);
      else setNotice(t("{p0} was renamed.", { p0: saved.name }));
    } catch (reason) {
      setBusy(false);
      setError(String(reason));
    }
  };
  useConnectionRequestInbox({
    machines,
    busy,
    onAdd: startAdd,
    onEdit: startEdit,
    onReconnect: (machine) => void begin(machine),
  });
  const remove = async (machine: RemoteMachine, revoke: boolean) => {
    setError("");
    setNotice("");
    setRevoking(true);
    try {
      if (revoke) {
        try {
          await remoteRequest(machine.id, "devices.revokeSelf");
        } catch (reason) {
          throw new Error(
            `Could not revoke access, so ${machine.name} was not removed: ${String(reason)}. Reconnect and try again, or remove it from this desktop only and revoke it on the host with bycoda-host devices and bycoda-host revoke <device-id>.`,
          );
        }
      }
      await disconnectMachine(machine.id);
      setRemoving(undefined);
      setNotice(
        revoke
          ? t(
              "{p0} was removed and this desktop's access was revoked. The host and its sessions keep running.",
              { p0: machine.name },
            )
          : t(
              "{p0} was removed from this desktop. The host and its sessions keep running, and it still accepts this desktop's credential.",
              { p0: machine.name },
            ),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (alive.current) setRevoking(false);
    }
  };
  const removingMachine = removing
    ? machines.find((machine) => machine.id === removing)
    : undefined;
  const parsedDraft = parseMachineDraft(sshFields(Boolean(editing)));
  const saveLabel =
    editing && parsedDraft.ok && !editImpact(editing, parsedDraft.value).reconnect
      ? "Save"
      : "Save and reconnect";
  return (
    <div
      id="setting-remote-machines"
      data-setting-id="remote-machines"
      className="connections-settings flex flex-col gap-5"
    >
      <RemoteOutboxNotice />
      <LocalHostUpdateNotice />
      <Tabs
        value={view}
        onValueChange={(next) => {
          setView(next);
          setVisited((previous) => (previous.includes(next) ? previous : [...previous, next]));
        }}
      >
        <TabList label={t("Connections")}>
          <Tab value="machines">{t("Machines")}</Tab>
          <Tab value="phone">{t("Phone")}</Tab>
          <Tab value="tunnels">{t("Sharing")}</Tab>
        </TabList>
        {busy || revoking ? (
          <InlineMessage tone="neutral" icon={null} live="off">
            {t("Finish or cancel the current connection before adding another machine.")}
          </InlineMessage>
        ) : null}
        <TabPanel value="machines" keepMounted tabIndex={-1} className="connections-view">
          {loadError ? (
            <RemoteDataStatus
              label={t("machines")}
              state={{ phase: "error", error: loadError }}
              onRefresh={refresh}
            />
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <Text tone="muted">
              {machines.length === 1 ? t("1 machine") : t("{p0} machines", { p0: machines.length })}
            </Text>
            <div className="flex items-center gap-2">
              <Button
                stableWidth
                iconOnly
                label={t("Refresh machines")}
                variant="ghost"
                disabled={busy || loading}
                onClick={() => void refresh()}
              >
                <RefreshCw aria-hidden className="icon-md" />
              </Button>
              <Button
                stableWidth
                disabled={busy}
                onClick={startAdd}
                variant="primary"
                type="button"
                startIcon={<Plus aria-hidden className="icon-md" />}
              >
                {t("Add machine")}
              </Button>
            </div>
          </div>
          {adding && (
            <MachineForm
              editing={editing}
              method={method}
              onMethodChange={setMethod}
              draft={draft}
              onDraftChange={patchDraft}
              suggestion={hostnameSuggestion(draft.target, editing?.name ?? "")}
              url={url}
              onUrlChange={setUrl}
              token={token}
              onTokenChange={setToken}
              busy={busy}
              error={error}
              saveLabel={saveLabel}
              onSubmit={() => {
                if (editing) void save();
                else if (method === "url") connectUrl();
                else void begin();
              }}
              onCancel={closeForm}
            />
          )}
          {busy && jobId && (
            <Surface
              variant="outline"
              padding="lg"
              className="flex flex-col gap-3"
              role="status"
              ref={progress}
            >
              <Text wrap="anywhere" as="div" size="secondary" tone="primary" weight="medium">
                {connectionName}
              </Text>
              <LoadingText delay={false}>{job?.message ?? t("Starting connection…")}</LoadingText>
              {job?.prompt && (
                <SshSetupPromptForm key={job.prompt.id} prompt={job.prompt} onRespond={respond} />
              )}
              <Button
                stableWidth
                type="button"
                className="self-start"
                onClick={() => {
                  if (jobId) void cancel(jobId).catch((reason) => setError(String(reason)));
                }}
                variant="ghost"
              >
                {t("Cancel connection")}
              </Button>
            </Surface>
          )}
          {error && !adding && !removing && <Alert tone="danger">{error}</Alert>}
          {error && !adding && !busy && retryMachine ? (
            <div className="flex flex-wrap items-center gap-2">
              <Text tone="muted">{t("Remote target: {p0}", { p0: retryMachine.name })}</Text>
              <Button
                stableWidth
                variant="secondary"
                className="shrink-0"
                onClick={() => startEdit(retryMachine)}
              >
                {t("Edit name and address…")}
              </Button>
              <Button
                stableWidth
                variant="secondary"
                className="shrink-0"
                onClick={() => void begin(retryMachine)}
              >
                {t("Retry connection")}
              </Button>
            </div>
          ) : null}
          {notice && <InlineMessage tone="success">{notice}</InlineMessage>}
          {machines.length > 0 ? (
            <Surface variant="outline" padding="none" dividers="card" className="overflow-hidden">
              {machines.map((machine) => (
                <MachineRow
                  key={machine.id}
                  machine={machine}
                  machines={machines}
                  probed={status[machine.id]}
                  needsUpdate={Boolean(needsUpdate[machine.id])}
                  showDetails={
                    detailMachine === machine.id ||
                    status[machine.id] === "offline" ||
                    Boolean(needsUpdate[machine.id])
                  }
                  editing={editing?.id === machine.id}
                  busy={busy}
                  revoking={revoking}
                  menuOpen={rowMenu?.machine.id === machine.id}
                  onUpdateHost={() => void begin(machine, true)}
                  onReconnect={() => void begin(machine)}
                  onSyncNow={() => void syncNow(machine.id)}
                  onToggleMenu={(anchor) =>
                    setRowMenu(rowMenu?.machine.id === machine.id ? undefined : { machine, anchor })
                  }
                />
              ))}
            </Surface>
          ) : loaded && !loading && !loadError && !adding ? (
            <EmptyState
              icon={<Internet aria-hidden className="icon-lg" />}
              description={t("Add your always-on Windows, Mac, or Linux machine to get started.")}
              action={
                <Button stableWidth variant="primary" disabled={busy} onClick={startAdd}>
                  {t("Add machine")}
                </Button>
              }
            />
          ) : null}
          {rowMenu ? (
            <DropdownMenu
              anchor={rowMenu.anchor}
              label={t("Actions for {p0}", { p0: machineLabel(machines, rowMenu.machine) })}
              items={[
                { kind: "item", id: "sync", label: t("Sync now") },
                { kind: "item", id: "details", label: t("Connection details") },
                ...(rowMenu.machine.ssh
                  ? [
                      { kind: "item" as const, id: "reconnect", label: t("Reconnect") },
                      {
                        kind: "item" as const,
                        id: "edit",
                        label: t("Edit name and address…"),
                      },
                      { kind: "sep" as const },
                    ]
                  : []),
                {
                  kind: "item" as const,
                  id: "remove",
                  label: t("Remove connection…"),
                  danger: true,
                },
              ]}
              onClose={() => setRowMenu(undefined)}
              onPick={(id) => {
                const machine = rowMenu.machine;
                setRowMenu(undefined);
                if (id === "sync") void syncNow(machine.id);
                else if (id === "details")
                  setDetailMachine((current) => (current === machine.id ? undefined : machine.id));
                else if (id === "reconnect") void begin(machine);
                else if (id === "edit") startEdit(machine);
                else if (id === "remove") {
                  closeForm();
                  setRetryMachine(undefined);
                  setError("");
                  setNotice("");
                  setRemoveMode("local");
                  setRemoving(machine.id);
                }
              }}
            />
          ) : null}
          {removingMachine ? (
            <RemoveMachineDialog
              machine={removingMachine}
              mode={removeMode}
              revoking={revoking}
              error={error}
              onModeChange={setRemoveMode}
              onCancel={() => setRemoving(undefined)}
              onConfirm={(revoke) => void remove(removingMachine, revoke)}
            />
          ) : null}
          <RemoteReconnectGroup />
        </TabPanel>
        {visited.includes("phone") ? (
          <TabPanel
            id="setting-connections-phone"
            data-setting-id="connections-phone"
            value="phone"
            keepMounted
            tabIndex={-1}
            className="connections-view"
          >
            <PhoneConnectionPanel
              active={view === "phone"}
              machines={machines}
              loaded={loaded}
              loading={loading}
              onRefresh={refresh}
            />
          </TabPanel>
        ) : null}
        {visited.includes("tunnels") ? (
          <TabPanel
            id="setting-connections-sharing"
            data-setting-id="connections-sharing"
            value="tunnels"
            keepMounted
            tabIndex={-1}
            className="connections-view"
          >
            <ExternalTunnelsPanel machines={machines} loaded={loaded} loading={loading} />
          </TabPanel>
        ) : null}
      </Tabs>
    </div>
  );
}
