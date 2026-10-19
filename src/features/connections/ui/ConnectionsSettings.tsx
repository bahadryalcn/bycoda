import { Alert } from "../../../shared/ui/Alert";
import { NumberField } from "../../../shared/ui/NumberField";
import { TextField } from "../../../shared/ui/TextField";
import { Button } from "../../../shared/ui/Button";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { invoke } from "@tauri-apps/api/core";
import { RemoteReconnectGroup } from "../../settings/ui/ConnectionRecoverySettings";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import "./connections-settings.css";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { PasswordField } from "../../../shared/ui/PasswordField";
import { RemoteOutboxNotice } from "./RemoteOutboxNotice";
import { LocalHostUpdateNotice } from "./LocalHostUpdateNotice";
import { PhoneConnectionPanel } from "./PhoneConnectionPanel";
import { ExternalTunnelsPanel } from "./ExternalTunnelsPanel";
import { RemoteDataStatus } from "./RemoteDataStatus";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Internet, Loader, Pencil, Plus, Trash2 } from "../../../shared/ui/icons";
import {
  connectMachine,
  disconnectMachine,
  recordRemoteCapabilities,
  refreshRemoteMachines,
  remoteRequest,
  reportRemoteMachineStatus,
  subscribeEditRequests,
  subscribeReconnectRequests,
  takeEditRequest,
  takeReconnectRequest,
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
import { subscribeMachineAddRequests, takeMachineAddRequest } from "../model/machineAdd";
import { syncNow } from "../../sync/model/syncClient";
import { describeSyncStatus } from "../../sync/model/syncStatusText";
import { useSyncStatus } from "../../sync/model/useSyncStatus";
import {
  notifyRemoteRecovered,
  readRemoteConnection,
  subscribeChanges,
} from "../model/remoteHealth";
import { connectionIndicator } from "../model/remoteConnection";
import {
  REMOTE_PROVIDERS,
  type HostDescriptor,
  type RemoteMachine,
  type SshSetup,
} from "../model/protocol";

/** A machine's connection line. Until this page's own check returns, it shows
 * what the rest of the app (the project rail) last learned about the machine,
 * so the two never disagree. */
function MachineConnectionLine({
  environmentId,
  probed,
}: {
  environmentId: string;
  probed?: string;
}) {
  const shared = useSyncExternalStore(
    subscribeChanges,
    () => readRemoteConnection(environmentId),
    () => readRemoteConnection(environmentId),
  );
  const indicator = connectionIndicator(shared, false);
  const label =
    indicator.tone === "down"
      ? indicator.label
      : (probed ?? (indicator.tone === "connected" ? "Connected" : "Checking connection…"));
  const tone: BadgeTone =
    indicator.tone === "down" || label.startsWith("Offline")
      ? "warning"
      : indicator.tone === "connected" || label.startsWith("Connected")
        ? "success"
        : "neutral";
  return (
    <Badge tone={tone} className="mbs-1">
      {t(label)}
    </Badge>
  );
}

function SyncLine({ machineId }: { machineId: string }) {
  useLocale();
  const sync = useSyncStatus(machineId);
  const failed = sync.state === "error";
  return (
    <div className="mt-1 flex items-center gap-2 text-[12px]">
      <span
        className={`min-w-0 truncate ${failed ? "text-danger" : "text-(--ui-text-muted)"}`}
        title={sync.lastError}
      >
        {describeSyncStatus(sync, Date.now())}
      </span>
      <Button
        disabled={sync.state === "syncing"}
        onClick={() => void syncNow(machineId)}
        variant="secondary"
        type="button"
      >
        {t("Sync now")}
      </Button>
    </div>
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
  const [jobId, setJobId] = useState<string>();
  const [connectionName, setConnectionName] = useState("");
  const [job, setJob] = useState<SshSetup>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryMachine, setRetryMachine] = useState<RemoteMachine>();
  const [notice, setNotice] = useState("");
  const [answer, setAnswer] = useState("");
  const [answering, setAnswering] = useState(false);
  const [status, setStatus] = useState<Record<string, string>>({});
  const [needsUpdate, setNeedsUpdate] = useState<Record<string, boolean>>({});
  const [updatingMachine, setUpdatingMachine] = useState<string>();
  const [removing, setRemoving] = useState<string>();
  const [revoking, setRevoking] = useState(false);
  const [url, setUrl] = useState("http://127.0.0.1:3776");
  const [token, setToken] = useState("");
  const alive = useRef(true);
  const currentJob = useRef<string | undefined>(undefined);
  const submitting = useRef(false);
  // The running connection follows an edit, so its outcome is worded for one.
  const afterEdit = useRef(false);
  const progress = useRef<HTMLDivElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (currentJob.current)
        void invoke("remote_ssh_cancel", { jobId: currentJob.current }).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!jobId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await invoke<SshSetup>("remote_ssh_poll", { jobId });
        if (disposed) return;
        setJob(next);
        if (next.done) {
          currentJob.current = undefined;
          submitting.current = false;
          setBusy(false);
          setJobId(undefined);
          setAnswer("");
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
              [next.machine!.id]: "Connected",
            }));
            refreshRemoteMachines();
            // Views that were waiting on this machine reload now.
            notifyRemoteRecovered(next.machine.environmentId);
          }
          afterEdit.current = false;
          return;
        }
      } catch (reason) {
        if (disposed) return;
        setError(String(reason));
        void invoke("remote_ssh_cancel", { jobId }).catch(() => {});
        currentJob.current = undefined;
        submitting.current = false;
        setBusy(false);
        setJobId(undefined);
        return;
      }
      timer = setTimeout(() => void poll(), 350);
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [jobId, updatingMachine]);
  useEffect(() => {
    setAnswer("");
    setAnswering(false);
    if (job?.prompt)
      progress.current?.scrollIntoView?.({
        block: "nearest",
        behavior: "smooth",
      });
  }, [job?.prompt?.id]);
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
            let label = "Connected";
            try {
              const host = await remoteRequest<HostDescriptor>(machine.id, "environment.describe", {
                supportedProviders: REMOTE_PROVIDERS,
              });
              if (host.environmentId !== machine.environmentId)
                throw new Error("Host identity changed");
              recordRemoteCapabilities(host.environmentId, host.capabilities);
              // The project rail shows the same machine; keep both in step.
              reportRemoteMachineStatus(machine.id, true);
              if (!host.providers.length)
                label = "Connected · install a supported provider on the host";
              const update =
                !host.capabilities?.includes("workspace.run") ||
                !host.capabilities?.includes("git.worktreeCreate");
              if (update) label = "Connected · host update needed for Explorer and Changes";
              if (!disposed)
                setNeedsUpdate((current) => ({
                  ...current,
                  [machine.id]: update,
                }));
            } catch (reason) {
              label = "Offline · reconnect to check access";
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
    setJob(undefined);
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
        await invoke("remote_ssh_cancel", { jobId: id });
        return;
      }
      currentJob.current = id;
      setJobId(id);
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
    setJob(undefined);
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
    setJob(undefined);
    setError("");
    setNotice("");
    setRemoving(undefined);
  };
  useEffect(() => {
    const start = () => {
      if (!busy && takeMachineAddRequest()) startAdd();
    };
    start();
    return subscribeMachineAddRequests(start);
    // `startAdd` only resets the existing editor's state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);
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
  // A view that cannot reach a machine asks for its address to be edited here.
  useEffect(() => {
    const start = () => {
      const machine = takeEditRequest(machines);
      if (machine?.ssh) startEdit(machine);
    };
    start();
    return subscribeEditRequests(start);
    // `startEdit` only sets state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machines]);
  // A view that cannot reach a machine asks for it to be reconnected here, where
  // the SSH prompts are answered.
  useEffect(() => {
    const start = () => {
      const machine = takeReconnectRequest(machines);
      if (machine?.ssh) void begin(machine);
    };
    start();
    return subscribeReconnectRequests(start);
    // `begin` only reads refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machines]);
  const respond = async (value: string) => {
    if (!jobId || !job?.prompt || answering) return;
    setAnswering(true);
    setError("");
    try {
      await invoke("remote_ssh_answer", {
        jobId,
        promptId: job.prompt.id,
        answer: value,
      });
      setAnswer("");
    } catch (reason) {
      setError(String(reason));
      setAnswering(false);
    }
  };
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
      <fieldset disabled={busy || revoking} className="min-w-0 border-0 p-0 m-0">
        <SegmentedControl
          label={t("Connections")}
          value={view}
          onValueChange={(next) => {
            if (busy || revoking) return;
            setView(next);
            setVisited((previous) => (previous.includes(next) ? previous : [...previous, next]));
          }}
          options={[
            { value: "machines", label: t("Your machines") },
            { value: "phone", label: t("Connect your phone") },
            { value: "tunnels", label: t("Sharing") },
          ]}
        />
      </fieldset>
      {busy || revoking ? (
        <p className="text-[12px] text-(--ui-text-muted)">
          {t("Finish or cancel the current connection before adding another machine.")}
        </p>
      ) : null}
      <div className="connections-view" hidden={view !== "machines"}>
        <RemoteDataStatus
          label={t("machines")}
          state={{
            phase: loading
              ? machines.length
                ? "refreshing"
                : "loading"
              : loadError
                ? "error"
                : machines.length
                  ? "ready"
                  : "empty",
            error: loadError,
          }}
          onRefresh={refresh}
        />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold text-content">{t("Your machines")}</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-(--ui-text-muted)">
              {t("Manage the computers where your agents run.")}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Button disabled={busy} onClick={startAdd} variant="primary" type="button">
              <Plus className="size-4" />
              {t(" Add machine")}
            </Button>
          </div>
        </div>
        {adding && (
          <form
            key={editing?.id ?? "new-machine"}
            aria-label={editing ? t("Edit {p0}", { p0: editing.name }) : t("Add a new machine")}
            className="flex flex-col gap-4 rounded-xl border border-stroke p-5"
            onSubmit={(event) => {
              event.preventDefault();
              void (editing ? save() : begin());
            }}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[14px] font-medium">
                {editing ? t("Edit {p0}", { p0: editing.name }) : t("Add a new machine")}
              </h3>
              <span className="rounded bg-selection px-2 py-1 text-[11px] text-(--ui-text-muted)">
                {"SSH"}
              </span>
            </div>
            <p className="text-xs text-(--ui-text-muted)">
              {editing
                ? t("Saving reconnects this machine with the updated address.")
                : t("Installs bycoda Host over SSH so you can run agents on this machine.")}
            </p>
            <div className="flex flex-col gap-1.5 text-xs text-(--ui-text-muted)">
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
              <details className="text-xs leading-relaxed text-(--ui-text-muted)">
                <summary className="cursor-pointer">{t("Address help")}</summary>
                <p className="mbs-2">
                  {t("A hostname works too, such as a Mac's Bonjour name (")}
                  <code className="rounded bg-(--ui-surface-raised) px-1">
                    {"user@MacBook-Pro.local"}
                  </code>
                  {t(") or an alias from")}{" "}
                  <code className="rounded bg-(--ui-surface-raised) px-1">{"~/.ssh/config"}</code>
                  {t(". Then the address does not need editing when the IP changes.")}
                </p>
              </details>
              {suggestion && (
                <Button
                  type="button"
                  disabled={busy}

                  title={t("Fills the address. Nothing is saved or tested until you save.")}
                  onClick={() => setTarget(suggestion)}
                  variant="secondary"
                >
                  {t("Use ")}
                  {suggestion}
                  {t(" instead of the IP")}
                </Button>
              )}
            </div>
            <div className="flex flex-col gap-1.5 text-xs text-(--ui-text-muted)">
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
              <details className="text-xs leading-relaxed text-(--ui-text-muted)">
                <summary className="cursor-pointer">{t("Fallback address help")}</summary>
                <p className="mbs-2">
                  {t(
                    "Optional fallback for this same machine, such as its Tailscale address. If the first address cannot connect,",
                  )}{" "}
                  {PRODUCT_IDENTITY.displayName}
                  {t(
                    " automatically tries this one. Both addresses stay saved and use the same SSH port. The other address is checked against this machine's known host key.",
                  )}
                </p>
              </details>
            </div>
            <label className="flex flex-col gap-1.5 text-[12px] text-(--ui-text-muted)">
              {t("Name (optional)")}
              <TextField
                disabled={busy}

                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("Optional, e.g. Home Mac mini")}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                label=""
                hideLabel
                fieldClassName="min-w-0 flex-1"
              />
            </label>
            {editing ? (
              <label className="flex flex-col gap-1.5 text-[12px] text-(--ui-text-muted)">
                {t("Host port")}
                <NumberField
                  aria-label={t("Host port")}
                  disabled={busy}

                  min={1}
                  max={65535}

                  value={remotePort}
                  onChange={(event) => setRemotePort(event.target.value)}
                  label=""
                  hideLabel
                  fieldClassName="min-w-0 flex-1"
                />
                <span className="text-[11px] leading-relaxed text-(--ui-text-muted)">
                  {t(
                    "The Host service port on this machine, separate from the SSH port. Saving reconnects to this port without changing the service. Reconnects keep this value.",
                  )}
                </span>
              </label>
            ) : null}
            <details className="text-[12px] text-(--ui-text-muted)">
              <summary className="cursor-pointer py-1">{t("Advanced")}</summary>
              <label className="mt-3 flex max-w-40 flex-col gap-1.5">
                {t("SSH port")}
                <NumberField
                  disabled={busy}

                  min={1}
                  max={65535}

                  value={port}
                  onChange={(event) => setPort(event.target.value)}
                  placeholder={t("From SSH config")}
                  label=""
                  hideLabel
                  fieldClassName="min-w-0 flex-1"
                />
              </label>
            </details>
            <details className="text-[12px] text-(--ui-text-muted)">
              <summary className="cursor-pointer py-1">{t("Connection help")}</summary>
              <div className="mbs-3 flex flex-col gap-2">
                <p className="text-[12px] leading-relaxed text-(--ui-text-muted)">
                  {editing
                    ? t(
                        "Changes apply to this machine. To connect a different computer, choose Add machine.",
                      )
                    : t(
                        "Connect a different computer with its own SSH address. Existing machines stay saved.",
                      )}
                </p>
                <p className="text-[12px] leading-relaxed text-(--ui-text-muted)">
                  {t(
                    "Enable SSH on the target computer and make sure this computer can reach it with your SSH key or password. Sign in to the agent provider on the target computer before running agents.",
                  )}
                </p>

                {editing ? (
                  <p className="text-[12px] leading-relaxed text-(--ui-text-muted)">
                    {t(
                      "Saving a new address closes the current connection and connects to it. If this computer has not connected to that address before, SSH asks you here whether to trust its host key. The machine's projects, sessions and history stay linked to it. If the address turns out to be another machine, the change stays saved so you can fix it; nothing is installed there.",
                    )}
                  </p>
                ) : (
                  <>
                    <p className="text-[12px] leading-relaxed text-(--ui-text-muted)">
                      {PRODUCT_IDENTITY.displayName}
                      {t(
                        " installs and starts its background host, then connects securely. Your SSH keys and config are used automatically. Enable SSH on the host and sign in to Codex or Claude Code there. On Windows and Mac, keep the host’s desktop account signed in and the machine awake. Locking the desktop is fine.",
                      )}
                    </p>
                    <p className="text-[12px] leading-relaxed text-(--ui-text-muted)">
                      {t(
                        "On Linux, setup installs a systemd user service and turns on lingering for your account (",
                      )}
                      <code className="rounded bg-(--ui-surface-raised) px-1">
                        {"loginctl enable-linger"}
                      </code>
                      {t(
                        "), so the host and your other user services keep running after you log out. The host keeps running until you stop it on that machine; removing it here only disconnects this desktop.",
                      )}
                    </p>
                  </>
                )}
              </div>
            </details>
            {error && (
              <Alert role="alert" tone="danger">
                {error}
              </Alert>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                disabled={busy}

                onClick={closeForm}
                variant="secondary"
              >
                {t("Cancel")}
              </Button>
              <Button disabled={busy || !target.trim()} variant="primary" type="submit">
                {editing
                  ? busy
                    ? t("Saving…")
                    : t(saveLabel)
                  : busy
                    ? t("Connecting…")
                    : t("Connect")}
              </Button>
            </div>
          </form>
        )}
        {busy && jobId && (
          <div
            className="flex flex-col gap-3 rounded-xl border border-stroke p-5"
            role="status"
            ref={progress}
          >
            <div className="break-all text-[13px] font-medium text-content">{connectionName}</div>
            <div className="flex items-center gap-2 text-[13px]">
              <Loader className="size-4 animate-spin" />
              {job?.message ?? t("Starting connection…")}
            </div>
            {job?.prompt && (
              <form
                className="flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void respond(job.prompt!.confirm ? "yes" : answer);
                }}
              >
                <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-content">
                  {job.prompt.message}
                </p>
                {!job.prompt.confirm && (
                  <PasswordField
                    key={job.prompt.id}
                    autoFocus
                    label={t("SSH password or passphrase")}
                    hideLabel
                    aria-label={t("SSH password or passphrase")}
                    autoComplete="off"
                    disabled={answering}
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                  />
                )}
                <div className="flex gap-2">
                  <Button disabled={answering} variant="primary" type="submit">
                    {job.prompt.confirm ? t("Trust host and continue") : t("Continue")}
                  </Button>
                  {job.prompt.confirm && (
                    <Button
                      type="button"

                      disabled={answering}
                      onClick={() => void respond("no")}
                      variant="primary"
                    >
                      {t("Reject")}
                    </Button>
                  )}
                </div>
              </form>
            )}
            <Button
              type="button"

              onClick={() => {
                if (jobId)
                  void invoke("remote_ssh_cancel", { jobId }).catch((reason) =>
                    setError(String(reason)),
                  );
              }}
              variant="secondary"
            >
              {t("Cancel connection")}
            </Button>
          </div>
        )}
        {error && !adding && (
          <Alert role="alert" tone="danger">
            {error}
          </Alert>
        )}
        {error && !adding && !busy && retryMachine ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-(--ui-text-muted)">
              {t("Remote target: {p0}", { p0: retryMachine.name })}
            </span>
            <SecondaryButton onClick={() => startEdit(retryMachine)}>
              {t("Edit name and address…")}
            </SecondaryButton>
            <SecondaryButton onClick={() => void begin(retryMachine)}>
              {t("Retry connection")}
            </SecondaryButton>
          </div>
        ) : null}
        {notice && (
          <p role="status" className="text-[13px] text-success">
            {notice}
          </p>
        )}
        {machines.length > 0 ? (
          <div className="divide-y divide-stroke overflow-hidden rounded-xl border border-stroke">
            {machines.map((machine) => (
              <div key={machine.id}>
                <div
                  className={`flex flex-wrap items-center gap-3 px-4 py-3 ${editing?.id === machine.id ? "bg-selection" : ""}`}
                >
                  <Internet className="size-5 shrink-0 text-(--ui-text-muted)" />
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[13px] font-medium">{machine.name}</span>
                      {isLocalSyncMachine(machine) ? (
                        <span className="shrink-0 rounded bg-(--ui-surface-raised) px-1.5 py-0.5 text-[10px] text-(--ui-text-muted)">
                          {t("This computer")}
                        </span>
                      ) : (
                        <span className="shrink-0 text-[11px] text-(--ui-text-muted)">
                          {t("Remote computer")}
                        </span>
                      )}
                    </div>
                    <MachineConnectionLine
                      environmentId={machine.environmentId}
                      probed={status[machine.id]}
                    />
                    <SyncLine machineId={machine.id} />
                    <details className="connection-details">
                      <summary>{t("Connection details")}</summary>
                      {machine.ssh?.alternate && (
                        <div className="mt-1 break-all text-[12px] text-(--ui-text-muted)">
                          {t("Other address · ")}
                          {machine.ssh.alternate}
                        </div>
                      )}
                      <div className="mt-1 break-all text-[12px] text-(--ui-text-muted)">
                        {isLocalSyncMachine(machine)
                          ? t("Syncs projects and groups with the {p0} on this computer", {
                              p0: PRODUCT_IDENTITY.displayName,
                            })
                          : machine.ssh
                            ? t("SSH · {p0}{p1}", { p0: machine.ssh.target, p1: "" })
                            : machine.endpoint}
                      </div>
                      {machine.ssh ? (
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-(--ui-text-muted)">
                          <span>
                            {t("SSH port")}{" "}
                            <span className="font-mono text-content">
                              {machine.ssh.port ?? t("From SSH config")}
                            </span>
                          </span>
                          <span>
                            {t("Host port")}{" "}
                            <span className="font-mono text-content">{machine.ssh.remotePort}</span>
                          </span>
                        </div>
                      ) : null}
                    </details>
                    {machine.ssh && needsUpdate[machine.id] ? (
                      <div className="mt-1 text-[11px] text-(--ui-text-muted)">
                        {t("Updating restarts the host and interrupts active agent turns.")}
                      </div>
                    ) : null}
                  </div>
                  {machine.ssh && (
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {needsUpdate[machine.id] ? (
                        <Button
                          disabled={busy}
                          title={t(
                            "Downloads the matching host package and restarts the host; active agent turns will be interrupted",
                          )}
                          onClick={() => void begin(machine, true)}
                          variant="secondary"
                          type="button"
                        >
                          {t("Update Host")}
                        </Button>
                      ) : null}
                      <Button
                        disabled={busy}
                        onClick={() => void begin(machine)}
                        variant="secondary"
                        type="button"
                      >
                        {t("Reconnect")}
                      </Button>
                      <Button
                        disabled={busy}
                        aria-label={t("Edit {p0}", { p0: machine.name })}
                        title={t("Edit name and address…")}
                        onClick={() => startEdit(machine)}
                        variant="secondary"
                        type="button"
                      >
                        <Pencil className="size-4" />
                      </Button>
                    </div>
                  )}
                  <Button
                    disabled={busy || revoking}

                    aria-label={t("Remove {p0}", { p0: machine.name })}
                    title={t("Remove connection…")}
                    onClick={() => {
                      closeForm();
                      setRetryMachine(undefined);
                      setError("");
                      setNotice("");
                      setRemoving(machine.id);
                    }}
                    variant="secondary"
                    type="button"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                {removing === machine.id && (
                  <div
                    role="group"
                    aria-label={t("Confirm removing {p0}", { p0: machine.name })}
                    className="flex flex-col gap-3 border-t border-stroke bg-(--ui-surface-raised) px-4 py-4 text-[12px] leading-relaxed text-(--ui-text-muted)"
                  >
                    <p className="text-[13px] font-medium text-content">
                      {t("Remove ")}
                      {machine.name}
                      {t(" from this desktop?")}
                    </p>
                    {isLocalSyncMachine(machine) ? (
                      <p>
                        {t("Removing this stops syncing projects and groups with the")}{" "}
                        {PRODUCT_IDENTITY.displayName}
                        {t(
                          " on this computer. It is created again automatically the next time",
                        )}{" "}
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
                    <p>
                      {t(
                        "Removing alone leaves this desktop’s credential valid on the host. Revoke access to invalidate it first; the machine must be reachable.",
                      )}
                    </p>
                    <p>
                      {t("To stop the host and turn off its background service, run")}{" "}
                      <code className="rounded bg-(--ui-surface-raised) px-1">
                        {"~/.bycoda-host/bin/bycoda-host service uninstall"}
                      </code>{" "}
                      {t("on that machine (")}
                      <code className="rounded bg-(--ui-surface-raised) px-1">
                        {"%USERPROFILE%\\.bycoda-host\\bin\\bycoda-host.cmd service uninstall"}
                      </code>{" "}
                      {t("on Windows). Its sessions and history are kept.")}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={revoking}
                        onClick={() => void remove(machine, true)}
                        variant="secondary"
                        type="button"
                      >
                        {t("Revoke access and remove")}
                      </Button>
                      <Button
                        disabled={revoking}
                        onClick={() => void remove(machine, false)}
                        variant="secondary"
                        type="button"
                      >
                        {t("Remove from this desktop only")}
                      </Button>
                      <Button
                        disabled={revoking}
                        onClick={() => setRemoving(undefined)}
                        variant="secondary"
                        type="button"
                      >
                        {t("Cancel")}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : loaded && !loading && !loadError && !adding ? (
          <div className="rounded-xl border border-dashed border-stroke px-5 py-8 text-center text-[13px] text-(--ui-text-muted)">
            {t("Add your always-on Windows, Mac, or Linux machine to get started.")}
          </div>
        ) : null}
        {!adding && !removing ? (
          <section className="text-[12px] text-(--ui-text-muted)">
            <h3 className="">{t("Connect to an existing host by URL")}</h3>
            <form
              className="mt-4 flex flex-col gap-3"
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
              <p>
                {t(
                  "Connect this desktop to an already running host at the URL below. Use a device token issued by that host. A loopback address targets this computer; a remote address targets that computer.",
                )}
              </p>
              <label>
                {t("Host URL")}
                <TextField
                  required
                  disabled={busy}
                  type="url"
                  autoComplete="url"
                  spellCheck={false}

                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  label=""
                  hideLabel
                  fieldClassName="min-w-0 flex-1"
                />
              </label>
              <PasswordField
                label={t("Device token")}
                required
                disabled={busy}
                autoComplete="off"
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
              <Button disabled={busy} variant="secondary" type="submit">
                {busy ? t("Connecting…") : error ? t("Retry connection") : t("Connect by URL")}
              </Button>
            </form>
          </section>
        ) : null}
        <RemoteReconnectGroup />
      </div>
      {visited.includes("phone") ? (
        <div className="connections-view" hidden={view !== "phone"}>
          <PhoneConnectionPanel
            machines={machines}
            loaded={loaded}
            loading={loading}
            onRefresh={refresh}
          />
        </div>
      ) : null}
      {visited.includes("tunnels") ? (
        <div className="connections-view" hidden={view !== "tunnels"}>
          <ExternalTunnelsPanel machines={machines} loaded={loaded} loading={loading} />
        </div>
      ) : null}
    </div>
  );
}
