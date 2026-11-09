import { Alert } from "../../../shared/ui/Alert";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { NumberField } from "../../../shared/ui/NumberField";
import { TextField } from "../../../shared/ui/TextField";
import { Button } from "../../../shared/ui/Button";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { invoke } from "@tauri-apps/api/core";
import { RemoteReconnectGroup } from "../../settings/public/ConnectionRecoverySettings";
import { Tab, TabList, TabPanel, Tabs } from "../../../shared/ui/Tabs";
import { Tooltip, OverflowTooltip } from "../../../shared/ui/Tooltip";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Surface } from "../../../shared/ui/Surface";
import "./connections-settings.css";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { PasswordField } from "../../../shared/ui/PasswordField";
import { ConnectionSyncLine } from "./ConnectionSyncLine";
import { MachineRoutesLine } from "./MachineRoutesLine";
import { classifyRemoteError } from "../model/remoteFailure";
import { SshSetupPromptForm } from "./SshSetupPromptForm";
import { useConnectionRequestInbox } from "./useConnectionRequestInbox";
import { useSshSetupJob } from "./useSshSetupJob";
import { RemoteOutboxNotice } from "./RemoteOutboxNotice";
import { LocalHostUpdateNotice } from "./LocalHostUpdateNotice";
import { PhoneConnectionPanel } from "./PhoneConnectionPanel";
import { ExternalTunnelsPanel } from "./ExternalTunnelsPanel";
import { RemoteDataStatus } from "./RemoteDataStatus";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Internet, MoreHorizontal, Plus, RefreshCw } from "../../../shared/ui/icons";
import {
  connectMachine,
  disconnectMachine,
  recordRemoteCapabilities,
  refreshRemoteMachines,
  remoteRequest,
  reportRemoteMachineStatus,
  updateMachine,
  useRemoteMachines,
} from "../model/connections";
import {
  draftFromMachine,
  editImpact,
  hostnameSuggestion,
  parseMachineDraft,
} from "../model/machineEdit";
import { isLocalSyncMachine } from "../model/localSync";
import { syncNow } from "../../sync/model/syncClient";
import {
  notifyRemoteRecovered,
  readRemoteConnection,
  subscribeChanges,
} from "../model/remoteHealth";
import { connectionIndicator } from "../model/remoteConnection";
import { machineContext, machineLabel } from "../model/machineIdentity";
import { REMOTE_PROVIDERS, type HostDescriptor, type RemoteMachine } from "../model/protocol";

/** What this page's own check learned about a machine. */
type MachineProbe = "connected" | "provider" | "update" | "offline";

const PROBE_DETAIL: Record<MachineProbe, string> = {
  connected: "Connected",
  provider: "Connected · install a supported provider on the host",
  update: "Connected · host update needed for Explorer and Changes",
  offline: "Offline · reconnect to check access",
};
const PROBE_LABEL: Record<MachineProbe, string> = {
  connected: "Connected",
  provider: "Provider needed",
  update: "Update needed",
  offline: "Offline",
};
const PROBE_TONE: Record<MachineProbe, BadgeTone> = {
  connected: "success",
  provider: "warning",
  update: "warning",
  offline: "warning",
};

/** A machine's connection line. Until this page's own check returns, it shows
 * what the rest of the app (the project rail) last learned about the machine,
 * so the two never disagree. */
function MachineConnectionLine({
  environmentId,
  probed,
}: {
  environmentId: string;
  probed?: MachineProbe;
}) {
  const shared = useSyncExternalStore(
    subscribeChanges,
    () => readRemoteConnection(environmentId),
    () => readRemoteConnection(environmentId),
  );
  const indicator = connectionIndicator(shared, false);
  const kind: MachineProbe | undefined =
    indicator.tone === "down"
      ? "offline"
      : (probed ?? (indicator.tone === "connected" ? "connected" : undefined));
  const label = kind ? PROBE_LABEL[kind] : "Checking connection…";
  const tone: BadgeTone = kind ? PROBE_TONE[kind] : "neutral";
  const detail = kind && kind !== "connected" ? t(PROBE_DETAIL[kind]) : undefined;
  return (
    <>
      <Badge variant="dot" size="sm" tone={tone}>
        {t(label)}
      </Badge>
      {detail ? (
        <span className="basis-full text-ui-caption text-(--ui-text-muted)">{detail}</span>
      ) : null}
    </>
  );
}

export function ConnectionsSettings() {
  useLocale();
  const [view, setView] = useState("machines");
  const [visited, setVisited] = useState<string[]>(["machines"]);
  const { machines, loaded, loading, error: loadError, refresh } = useRemoteMachines();
  const [adding, setAdding] = useState(false);
  // The machine whose definition the form edits; none when it adds one.
  const [editing, setEditing] = useState<RemoteMachine>();
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [port, setPort] = useState("");
  const [remotePort, setRemotePort] = useState("");
  const [alternate, setAlternate] = useState("");
  const [connectionName, setConnectionName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryMachine, setRetryMachine] = useState<RemoteMachine>();
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState<Record<string, MachineProbe>>({});
  const [needsUpdate, setNeedsUpdate] = useState<Record<string, boolean>>({});
  const [updatingMachine, setUpdatingMachine] = useState<string>();
  const [removing, setRemoving] = useState<string>();
  const [revoking, setRevoking] = useState(false);
  const [removeMode, setRemoveMode] = useState<"revoke" | "local">("local");
  const [detailMachine, setDetailMachine] = useState<string>();
  const [rowMenu, setRowMenu] = useState<{
    machine: RemoteMachine;
    anchor: HTMLElement;
  }>();
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
        setTarget("");
        setName("");
        setPort("");
        setAlternate("");
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
    },
    onFailed: (reason) => {
      setError(String(reason));
      submitting.current = false;
      setBusy(false);
    },
    onError: setError,
  });
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let running = false;
    const check = async () => {
      running = true;
      // Nobody sees the status while the window is hidden; the visibility
      // listener below re-checks as soon as it returns.
      if (!busy && !document.hidden)
        await Promise.all(
          machines.map(async (machine) => {
            let label: MachineProbe = "connected";
            try {
              const host = await remoteRequest<HostDescriptor>(machine.id, "environment.describe", {
                supportedProviders: REMOTE_PROVIDERS,
              });
              if (host.environmentId !== machine.environmentId)
                throw new Error("Host identity changed. Add this machine again before continuing.");
              recordRemoteCapabilities(host.environmentId, host.capabilities);
              // The project rail shows the same machine; keep both in step.
              reportRemoteMachineStatus(machine.id, true);
              if (!host.providers.length) label = "provider";
              const update =
                !host.capabilities?.includes("workspace.run") ||
                !host.capabilities?.includes("git.worktreeCreate");
              if (update) label = "update";
              if (!disposed)
                setNeedsUpdate((current) => ({
                  ...current,
                  [machine.id]: update,
                }));
            } catch (reason) {
              // A busy or slow Host (for example while this computer builds) is not
              // offline: keep the last status and check again on the next round.
              if (classifyRemoteError(reason).kind === "temporary") return;
              label = "offline";
              reportRemoteMachineStatus(machine.id, false, reason);
            }
            if (!disposed) setStatus((current) => ({ ...current, [machine.id]: label }));
          }),
        );
      running = false;
      if (!disposed) timer = setTimeout(() => void check(), 10_000);
    };
    const onVisible = () => {
      if (document.hidden || running || disposed) return;
      clearTimeout(timer);
      void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    void check();
    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [machines, busy]);
  const begin = async (machine?: RemoteMachine, upgrade = false, edited = false) => {
    if (submitting.current) return;
    setView("machines");
    const parsed = machine ? undefined : parseMachineDraft({ name, target, port, alternate });
    if (parsed && !parsed.ok) return setError(t(parsed.error));
    submitting.current = true;
    afterEdit.current = edited;
    setBusy(true);
    setError("");
    setNotice("");
    clearSnapshot();
    setConnectionName(machine?.name ?? (name.trim() || target.trim()));
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
            target: target.trim(),
            name: name.trim(),
            port: port ? Number(port) : null,
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
  const startEdit = (machine: RemoteMachine) => {
    setView("machines");
    const draft = draftFromMachine(machine);
    setEditing(machine);
    setName(draft.name);
    setTarget(draft.target);
    setPort(draft.port);
    setRemotePort(draft.remotePort ?? "");
    setAlternate(draft.alternate ?? "");
    setAdding(true);
    setError("");
    setNotice("");
    setRemoving(undefined);
    clearSnapshot();
  };
  const closeForm = () => {
    setAdding(false);
    setEditing(undefined);
    setTarget("");
    setName("");
    setPort("");
    setRemotePort("");
    setAlternate("");
  };
  const startAdd = () => {
    closeForm();
    setView("machines");
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
    const parsed = parseMachineDraft({ name, target, port, alternate, remotePort });
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
  const suggestion = hostnameSuggestion(target, editing?.name ?? "");
  const draft = parseMachineDraft({
    name,
    target,
    port,
    alternate,
    ...(editing ? { remotePort } : {}),
  });
  const saveLabel =
    editing && draft.ok && !editImpact(editing, draft.value).reconnect
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
          <Tab value="machines">{t("Your machines")}</Tab>
          <Tab value="phone">{t("Connect your phone")}</Tab>
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
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-ui-body font-medium">
              {t("Machines · {p0}", { p0: machines.length })}
            </h2>
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
            <form
              key={editing?.id ?? "new-machine"}
              aria-label={editing ? t("Edit {p0}", { p0: editing.name }) : t("Add a new machine")}
              onSubmit={(event) => {
                event.preventDefault();
                void (editing ? save() : begin());
              }}
            >
              <Surface variant="outline" padding="lg" className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-ui-body font-medium">
                    {editing ? t("Edit {p0}", { p0: editing.name }) : t("Add a new machine")}
                  </h3>
                  <div className="flex items-center gap-1">
                    <Badge size="sm">{"SSH"}</Badge>
                    <InfoPopover label={t("Connection help")} width={360}>
                      <p>
                        {editing
                          ? t(
                              "Changes apply to this machine. To connect a different computer, choose Add machine.",
                            )
                          : t(
                              "Connect a different computer with its own SSH address. Existing machines stay saved.",
                            )}
                      </p>
                      <p>
                        {t("A hostname works too, such as a Mac's Bonjour name (")}
                        <code>{"user@MacBook-Pro.local"}</code>
                        {t(") or an alias from")} <code>{"~/.ssh/config"}</code>
                        {t(". Then the address does not need editing when the IP changes.")}
                      </p>
                      <p>
                        {t(
                          "Optional fallback for this same machine, such as its Tailscale address. If the first address cannot connect,",
                        )}{" "}
                        {PRODUCT_IDENTITY.displayName}
                        {t(
                          " automatically tries this one. Both addresses stay saved and use the same SSH port. The other address is checked against this machine's known host key.",
                        )}
                      </p>
                      <p>
                        {t(
                          "Enable SSH on the target computer and make sure this computer can reach it with your SSH key or password. Sign in to the agent provider on the target computer before running agents.",
                        )}
                      </p>
                      {editing ? (
                        <p>
                          {t(
                            "Saving a new address closes the current connection and connects to it. If this computer has not connected to that address before, SSH asks you here whether to trust its host key. The machine's projects, sessions and history stay linked to it. If the address turns out to be another machine, the change stays saved so you can fix it; nothing is installed there.",
                          )}
                        </p>
                      ) : (
                        <>
                          <p>
                            {PRODUCT_IDENTITY.displayName}
                            {t(
                              " installs and starts its background host, then connects securely. Your SSH keys and config are used automatically. Enable SSH on the host and sign in to Codex or Claude Code there. On Windows and Mac, keep the host’s desktop account signed in and the machine awake. Locking the desktop is fine.",
                            )}
                          </p>
                          <p>
                            {t(
                              "On Linux, setup installs a systemd user service and turns on lingering for your account (",
                            )}
                            <code>{"loginctl enable-linger"}</code>
                            {t(
                              "), so the host and your other user services keep running after you log out. The host keeps running until you stop it on that machine; removing it here only disconnects this desktop.",
                            )}
                          </p>
                        </>
                      )}
                    </InfoPopover>
                  </div>
                </div>
                <p className="text-ui-caption text-(--ui-text-muted)">
                  {editing
                    ? t("Saving reconnects this machine with the updated address.")
                    : t("Installs bycoda Host over SSH so you can run agents on this machine.")}
                </p>
                <div className="flex flex-col gap-1.5">
                  <TextField
                    autoFocus
                    required
                    disabled={busy}
                    value={target}
                    onChange={(event) => setTarget(event.target.value)}
                    placeholder={t("user@my-mac-mini or an SSH alias")}
                    autoComplete="off"
                    spellCheck={false}
                    label={t("SSH address")}
                    fieldClassName="min-w-0 flex-1"
                  />
                  {suggestion && (
                    <Button
                      stableWidth
                      type="button"
                      disabled={busy}
                      tooltip={t("Fills the address. Nothing is saved or tested until you save.")}
                      onClick={() => setTarget(suggestion)}
                      variant="secondary"
                      align="start"
                    >
                      {t("Use ")}
                      {suggestion}
                      {t(" instead of the IP")}
                    </Button>
                  )}
                </div>
                <TextField
                  disabled={busy}
                  value={alternate}
                  onChange={(event) => setAlternate(event.target.value)}
                  placeholder={t("Optional, e.g. user@100.64.0.5 (Tailscale)")}
                  autoComplete="off"
                  spellCheck={false}
                  label={t("Other address (optional)")}
                  fieldClassName="min-w-0 flex-1"
                />
                <TextField
                  disabled={busy}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t("Optional, e.g. Home Mac mini")}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  label={t("Name (optional)")}
                  fieldClassName="min-w-0 flex-1"
                />
                {editing ? (
                  <NumberField
                    disabled={busy}
                    min={1}
                    max={65535}
                    name="hostPort"
                    value={remotePort}
                    onChange={(event) => setRemotePort(event.target.value)}
                    label={t("Host port")}
                    description={t(
                      "The Host service port on this machine, separate from the SSH port. Saving reconnects to this port without changing the service. Reconnects keep this value.",
                    )}
                    fieldClassName="min-w-0 flex-1"
                  />
                ) : null}
                <Disclosure
                  size="sm"
                  className="text-ui-caption text-(--ui-text-muted)"
                  summary={t("Advanced")}
                >
                  <div className="max-w-40">
                    <NumberField
                      disabled={busy}
                      min={1}
                      max={65535}
                      value={port}
                      onChange={(event) => setPort(event.target.value)}
                      placeholder={t("From SSH config")}
                      label={t("SSH port")}
                      fieldClassName="min-w-0 flex-1"
                    />
                  </div>
                </Disclosure>
                {error && <Alert tone="danger">{error}</Alert>}
                <ModalActions inline>
                  <Button
                    stableWidth
                    type="button"
                    disabled={busy}
                    onClick={closeForm}
                    variant="secondary"
                  >
                    {t("Cancel")}
                  </Button>
                  <Button
                    stableWidth
                    reserveLabels={[t("Saving…"), t("Connecting…")]}
                    loading={busy}
                    disabled={busy || !target.trim()}
                    variant="primary"
                    type="submit"
                  >
                    {editing
                      ? busy
                        ? t("Saving…")
                        : t(saveLabel)
                      : busy
                        ? t("Connecting…")
                        : t("Connect")}
                  </Button>
                </ModalActions>
              </Surface>
            </form>
          )}
          {busy && jobId && (
            <Surface
              variant="outline"
              padding="lg"
              className="flex flex-col gap-3"
              role="status"
              ref={progress}
            >
              <div className="break-all text-ui-secondary font-medium text-content">
                {connectionName}
              </div>
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
              <span className="text-ui-caption text-(--ui-text-muted)">
                {t("Remote target: {p0}", { p0: retryMachine.name })}
              </span>
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
            <Surface
              variant="outline"
              padding="none"
              className="divide-y divide-(--ui-pane-border) overflow-hidden"
            >
              {machines.map((machine) => (
                <div key={machine.id}>
                  <div
                    className={`flex flex-wrap items-center gap-3 px-4 py-3 ${editing?.id === machine.id ? "bg-selection" : ""}`}
                  >
                    <Internet
                      aria-hidden
                      className="icon-lg shrink-0 self-start text-(--ui-text-muted)"
                    />
                    <div className="min-w-0 flex-1 basis-48">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Tooltip
                          label={machine.name}
                          when={isLocalSyncMachine(machine) ? "always" : "overflow"}
                        >
                          <span className="truncate text-ui-secondary font-medium">
                            {isLocalSyncMachine(machine) ? t("This computer") : machine.name}
                          </span>
                        </Tooltip>
                        {machineContext(machines, machine) ? (
                          <OverflowTooltip label={machineContext(machines, machine)}>
                            <span className="min-w-0 truncate text-ui-caption text-(--ui-text-muted)">
                              {machineContext(machines, machine)}
                            </span>
                          </OverflowTooltip>
                        ) : null}
                        <span className="shrink-0 text-ui-caption text-(--ui-text-muted)">
                          {isLocalSyncMachine(machine) ? t("Local") : t("Remote computer")}
                        </span>
                        <MachineConnectionLine
                          environmentId={machine.environmentId}
                          probed={status[machine.id]}
                        />
                      </div>
                      <ConnectionSyncLine machineId={machine.id} />
                      {detailMachine === machine.id ||
                      status[machine.id] === "offline" ||
                      needsUpdate[machine.id] ? (
                        <div className="connection-details">
                          <MachineRoutesLine machine={machine} />
                          <div className="mt-1 break-all text-ui-caption text-(--ui-text-muted)">
                            {isLocalSyncMachine(machine)
                              ? t("Syncs projects and groups with the {p0} on this computer", {
                                  p0: PRODUCT_IDENTITY.displayName,
                                })
                              : machine.ssh
                                ? t("SSH · {p0}{p1}", { p0: machine.ssh.target, p1: "" })
                                : machine.endpoint}
                          </div>
                          {machine.ssh ? (
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-ui-micro text-(--ui-text-muted)">
                              <span>
                                {t("SSH port")}{" "}
                                <span className="font-mono text-content">
                                  {machine.ssh.port ?? t("From SSH config")}
                                </span>
                              </span>
                              <span>
                                {t("Host port")}{" "}
                                <span className="font-mono text-content">
                                  {machine.ssh.remotePort}
                                </span>
                              </span>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {machine.ssh && needsUpdate[machine.id] ? (
                        <div className="mt-1 text-ui-micro text-(--ui-text-muted)">
                          {t("Updating restarts the host and interrupts active agent turns.")}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {machine.ssh && needsUpdate[machine.id] ? (
                        <Button
                          stableWidth
                          disabled={busy}
                          tooltip={t(
                            "Downloads the matching host package and restarts the host; active agent turns will be interrupted",
                          )}
                          onClick={() => void begin(machine, true)}
                          variant="secondary"
                          className="shrink-0"
                          type="button"
                        >
                          {t("Update Host")}
                        </Button>
                      ) : machine.ssh && status[machine.id] === "offline" ? (
                        <Button
                          stableWidth
                          disabled={busy}
                          onClick={() => void begin(machine)}
                          variant="secondary"
                          className="shrink-0"
                          type="button"
                        >
                          {t("Reconnect")}
                        </Button>
                      ) : null}
                      <Button
                        stableWidth
                        iconOnly
                        variant="ghost"
                        label={t("Actions for {p0}", { p0: machineLabel(machines, machine) })}
                        aria-haspopup="menu"
                        aria-expanded={rowMenu?.machine.id === machine.id}
                        disabled={busy || revoking}
                        onClick={(event) =>
                          setRowMenu(
                            rowMenu?.machine.id === machine.id
                              ? undefined
                              : { machine, anchor: event.currentTarget },
                          )
                        }
                        type="button"
                      >
                        <MoreHorizontal aria-hidden className="icon-md" />
                      </Button>
                    </div>
                  </div>
                </div>
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
            <Modal
              onClose={() => {
                if (!revoking) setRemoving(undefined);
              }}
              title={t("Remove {p0} from this desktop?", { p0: removingMachine.name })}
              size="md"
              footer={
                <ModalActions>
                  <Button
                    stableWidth
                    type="button"
                    variant="ghost"
                    disabled={revoking}
                    onClick={() => setRemoving(undefined)}
                  >
                    {t("Cancel")}
                  </Button>
                  <Button
                    stableWidth
                    type="button"
                    variant="danger"
                    loading={revoking}
                    onClick={() => void remove(removingMachine, removeMode === "revoke")}
                  >
                    {removeMode === "revoke"
                      ? t("Revoke access and remove")
                      : t("Remove from this desktop only")}
                  </Button>
                </ModalActions>
              }
            >
              <div className="flex flex-col gap-3 text-ui-caption leading-relaxed text-(--ui-text-muted)">
                {isLocalSyncMachine(removingMachine) ? (
                  <p>
                    {t("Removing this stops syncing projects and groups with the")}{" "}
                    {PRODUCT_IDENTITY.displayName}
                    {t(" on this computer. It is created again automatically the next time")}{" "}
                    {PRODUCT_IDENTITY.displayName}
                    {t(" starts.")}
                  </p>
                ) : (
                  <p>
                    {t(
                      "This closes this desktop’s connection to the machine. It does not stop the host, and its sessions keep running and stay on that machine. You can add it again later.",
                    )}
                  </p>
                )}
                <RadioGroup
                  label={t("Remove")}
                  value={removeMode}
                  onValueChange={(next) => setRemoveMode(next === "revoke" ? "revoke" : "local")}
                  options={[
                    {
                      value: "local",
                      label: t("Remove from this desktop only"),
                      description: t(
                        "Removing alone leaves this desktop’s credential valid on the host. Revoke access to invalidate it first; the machine must be reachable.",
                      ),
                      disabled: revoking,
                    },
                    {
                      value: "revoke",
                      label: t("Revoke access and remove"),
                      disabled: revoking,
                    },
                  ]}
                />
                <Disclosure summary={t("Details")}>
                  <p>
                    {t("To stop the host and turn off its background service, run")}{" "}
                    <code>{"~/.bycoda-host/bin/bycoda-host service uninstall"}</code>{" "}
                    {t("on that machine (")}
                    <code>
                      {"%USERPROFILE%\\.bycoda-host\\bin\\bycoda-host.cmd service uninstall"}
                    </code>{" "}
                    {t("on Windows). Its sessions and history are kept.")}
                  </p>
                </Disclosure>
                {error ? <Alert tone="danger">{error}</Alert> : null}
              </div>
            </Modal>
          ) : null}
          {!adding && !removing ? (
            <Disclosure
              size="sm"
              className="connection-disclosure"
              summary={t("Connect to an existing host by URL")}
            >
              <form
                className="connection-url-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (busy) return;
                  setBusy(true);
                  setError("");
                  setNotice("");
                  setRetryMachine(undefined);
                  void connectMachine("", url, token)
                    .then((machine) => {
                      setToken("");
                      setNotice(t("{p0} is connected.", { p0: machine.name }));
                    })
                    .catch((reason) => setError(String(reason)))
                    .finally(() => setBusy(false));
                }}
              >
                <p>{t("Enter the host URL and a device token issued by that host.")}</p>
                <TextField
                  required
                  disabled={busy}
                  type="url"
                  autoComplete="url"
                  spellCheck={false}
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  label={t("Host URL")}
                  fieldClassName="min-w-0 flex-1"
                />
                <PasswordField
                  label={t("Device token")}
                  required
                  disabled={busy}
                  autoComplete="off"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                />
                <Button
                  stableWidth
                  reserveLabels={[t("Connecting…"), t("Retry connection")]}
                  loading={busy}
                  disabled={busy}
                  variant="secondary"
                  type="submit"
                >
                  {busy ? t("Connecting…") : error ? t("Retry connection") : t("Connect by URL")}
                </Button>
              </form>
            </Disclosure>
          ) : null}
          <RemoteReconnectGroup />
        </TabPanel>
        {visited.includes("phone") ? (
          <TabPanel value="phone" keepMounted tabIndex={-1} className="connections-view">
            <PhoneConnectionPanel
              machines={machines}
              loaded={loaded}
              loading={loading}
              onRefresh={refresh}
            />
          </TabPanel>
        ) : null}
        {visited.includes("tunnels") ? (
          <TabPanel value="tunnels" keepMounted tabIndex={-1} className="connections-view">
            <ExternalTunnelsPanel machines={machines} loaded={loaded} loading={loading} />
          </TabPanel>
        ) : null}
      </Tabs>
    </div>
  );
}
