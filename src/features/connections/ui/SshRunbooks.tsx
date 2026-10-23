import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { t } from "../../../shared/i18n";
import { revokeSshHttpProxyApproval } from "../model/sshHttpProxyApproval";
import { useSshHttpProxyApproval } from "./useSshHttpProxyApproval";
import { Modal } from "../../../shared/ui/Modal";
import { ConfirmMorph } from "../../../shared/ui/ConfirmMorph";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import type { ServerRecord } from "../model/serverInventory";
import { sshEndpointPreview, validSshEndpointPreview } from "../model/sshEndpointReview";
import { validSshRuntimeConfiguration } from "../model/sshGroupDefaults";
import {
  abandonMissingSshRunbookStart,
  pendingSshRunbookIntents,
  dismissSshRunbookIntent,
  type SshRunbookIntent,
  sshRunbookDraft,
  sshRunbookFromDraft,
  sameSshRunbook,
  sshRunActive,
  sshRunReasonMessage,
  listSshRunbooks,
  saveSshRunbook,
  removeSshRunbook,
  reviewSshRunbook,
  startSshRunbook,
  statusSshRunbook,
  cancelSshRunbook,
  type SshRunbook,
  type SshRunbookDraft,
  type SshRunbookReview,
  type SshRunStatus,
} from "../model/sshRunbooks";

/** Explicit saved-script execution; reopening recovers status, never a start ticket. */
export function SshRunbooks({
  server,
  servers,
  runId,
  intentId,
  initialAutomationId,
  onRun,
  onAbandon,
  onClose,
}: {
  server: ServerRecord;
  servers: ServerRecord[];
  runId?: string;
  intentId?: string;
  initialAutomationId?: string;
  onRun: (id: string) => void;
  onAbandon?: () => void;
  onClose: () => void;
}) {
  const proxy = useSshHttpProxyApproval();
  const [intents, setIntents] = useState<SshRunbookIntent[]>([]);
  const [selectedIntent, setSelectedIntent] = useState<string | undefined>(intentId);
  const [pendingStart, setPendingStart] = useRetainedState<
    { runId: string; automationId: string; revision: number } | undefined
  >(`ssh-runbook-pending-start:${server.id}`, () => undefined);
  const [profiles, setProfiles] = useState<SshRunbook[]>([]);
  const [draft, setDraft] = useRetainedState<SshRunbookDraft>(
    `ssh-runbook-draft:${server.id}`,
    () => sshRunbookDraft(undefined, server.id),
  );
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const mounted = useRef(false),
    locked = useRef(false);
  const [status, setStatus] = useState<SshRunStatus>();
  const [review, setReview] = useState<{
    value: SshRunbookReview;
    scope: string;
    expiresAt: number;
  }>();
  const [clock, setClock] = useState(0);
  const profile = sshRunbookFromDraft(draft);
  const saved = profiles.find((item) => item.id === draft.id);
  const clean = sameSshRunbook(profile, saved);
  const requestedInitialization = JSON.stringify([intentId, initialAutomationId]);
  const scope = JSON.stringify([
    requestedInitialization,
    profile,
    selectedIntent,
    servers.map((item) => [
      item.id,
      item.effectiveSshEndpoint ?? item.sshEndpoint,
      item.metadata.sshInheritance,
    ]),
  ]);
  const scopeRef = useRef(scope);
  const runRef = useRef(runId);
  useLayoutEffect(() => {
    scopeRef.current = scope;
    runRef.current = runId;
  }, [scope, runId]);
  const currentStatus = status?.runId === runId ? status : undefined;
  const recovering = !!runId && !currentStatus;
  const frozen = recovering || sshRunActive(currentStatus);
  const activeReview =
    review?.scope === scope && clean && review.expiresAt > clock ? review : undefined;
  const choices = servers.filter((item) => item.kind === "ssh" && item.sshEndpoint);
  const change = (patch: Partial<SshRunbookDraft>) => {
    setDraft({ ...draft, ...patch });
    setReview(undefined);
  };
  const operation = async (work: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (reason) {
      if (mounted.current) setError(String(reason));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const initializedIntent = useRef<string | undefined>(undefined);
  const loadSequence = useRef(0);
  const load = () => {
    const sequence = ++loadSequence.current;
    const requestedIntent = intentId;
    const requestedAutomation = initialAutomationId;
    const initialization = JSON.stringify([requestedIntent, requestedAutomation]);
    return Promise.all([listSshRunbooks(), pendingSshRunbookIntents()])
      .then(([value, nativePending]) => {
        if (!mounted.current || sequence !== loadSequence.current) return;
        const pending = nativePending.filter((item) => item.status === "pendingReview");
        setProfiles(value);
        setIntents(pending);
        if (
          (requestedIntent || requestedAutomation) &&
          initializedIntent.current !== initialization
        ) {
          const intent = pending.find((item) => item.id === requestedIntent);
          const found = value.find(
            (item) => item.id === (intent?.automationId ?? requestedAutomation),
          );
          if (
            found &&
            (!requestedIntent ||
              (intent && intent.automationId === found.id && intent.revision === found.revision))
          ) {
            initializedIntent.current = initialization;
            setDraft(sshRunbookDraft(found));
            setSelectedIntent(requestedIntent);
            setReview(undefined);
          }
        }
      })
      .catch((reason) => {
        if (mounted.current && sequence === loadSequence.current) setError(String(reason));
      })
      .finally(() => {
        if (mounted.current && sequence === loadSequence.current) setLoading(false);
      });
  };
  const refreshStatus = async (id: string) => {
    const value = await statusSshRunbook(id);
    if (mounted.current && runRef.current === id) {
      if (value.runId !== id) throw new Error(t("Run status changed. Refresh again."));
      setStatus(value);
    }
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      loadSequence.current++;
    };
  }, []);
  useEffect(() => {
    void load();
  }, [intentId, initialAutomationId]);
  useEffect(() => {
    if (!runId || busy) return;
    let current = true;
    void statusSshRunbook(runId)
      .then((value) => {
        if (current && value.runId === runId) setStatus(value);
      })
      .catch((reason) => {
        if (current) setError(String(reason));
      });
    return () => {
      current = false;
    };
  }, [runId, busy]);
  useEffect(() => {
    if (!runId || busy || !sshRunActive(currentStatus)) return;
    let current = true,
      pending = false;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      void statusSshRunbook(runId)
        .then((value) => {
          if (current && value.runId === runId) setStatus(value);
        })
        .catch((reason) => {
          if (current) setError(String(reason));
        })
        .finally(() => {
          pending = false;
        });
    }, 1000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [runId, currentStatus, busy]);
  useEffect(() => {
    if (!review) return;
    const timer = setInterval(() => setClock(Date.now()), 500);
    return () => clearInterval(timer);
  }, [review]);
  return (
    <>
      <Modal title={t("SSH runbooks")} onClose={onClose} size="lg">
        <div className="flex min-w-0 flex-col gap-3 p-4">
          <p className="text-xs text-(--ui-text-muted)">
            {t("Target")}: {server.name}
          </p>
          {error ? (
            <Alert tone="danger" role="alert">
              {error}
            </Alert>
          ) : null}
          {intents.length ? (
            <section
              aria-label={t("Pending execution reviews")}
              className="flex min-w-0 flex-col gap-2 text-xs"
            >
              {intents.map((intent) => (
                <div key={intent.id} className="flex min-w-0 flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 break-all">
                    {profiles.find((item) => item.id === intent.automationId)?.name ??
                      intent.automationId}{" "}
                    · {t(intent.trigger === "startup" ? "After connection" : "Scheduled")} ·{" "}
                    {t("Pending review")}
                  </p>
                  <Button
                    disabled={busy || frozen}
                    onClick={() => {
                      const found = profiles.find((item) => item.id === intent.automationId);
                      if (!found || found.revision !== intent.revision) {
                        setError(t("Runbook changed. Refresh and review again."));
                        return;
                      }
                      setDraft(sshRunbookDraft(found));
                      setSelectedIntent(intent.id);
                      setReview(undefined);
                    }}
                  >
                    {t("Review")}
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void operation(async () => {
                        await dismissSshRunbookIntent(intent.id);
                        if (!mounted.current) return;
                        setIntents((items) => items.filter((item) => item.id !== intent.id));
                        if (selectedIntent === intent.id) {
                          setSelectedIntent(undefined);
                          setReview(undefined);
                        }
                      })
                    }
                  >
                    {t("Dismiss")}
                  </Button>
                </div>
              ))}
            </section>
          ) : null}
          {runId ? (
            <section
              aria-label={t("SSH execution status")}
              className="flex min-w-0 flex-col gap-2 border-t border-stroke pbs-3 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 break-all">
                  {t("Run")}: <code>{runId}</code>
                </p>
                <Button disabled={busy} onClick={() => void operation(() => refreshStatus(runId))}>
                  {t("Refresh status")}
                </Button>
              </div>
              {recovering && pendingStart?.runId === runId && onAbandon ? (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void operation(async () => {
                      const origin = pendingStart;
                      await abandonMissingSshRunbookStart(
                        origin.runId,
                        origin.automationId,
                        origin.revision,
                      );
                      if (!mounted.current || runRef.current !== origin.runId) return;
                      setPendingStart(undefined);
                      setStatus(undefined);
                      setReview(undefined);
                      onAbandon();
                    })
                  }
                >
                  {t("Abandon pending start")}
                </Button>
              ) : null}
              {recovering ? (
                <p role="status">
                  {t("Execution status is unknown. Refresh status before starting another run.")}
                </p>
              ) : null}
              {currentStatus?.targets.map((target) => (
                <div
                  key={target.serverId}
                  className="flex min-w-0 flex-wrap items-center justify-between gap-2"
                >
                  <p className="min-w-0 break-all">
                    {choices.find((item) => item.id === target.serverId)?.name ?? target.serverId}:{" "}
                    {t(
                      {
                        queued: "Queued",
                        running: "Running",
                        exited: "Exited",
                        failed: "Failed",
                        cancelled: "Cancelled",
                        unknown: "Unknown",
                      }[target.state],
                    )}
                    {target.exitCode != null ? ` · ${target.exitCode}` : ""}
                  </p>
                  {target.reason ? (
                    <div className="w-full min-w-0 text-(--ui-text-muted)">
                      <p>{t(sshRunReasonMessage(target.reason))}</p>
                      <details>
                        <summary className="cursor-pointer">{t("Status details")}</summary>
                        <code className="break-all">{target.reason}</code>
                      </details>
                    </div>
                  ) : null}
                  {target.state === "queued" || target.state === "running" ? (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void operation(async () => {
                          await cancelSshRunbook(runId, target.serverId);
                          await refreshStatus(runId);
                        })
                      }
                    >
                      {t("Cancel target")}
                    </Button>
                  ) : null}
                </div>
              ))}
              {recovering || sshRunActive(currentStatus) ? (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void operation(async () => {
                      await cancelSshRunbook(runId);
                      await refreshStatus(runId);
                    })
                  }
                >
                  {t("Cancel run")}
                </Button>
              ) : null}
            </section>
          ) : null}
          <div className="flex min-w-0 flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1">
              <SearchableSelect
                label={t("Runbook")}
                value={saved?.id ?? "new"}
                disabled={busy || frozen || loading}
                options={[
                  { value: "new", label: t("New runbook") },
                  ...profiles.map((item) => ({
                    value: item.id,
                    label: `${item.name} · r${item.revision}`,
                  })),
                ]}
                onChange={(id) => {
                  setDraft(
                    sshRunbookDraft(
                      profiles.find((item) => item.id === id),
                      server.id,
                    ),
                  );
                  setSelectedIntent(undefined);
                  setReview(undefined);
                }}
              />
            </div>
            <Button
              disabled={busy || frozen}
              onClick={() => {
                setDraft(sshRunbookDraft(undefined, server.id));
                setSelectedIntent(undefined);
                setReview(undefined);
              }}
            >
              {t("New runbook")}
            </Button>
            <Button disabled={busy || loading} onClick={() => void operation(load)}>
              {t("Refresh")}
            </Button>
          </div>
          <fieldset disabled={busy || frozen} className="flex min-w-0 flex-col gap-3 border-0 p-0">
            <TextField
              label={t("Runbook name")}
              value={draft.name}
              onChange={(event) => change({ name: event.target.value })}
            />
            <SearchableSelect
              multiple
              label={t("SSH targets")}
              value={draft.targetIds}
              onChange={(ids) =>
                change({
                  targetIds: ids,
                  ...(draft.triggers
                    ? {
                        triggers: {
                          ...draft.triggers,
                          startupServerIds: draft.triggers.startupServerIds.filter((id) =>
                            ids.includes(id),
                          ),
                        },
                      }
                    : {}),
                })
              }
              options={choices.map((item) => ({
                value: item.id,
                label: item.name,
                description: sshEndpointPreview(item.effectiveSshEndpoint ?? item.sshEndpoint!),
              }))}
            />
            <SegmentedControl
              label={t("Runbook shell")}
              value={draft.shell}
              onValueChange={(shell) => change({ shell: shell as "posix" | "powershell" })}
              options={[
                { value: "posix", label: "POSIX" },
                { value: "powershell", label: "PowerShell" },
              ]}
            />
            <TextareaField
              label={t("SSH script")}
              value={draft.script}
              rows={5}
              spellCheck={false}
              onChange={(event) => change({ script: event.target.value })}
            />
            <div className="grid grid-cols-2 gap-2">
              <TextField
                label={t("Concurrency")}
                inputMode="numeric"
                value={draft.concurrency}
                onChange={(event) => change({ concurrency: event.target.value })}
              />
              <TextField
                label={t("Timeout per target (seconds)")}
                inputMode="numeric"
                value={draft.timeoutSeconds}
                onChange={(event) => change({ timeoutSeconds: event.target.value })}
              />
            </div>
            <details className="text-xs">
              <summary className="cursor-pointer">{t("Runbook triggers")}</summary>
              <div className="mbs-2 flex min-w-0 flex-col gap-3">
                <TextField
                  label={t("Schedule interval (minutes)")}
                  inputMode="numeric"
                  value={draft.intervalMinutes ?? ""}
                  onChange={(event) => change({ intervalMinutes: event.target.value })}
                />
                <SearchableSelect
                  multiple
                  label={t("Review after connecting to")}
                  value={draft.triggers?.startupServerIds ?? []}
                  options={choices
                    .filter((item) => draft.targetIds.includes(item.id))
                    .map((item) => ({ value: item.id, label: item.name }))}
                  onChange={(ids) =>
                    change({ triggers: { ...draft.triggers, startupServerIds: ids } })
                  }
                />
                <p className="text-(--ui-text-muted)">
                  {t(
                    "Triggers create pending reviews. Connecting, restoring or reaching a schedule never runs a script automatically.",
                  )}
                </p>
                <p className="text-(--ui-text-muted)">
                  {t(
                    "Automatic startup reviews require trusted shell integration. Use Review startup scripts for other terminals.",
                  )}
                </p>
                {saved?.triggers?.nextRunAt ? (
                  <p>
                    {t("Next review")}: {new Date(saved.triggers.nextRunAt).toLocaleString()}
                  </p>
                ) : null}
              </div>
            </details>
          </fieldset>
          <details className="text-xs text-(--ui-text-muted)">
            <summary className="cursor-pointer">{t("Execution details")}</summary>
            <p className="mbs-2">
              {t(
                "Choose up to 16 saved SSH targets, 1–4 concurrent processes and a 1–86400 second timeout. Scripts are saved definitions; keep secrets in the remote environment or a credential provider. Output is not captured. Saving never runs a script.",
              )}
            </p>
          </details>
          {!profile ? (
            <p role="status" className="text-xs text-(--ui-tone-danger-fg)">
              {t("Enter a name, script, valid targets and execution limits.")}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            {saved ? (
              <span className="me-auto">
                <ConfirmMorph
                  label={t("Delete runbook")}
                  tone="danger"
                  disabled={busy || frozen}
                  onConfirm={() =>
                    operation(async () => {
                      await removeSshRunbook(saved.id, saved.revision);
                      if (!mounted.current) return;
                      setProfiles((items) => items.filter((item) => item.id !== saved.id));
                      setDraft(sshRunbookDraft(undefined, server.id));
                      setReview(undefined);
                    })
                  }
                />
              </span>
            ) : null}
            <Button
              disabled={busy || frozen || !profile}
              onClick={() =>
                void operation(async () => {
                  if (!profile) return;
                  const value = await saveSshRunbook(profile, saved?.revision ?? null);
                  if (!mounted.current) return;
                  setProfiles((items) => [...items.filter((item) => item.id !== value.id), value]);
                  setDraft(sshRunbookDraft(value));
                  setReview(undefined);
                })
              }
            >
              {t("Save runbook")}
            </Button>
            <Button
              disabled={busy || frozen || !clean}
              onClick={() =>
                void operation(async () => {
                  if (!saved) return;
                  const requestedScope = scope;
                  if (
                    selectedIntent &&
                    !intents.some(
                      (item) =>
                        item.id === selectedIntent &&
                        item.automationId === saved.id &&
                        item.revision === saved.revision &&
                        item.status === "pendingReview",
                    )
                  )
                    throw new Error(t("Runbook changed. Refresh and review again."));
                  const value = selectedIntent
                    ? await reviewSshRunbook(saved.id, saved.revision, selectedIntent)
                    : await reviewSshRunbook(saved.id, saved.revision);
                  if (!mounted.current || scopeRef.current !== requestedScope) return;
                  if (
                    !sameSshRunbook(value.profile, saved) ||
                    !value.review.reviewId ||
                    !/^[a-f0-9]{64}$/.test(value.review.digest) ||
                    !Number.isFinite(value.review.expiresInSeconds) ||
                    value.review.expiresInSeconds <= 0 ||
                    value.review.expiresInSeconds > 120 ||
                    value.targets.length !== saved.targetIds.length ||
                    value.targets.some(
                      (target, index) =>
                        target.serverId !== saved.targetIds[index] ||
                        !validSshEndpointPreview(target.endpoint) ||
                        (target.configuration != null &&
                          !validSshRuntimeConfiguration(target.configuration)),
                    )
                  )
                    throw new Error(t("Runbook changed. Refresh and review again."));
                  const now = Date.now();
                  setClock(now);
                  setReview({
                    value,
                    scope: requestedScope,
                    expiresAt: now + value.review.expiresInSeconds * 1000,
                  });
                })
              }
            >
              {t("Review execution")}
            </Button>
          </div>
          {activeReview ? (
            <section
              aria-label={t("SSH execution review")}
              className="flex min-w-0 flex-col gap-2 border-t border-stroke pbs-3 text-xs"
            >
              <p>{t(selectedIntent ? "Pending review" : "Manual execution")}</p>
              <p className="font-medium">
                {activeReview.value.profile.name} · r{activeReview.value.profile.revision}
              </p>
              <p>
                {t("Concurrency")}: {activeReview.value.profile.limits.concurrency} ·{" "}
                {t("Timeout per target (seconds)")}:{" "}
                {activeReview.value.profile.limits.timeoutSeconds}
              </p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all">
                {activeReview.value.profile.script}
              </pre>
              {activeReview.value.targets.map((target) => (
                <div key={target.serverId} className="min-w-0">
                  <p className="break-all">
                    {choices.find((item) => item.id === target.serverId)?.name ?? target.serverId}:{" "}
                    {sshEndpointPreview(target.endpoint)}
                  </p>
                  {target.endpoint.httpProxy ? (
                    <p className="break-all">
                      {target.endpoint.httpProxy.scheme === "https"
                        ? "HTTPS CONNECT"
                        : "HTTP CONNECT"}
                      : {sshEndpointPreview(target.endpoint.httpProxy)}
                    </p>
                  ) : null}
                  <details>
                    <summary className="cursor-pointer">{t("Connection details")}</summary>
                    <dl className="mbs-2 flex min-w-0 flex-col gap-1">
                      {(
                        [
                          [t("Identity file"), target.endpoint.identityFile],
                          [t("Public SSH certificate file"), target.endpoint.certificateFile],
                        ] as const
                      ).map(([label, value]) => (
                        <div key={label}>
                          <dt>{label}</dt>
                          <dd className="break-all text-(--ui-text-muted)">
                            {value ?? t("Default")}
                          </dd>
                        </div>
                      ))}
                      {target.endpoint.jumpPolicies?.map((hop, index) => (
                        <div key={index}>
                          <dt>
                            {t("Jump host")} {index + 1}: {sshEndpointPreview(hop)}
                          </dt>
                          <dd className="break-all text-(--ui-text-muted)">
                            {t("Identity file")}: {hop.identityFile ?? t("Default")} ·{" "}
                            {t("Public SSH certificate file")}:{" "}
                            {hop.certificateFile ?? t("Default")} · {t("Known hosts file")}:{" "}
                            {hop.knownHostsFile ?? t("Default")}
                          </dd>
                        </div>
                      ))}
                      {target.endpoint.jumpHosts?.length || target.endpoint.jumpHost ? (
                        <div>
                          <dt>{t("Jump host")}</dt>
                          <dd className="break-all text-(--ui-text-muted)">
                            {(target.endpoint.jumpHosts ?? [target.endpoint.jumpHost!]).join(" → ")}
                          </dd>
                        </div>
                      ) : null}
                      {Object.entries(target.configuration?.provenance ?? {}).map(
                        ([field, source]) => (
                          <div key={field}>
                            <dt>
                              {t(
                                (
                                  {
                                    user: "SSH user",
                                    port: "SSH port",
                                    identityFile: "Identity file",
                                    certificateFile: "Public SSH certificate file",
                                  } as Record<string, string>
                                )[field] ?? field,
                              )}
                            </dt>
                            <dd className="break-all text-(--ui-text-muted)">
                              {t(
                                source.source === "group"
                                  ? "Group"
                                  : source.source === "connection"
                                    ? "Connection"
                                    : "Default",
                              )}
                              {source.groupId ? ` · ${source.groupId} · r${source.revision}` : ""}
                            </dd>
                          </div>
                        ),
                      )}
                    </dl>
                  </details>
                  {target.configuration?.environment.length ? (
                    <details>
                      <summary className="cursor-pointer">{t("Remote environment")}</summary>
                      {target.configuration.environment.map((entry) => (
                        <p className="break-all" key={entry.name}>
                          <code>
                            {entry.name}={entry.value}
                          </code>
                        </p>
                      ))}
                    </details>
                  ) : null}
                </div>
              ))}
              <p className="text-(--ui-text-muted)">
                {t(
                  "This runs the saved script on every reviewed target. Approval expires shortly; no retry or reconnect runs it again.",
                )}
              </p>
              <Button
                variant="primary"
                disabled={busy || frozen}
                onClick={() =>
                  void operation(async () => {
                    if (!activeReview || activeReview.expiresAt <= Date.now()) {
                      setReview(undefined);
                      return;
                    }
                    const value = activeReview.value,
                      id = crypto.randomUUID();
                    const proxyApprovals: { serverId: string; ticketId: string }[] = [];
                    let dispatched = false;
                    try {
                      for (const target of value.targets) {
                        if (!target.endpoint.httpProxy) continue;
                        const ticketId = await proxy.request({
                          connectionId: target.serverId,
                          endpoint: target.endpoint,
                          operation: {
                            kind: "runbook",
                            runId: id,
                            automationId: value.profile.id,
                            revision: value.profile.revision,
                            reviewDigest: value.review.digest,
                            serverId: target.serverId,
                          },
                        });
                        if (ticketId) proxyApprovals.push({ serverId: target.serverId, ticketId });
                        if (
                          ticketId === null ||
                          !mounted.current ||
                          scopeRef.current !== scope ||
                          activeReview.expiresAt <= Date.now()
                        )
                          return;
                      }
                      setReview(undefined);
                      setStatus(undefined);
                      setPendingStart({
                        runId: id,
                        automationId: value.profile.id,
                        revision: value.profile.revision,
                      });
                      onRun(id);
                      // Retain this id before dispatch: an ambiguous response is recovered via status only.
                      dispatched = true;
                      const result = await startSshRunbook(
                        value.profile.id,
                        value.profile.revision,
                        value.review.reviewId,
                        id,
                        {
                          ...(selectedIntent ? { intentId: selectedIntent } : {}),
                          ...(proxyApprovals.length ? { proxyApprovals } : {}),
                        },
                      );
                      if (selectedIntent)
                        setIntents((items) => items.filter((item) => item.id !== selectedIntent));
                      if (mounted.current && runRef.current === id && result.runId === id)
                        setStatus(result);
                    } finally {
                      if (!dispatched)
                        await Promise.allSettled(
                          proxyApprovals.map((item) => revokeSshHttpProxyApproval(item.ticketId)),
                        );
                    }
                  })
                }
              >
                {t("Approve and run")}
              </Button>
            </section>
          ) : review && !activeReview ? (
            <p role="status" className="text-xs text-(--ui-text-muted)">
              {t("Execution review expired or changed. Review again.")}
            </p>
          ) : null}
        </div>
      </Modal>
      {proxy.dialog}
    </>
  );
}
