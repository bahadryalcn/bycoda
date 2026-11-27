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
import { Modal } from "../../../shared/ui/Modal";
import { Surface } from "../../../shared/ui/Surface";
import "./connections-settings.css";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { SshSetupPromptForm } from "./SshSetupPromptForm";
import { SshSetupProgress } from "./SshSetupProgress";
import { useConnectionRequestInbox } from "./useConnectionRequestInbox";
import { useSshSetupJob } from "./useSshSetupJob";
import { sshSetupSuccessNotice } from "../model/hostLifecycleMode";
import { useMachineProbes } from "./useMachineProbes";
import { RemoteOutboxNotice } from "./RemoteOutboxNotice";
import { LocalHostUpdateNotice } from "./LocalHostUpdateNotice";
import { PairedDevicesPanel } from "./PairedDevicesPanel";
import { ExternalTunnelsPanel } from "./ExternalTunnelsPanel";
import { RemoteDataStatus } from "./RemoteDataStatus";
import { EMPTY_SSH_DRAFT, MachineForm, type MachineMethod, type SshDraft } from "./MachineForm";
import { MachineRow } from "./MachineRow";
import { MACHINE_SEARCH_FROM } from "./machineListSearch";
import { AddComputerDialog } from "./AddComputerDialog";
import type { SshAddPlan } from "../model/machineCandidates";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { UpdateImpact } from "./UpdateImpact";
import { confirmInApp } from "../../../shared/model/appConfirm";
import { RemoveMachineDialog } from "./RemoveMachineDialog";
import { errorText } from "../../../shared/lib/errors";
import { sanitizeConnectionError } from "../model/remoteConnection";
import { useContext, useRef, useState } from "react";
import { Plus } from "../../../shared/ui/icons";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
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
import { notifyRemoteRecovered, recordRemoteConnection } from "../model/remoteHealth";
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
          : revealed === "remote-machines" ||
              revealed === "remote-auto-reconnect" ||
              revealed === "remote-media"
            ? "machines"
            : null;
    if (next) {
      setView(next);
      setVisited((current) => (current.includes(next) ? current : [...current, next]));
    }
  }
  const { machines, loaded, loading, error: loadError, refresh } = useRemoteMachines();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shownMachines = needle
    ? machines.filter((machine) =>
        [machine.name, machine.endpoint, machine.ssh?.target, machine.ssh?.alternate].some(
          (value) => value?.toLowerCase().includes(needle),
        ),
      )
    : machines;
  const [adding, setAdding] = useState(false);
  // The machine whose definition the form edits; none when it adds one.
  const [editing, setEditing] = useState<RemoteMachine>();
  const [addDraft, setAddDraft] = useState<SshDraft>(EMPTY_SSH_DRAFT);
  const [editDraft, setEditDraft] = useState<SshDraft>(EMPTY_SSH_DRAFT);
  const draft = editing ? editDraft : addDraft;
  const submittedAddDraft = useRef<SshDraft | undefined>(undefined);
  const patchDraft = (patch: Partial<SshDraft>) =>
    (editing ? setEditDraft : setAddDraft)((current) => ({
      ...current,
      ...patch,
    }));
  const [connectionName, setConnectionName] = useState("");
  // The job Stop was pressed for; the card shows "Stopping…" until that job ends.
  const [stoppingJob, setStoppingJob] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryMachine, setRetryMachine] = useState<RemoteMachine>();
  const [notice, setNotice] = useState("");
  const { status, setStatus, needsUpdate, versions } = useMachineProbes(machines, busy);
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
      if (next.error) {
        // The machine refused this computer while reconnecting: its row says so and offers Pair
        // again, which is why no banner repeats it (`errorShownOnRow`).
        if (retryMachine && /\[RPC_AUTHORIZATION\]/.test(next.error))
          recordRemoteConnection(retryMachine.environmentId, next.error);
        setError(
          afterEdit.current
            ? `${t("The new address is saved. Edit it again, or choose Reconnect to retry.")}

${next.error}`
            : next.error,
        );
      } else if (next.machine) {
        setAdding(false);
        setEditing(undefined);
        const submitted = submittedAddDraft.current;
        if (submitted)
          setAddDraft((current) => (current === submitted ? EMPTY_SSH_DRAFT : current));
        setNotice(
          sshSetupSuccessNotice(
            afterEdit.current
              ? t("{p0} is connected through its new address.", {
                  p0: next.machine.name,
                })
              : updatingMachine
                ? t("{p0} was updated and reconnected.", {
                    p0: next.machine.name,
                  })
                : t("{p0} is connected.", { p0: next.machine.name }),
            next,
            next.machine.name,
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
      setError(sanitizeConnectionError(errorText(reason)));
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
  const begin = async (
    machine?: RemoteMachine,
    upgrade = false,
    edited = false,
    plan?: SshAddPlan,
  ) => {
    if (submitting.current) return;
    if (upgrade && machine) {
      submitting.current = true;
      try {
        const approved = await confirmInApp({
          title: t("Update Host on {p0}?", { p0: machine.name }),
          message: t("The selected Host restarts. Other machines are not updated."),
          body: <UpdateImpact target={{ machineId: machine.id }} />,
          confirmLabel: t("Stop and update"),
          tone: "danger",
        });
        if (!approved || !alive.current) return;
      } finally {
        submitting.current = false;
      }
    }
    setView("machines");
    // A found machine brings its own address, so the form is skipped.
    const fields = plan
      ? {
          name: plan.name,
          target: plan.target,
          port: plan.port ? String(plan.port) : "",
          alternate: plan.alternate ?? "",
        }
      : sshFields(false);
    const parsed = machine ? undefined : parseMachineDraft(fields);
    if (parsed && !parsed.ok) return setError(parsed.error);
    submitting.current = true;
    submittedAddDraft.current = machine || plan ? undefined : addDraft;
    afterEdit.current = edited;
    setBusy(true);
    setError("");
    setNotice("");
    clearSnapshot();
    setConnectionName(machine?.name ?? (fields.name.trim() || fields.target.trim()));
    setRemoving(undefined);
    // The connection shows its progress and prompts on the page, so the add dialog closes;
    // a typed address keeps its draft until the connection succeeds.
    setAdding(false);
    setEditing(undefined);
    setRetryMachine(machine);
    setUpdatingMachine(upgrade ? machine?.id : undefined);
    try {
      const id = machine
        ? await invoke<string>("remote_ssh_reconnect", {
            machineId: machine.id,
            ...(upgrade ? { upgrade: true } : {}),
          })
        : await invoke<string>("remote_ssh_begin", {
            target: fields.target.trim(),
            name: fields.name.trim(),
            port: fields.port ? Number(fields.port) : null,
            alternate: parsed?.ok ? parsed.value.alternate : null,
            ...(plan?.environmentId ? { expectedEnvironmentId: plan.environmentId } : {}),
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
        setError(sanitizeConnectionError(errorText(reason)));
        setBusy(false);
      }
    }
  };
  // A machine that refused this computer's credential is set up again over its saved SSH
  // address; the finished setup takes over the saved entry instead of adding a duplicate.
  const pairAgain = (machine: RemoteMachine) => {
    if (!machine.ssh) return;
    void begin(undefined, false, false, {
      target: machine.ssh.target,
      alternate: machine.ssh.alternate ?? null,
      name: machine.name,
      port: machine.ssh.port ?? null,
    });
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
      .catch((reason) => setError(sanitizeConnectionError(errorText(reason))))
      .finally(() => setBusy(false));
  };
  const startEdit = (machine: RemoteMachine) => {
    setView("machines");
    setEditing(machine);
    setEditDraft({
      remotePort: "",
      alternate: "",
      ...draftFromMachine(machine),
    });
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
    if (!parsed.ok) return setError(parsed.error);
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
      setError(sanitizeConnectionError(errorText(reason)));
    }
  };
  useConnectionRequestInbox({
    machines,
    busy,
    // Other views send "add a machine" here; the add dialog opens on the found computers.
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
          // The translated sentence is the reason, shown whole; only the raw cause is sanitized,
          // and it waits behind Details after the blank line.
          setError(
            `${t(
              "{p0} was not removed because access could not be revoked. Reconnect and try again, or remove it from this desktop only and revoke it on the host with bycoda-host devices and bycoda-host revoke <device-id>.",
              { p0: machine.name },
            )}\n\n${sanitizeConnectionError(errorText(reason))}`,
          );
          return;
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
      setError(sanitizeConnectionError(errorText(reason)));
    } finally {
      if (alive.current) setRevoking(false);
    }
  };
  // A failure is "reason" + blank line + "cause": the reason is the body, the cause waits behind Details.
  const [errorReason = "", ...errorRest] = error.split("\n\n");
  const errorParts = { reason: errorReason, cause: errorRest.join("\n\n").trim() };
  // A refused credential is the machine row's message, with its Pair again action; no banner repeats it.
  const errorShownOnRow = Boolean(retryMachine) && /\[RPC_AUTHORIZATION\]/.test(error);
  const removingMachine = removing
    ? machines.find((machine) => machine.id === removing)
    : undefined;
  const parsedDraft = parseMachineDraft(sshFields(Boolean(editing)));
  const saveLabel =
    editing && parsedDraft.ok && !editImpact(editing, parsedDraft.value).reconnect
      ? "Save"
      : "Save and reconnect";
  const machineForm = adding ? (
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
  ) : null;
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
          <Tab value="machines">{t("Computers")}</Tab>
          <Tab value="phone">{t("Devices")}</Tab>
          <Tab value="tunnels">{t("Sharing")}</Tab>
        </TabList>
        <TabPanel value="machines" keepMounted tabIndex={-1} className="connections-view">
          <SectionLabel
            as="h2"
            count={shownMachines.length || undefined}
            actions={
              <Button
                variant="primary"
                disabled={busy || revoking}
                disabledReason={
                  busy || revoking ? t("Wait for the current action to finish.") : undefined
                }
                aria-haspopup="dialog"
                onClick={startAdd}
              >
                <Plus aria-hidden className="icon-sm" />
                {t("Add a computer")}
              </Button>
            }
          >
            {t("Your computers")}
          </SectionLabel>
          {loadError ? (
            <RemoteDataStatus
              label={t("machines")}
              state={{ phase: "error", error: loadError }}
              onRefresh={refresh}
            />
          ) : null}
          {/* Search earns its row only once the list is long enough to scan. */}
          {machines.length > MACHINE_SEARCH_FROM || query ? (
            <SearchInput
              standalone
              appearance="field"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              textSize="secondary"
              placeholder={t("Search computers")}
              aria-label={t("Search computers")}
            />
          ) : null}
          {busy && jobId && (
            <SshSetupProgress
              ref={progress}
              name={connectionName}
              job={job}
              stopping={stoppingJob === jobId}
              onStop={() => {
                setStoppingJob(jobId);
                void cancel(jobId).catch((reason) => {
                  setStoppingJob(undefined);
                  setError(sanitizeConnectionError(errorText(reason)));
                });
              }}
              prompt={
                job?.prompt ? (
                  <SshSetupPromptForm key={job.prompt.id} prompt={job.prompt} onRespond={respond} />
                ) : null
              }
            />
          )}
          {error && !adding && !removing && !errorShownOnRow ? (
            <Alert
              tone="danger"
              title={!busy && retryMachine ? retryMachine.name : undefined}
              action={
                !busy && retryMachine
                  ? { label: t("Retry connection"), onClick: () => void begin(retryMachine) }
                  : undefined
              }
              secondaryAction={
                !busy && retryMachine
                  ? { label: t("Edit name and address…"), onClick: () => startEdit(retryMachine) }
                  : undefined
              }
              extra={
                errorParts.cause ? (
                  <ErrorDetails title={errorParts.reason} detail={errorParts.cause} />
                ) : undefined
              }
            >
              {errorParts.reason}
            </Alert>
          ) : null}
          {notice && <InlineMessage tone="success">{notice}</InlineMessage>}
          <section aria-label={t("Your computers")}>
            <div className="connections-management-grid">
              {shownMachines.length > 0 ? (
                <Surface variant="card" padding="none" dividers="card" className="min-w-0">
                  {shownMachines.map((machine) => (
                    <MachineRow
                      key={machine.id}
                      machine={machine}
                      machines={machines}
                      probed={status[machine.id]}
                      version={versions[machine.id]}
                      needsUpdate={Boolean(needsUpdate[machine.id])}
                      showDetails={detailMachine === machine.id}
                      editing={editing?.id === machine.id}
                      busy={busy}
                      revoking={revoking}
                      menuOpen={rowMenu?.machine.id === machine.id}
                      onUpdateHost={() => void begin(machine, true)}
                      onReconnect={() => void begin(machine)}
                      onPairAgain={() => pairAgain(machine)}
                      onSyncNow={() => void syncNow(machine.id)}
                      onToggleDetails={() =>
                        setDetailMachine((current) =>
                          current === machine.id ? undefined : machine.id,
                        )
                      }
                      onToggleMenu={(anchor) =>
                        setRowMenu(
                          rowMenu?.machine.id === machine.id ? undefined : { machine, anchor },
                        )
                      }
                    />
                  ))}
                </Surface>
              ) : loaded && !loading && !loadError ? (
                needle ? (
                  <EmptyState
                    size="inline"
                    kind="filtered"
                    description={t("No matches")}
                    onReset={() => setQuery("")}
                  />
                ) : (
                  <EmptyState
                    kind="empty"
                    illustration={false}
                    title={t("No computers yet")}
                    description={t("Add a computer to open its projects and sessions from here.")}
                  />
                )
              ) : (
                <div>{loading ? <LoadingText /> : null}</div>
              )}
              <div>
                <RemoteReconnectGroup />
              </div>
            </div>
          </section>
          {editing && view === "machines" ? (
            <Modal
              title={t("Edit {p0}", { p0: editing.name })}
              size="md"
              closeDisabled={busy}
              onClose={closeForm}
            >
              {machineForm}
            </Modal>
          ) : null}
          {adding && !editing && view === "machines" ? (
            <AddComputerDialog
              saved={machines}
              busy={busy || revoking}
              form={machineForm}
              initialView={addDraft.target.trim() || method === "url" ? "manual" : "found"}
              onAdd={(plan) => void begin(undefined, false, false, plan)}
              onPaired={() => {
                closeForm();
                void refresh();
              }}
              onClose={closeForm}
            />
          ) : null}
          {rowMenu ? (
            <DropdownMenu
              anchor={rowMenu.anchor}
              label={t("Actions for {p0}", {
                p0: machineLabel(machines, rowMenu.machine),
              })}
              items={[
                { kind: "item", id: "sync", label: t("Sync now") },
                { kind: "item", id: "details", label: t("Connection details") },
                ...(rowMenu.machine.ssh
                  ? [
                      {
                        kind: "item" as const,
                        id: "reconnect",
                        label: t("Reconnect"),
                      },
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
            <PairedDevicesPanel
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
            <ExternalTunnelsPanel
              machines={machines}
              loaded={loaded}
              loading={loading}
              active={view === "tunnels"}
            />
          </TabPanel>
        ) : null}
      </Tabs>
    </div>
  );
}
