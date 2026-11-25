import { errorText } from "../../../shared/lib/errors";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { Alert } from "../../../shared/ui/Alert";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { NumberField } from "../../../shared/ui/NumberField";
import { PasswordField } from "../../../shared/ui/PasswordField";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { hostFeatureRequest } from "../../connections/model/hostFeatureClient";
import { parseRemotePath } from "../../connections/model/remoteProjects";
import { knownRemoteMachine, useRemoteMachines } from "../../connections/model/connections";
import { refreshGenericAcpCatalog } from "../../../integrations/harness/providers/generic-acp/genericAcpAdapter";
import { probeHarnessAvailability } from "../../../integrations/harness/core/availability";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { RefreshCw } from "../../../shared/ui/icons";
import { Surface } from "../../../shared/ui/Surface";
import { ConfirmMorph } from "../../../shared/ui/ConfirmMorph";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { AdvancedSettings, Group, settingDomId } from "../../../shared/ui/settings";
import type { AcpRegistryEntry, GenericAcpConfig, GenericAcpSummary } from "../model/genericAcp";

// Stable keys: each operation's label is translated at render time, never looked up dynamically.
type BusyKind = "" | "reload" | "registry" | "saving" | "removing" | "installing";
type StatusKind = "" | "draft" | "saved";
/** The action whose failure the settings show: a busy action, the first load or an install cancel. */
type FailedAction = BusyKind | "load" | "cancel";

export function GenericAcpSettings({
  cwd = "",
  embedded = false,
}: {
  cwd?: string;
  embedded?: boolean;
}) {
  return <GenericAcpMachineSettings key={cwd} cwd={cwd} embedded={embedded} />;
}

function AcpSettingsShell({
  embedded,
  action,
  scope,
  children,
}: {
  embedded: boolean;
  action: ReactNode;
  scope: string;
  children: ReactNode;
}) {
  if (!embedded) {
    return (
      <Group
        id="acp-agents"
        layout="full"
        variant="box"
        title={t("ACP agents")}
        scope={scope}
        persistence={{ mode: "explicit" }}
        action={action}
      >
        {children}
      </Group>
    );
  }

  return (
    <Surface
      as="section"
      variant="card"
      padding="none"
      id={settingDomId("acp-agents")}
      data-setting-id="acp-agents"
      className="mt-8 min-w-0 overflow-hidden"
      aria-label={t("ACP agents")}
    >
      <div
        {...surfaceAttributes(
          { frame: "pane", edge: "bottom" },
          "flex flex-wrap items-center justify-between gap-2 px-3 py-2",
        )}
      >
        <Text as="p" size="caption" tone="secondary" leading="snug" className="min-w-0">
          {scope}
        </Text>
        {action}
      </div>
      {children}
    </Surface>
  );
}

function GenericAcpMachineSettings({ cwd, embedded }: { cwd: string; embedded: boolean }) {
  useLocale();
  const [configs, setConfigs] = useState<GenericAcpSummary[]>([]);
  const [registry, setRegistry] = useState<AcpRegistryEntry[]>([]);
  const [form, setForm] = useState<GenericAcpConfig>({ id: "", name: "", command: "", args: [] });
  const [argsText, setArgsText] = useState("[]");
  const [envText, setEnvText] = useState("");
  const [draftDirty, setDraftDirty] = useState(false);
  const [formRevision, setFormRevision] = useState(0);
  const [registryOpen, setRegistryOpen] = useState(false);
  const [registryState, setRegistryState] = useState<"idle" | "loading" | "loaded" | "error">(
    "idle",
  );
  const [cancelingInstallId, setCancelingInstallId] = useState("");
  const [installingId, setInstallingId] = useState("");
  const formDisclosureRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const activeRef = useRef(true);
  const cancelingInstallRef = useRef("");
  const resetForm = (next: GenericAcpConfig = { id: "", name: "", command: "", args: [] }) => {
    setForm(next);
    setArgsText(JSON.stringify(next.args));
    setEnvText("");
    setDraftDirty(false);
  };
  const [failure, setFailure] = useState<{ action: FailedAction; detail: string } | null>(null);
  const error = failure?.detail ?? "";
  const [busy, setBusy] = useState<BusyKind>("");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<StatusKind>("");
  const remote = parseRemotePath(cwd);
  // Subscribes to the machine list so the name resolves once it loads; the
  // scope line shows the name, never the environment id.
  useRemoteMachines(Boolean(remote));
  const remoteName = remote ? knownRemoteMachine(remote.environmentId)?.name : undefined;
  const scope = remote
    ? t("Target machine: {p0}. ACP configuration and credentials stay on that host.", {
        p0: remoteName || t("Remote host"),
      })
    : t("Target machine: this machine. ACP configuration and credentials stay here.");
  const request = <T,>(command: string, params: Record<string, unknown> = {}) =>
    activeRef.current
      ? parseRemotePath(cwd)
        ? hostFeatureRequest<T>(cwd, "generic-acp-v1", command, params)
        : invoke<T>(command, params)
      : Promise.reject(new Error(t("ACP settings closed before the request completed.")));
  async function reload() {
    const result = await request<GenericAcpSummary[]>("generic_acp_list");
    if (!activeRef.current) return;
    if (!Array.isArray(result))
      throw new Error(
        t("ACP configuration is unavailable on this machine. Update its app or host."),
      );
    setConfigs(result);
  }
  useEffect(() => {
    let cancelled = false;
    activeRef.current = true;
    // The machine wrapper is keyed by cwd, so every field starts from its initial value.
    void request<GenericAcpSummary[]>("generic_acp_list")
      .then((result) => {
        if (cancelled) return;
        if (!Array.isArray(result))
          throw new Error(
            t("ACP configuration is unavailable on this machine. Update its app or host."),
          );
        setConfigs(result);
      })
      .catch((reason) => {
        if (!cancelled) setFailure({ action: "load", detail: errorText(reason) });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      activeRef.current = false;
    };
  }, [cwd]);
  async function run(label: BusyKind, action: () => Promise<void>, confirm = false) {
    if (!activeRef.current || busyRef.current || loading) {
      if (confirm)
        throw new Error(t("ACP operation is unavailable while another request is pending."));
      return;
    }
    busyRef.current = true;
    setFailure(null);
    setStatus("");
    setBusy(label);
    let completed = false;
    try {
      await action();
      completed = true;
      if (!activeRef.current) return;
      await reload();
      if (!activeRef.current) return;
      if (!parseRemotePath(cwd)) {
        await refreshGenericAcpCatalog();
        if (!activeRef.current) return;
        await probeHarnessAvailability({ force: true });
      }
    } catch (reason) {
      if (activeRef.current) {
        setFailure({ action: label, detail: errorText(reason) });
      }
      // A confirmation owns its failure state. A refresh failure after the
      // mutation completed remains a list error, not a failed deletion.
      if (confirm && !completed) throw reason;
    } finally {
      busyRef.current = false;
      if (activeRef.current) {
        setBusy("");
        setInstallingId("");
      }
      if (cancelingInstallRef.current) {
        cancelingInstallRef.current = "";
        if (activeRef.current) setCancelingInstallId("");
      }
    }
  }
  const editing = configs.some((config) => config.id === form.id);
  const busyLabel = () => {
    switch (busy) {
      case "installing":
        return t("Installing {p0}…", { p0: installingId });
      case "saving":
        return t("Saving…");
      case "removing":
        return t("Removing…");
      case "registry":
        return t("Loading ACP registry…");
      default:
        return t("Loading ACP agents…");
    }
  };
  const failureTitle = () => {
    switch (failure?.action) {
      case "load":
        return t("Could not load the ACP agents.");
      case "registry":
        return t("Could not load the ACP registry.");
      case "saving":
        return t("Could not save the ACP agent.");
      case "removing":
        return t("Could not remove the ACP agent.");
      case "installing":
        return t("Could not install the ACP agent.");
      case "cancel":
        return t("Could not cancel the installation.");
      default:
        return t("Could not reload the ACP agents.");
    }
  };
  const statusLabel = () =>
    status === "draft"
      ? t("Save or cancel the current agent draft before opening another.")
      : t("ACP agent saved on the target machine.");
  const openAgentForm = () => {
    const root = formDisclosureRef.current;
    const input = root?.querySelector<HTMLInputElement>("input");
    if (input) input.focus();
    else {
      root?.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')?.click();
      requestAnimationFrame(() => {
        if (activeRef.current) root?.querySelector<HTMLInputElement>("input")?.focus();
      });
    }
  };
  const toggleRegistry = (open: boolean) => {
    if (loading || !activeRef.current || busyRef.current) return;
    if (!open) {
      setRegistryOpen(false);
      return;
    }
    setRegistryOpen(true);
    setRegistryState("loading");
    void run("registry", async () => {
      try {
        const entries = await request<AcpRegistryEntry[]>("generic_acp_registry", {
          refresh: true,
        });
        if (!activeRef.current) return;
        if (!Array.isArray(entries)) {
          throw new Error(
            t("ACP configuration is unavailable on this machine. Update its app or host."),
          );
        }
        setRegistry(entries);
        setRegistryState("loaded");
      } catch (reason) {
        if (activeRef.current) setRegistryState("error");
        throw reason;
      }
    });
  };
  const cancelInstallation = async (id: string) => {
    if (!activeRef.current || cancelingInstallRef.current === id) return;
    cancelingInstallRef.current = id;
    setCancelingInstallId(id);
    try {
      await request("generic_acp_cancel_install", { id });
    } catch (reason) {
      if (activeRef.current) {
        cancelingInstallRef.current = "";
        setCancelingInstallId("");
        setFailure({ action: "cancel", detail: errorText(reason) });
      }
    }
  };
  return (
    <div
      className={embedded ? "min-w-0" : "pt-4"}
      aria-label={t("Generic ACP agents")}
      aria-busy={loading || !!busy}
    >
      <AcpSettingsShell
        embedded={embedded}
        scope={scope}
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              className="shrink-0"
              aria-controls="acp-agent-form-disclosure"
              disabled={loading || !!busy}
              onClick={openAgentForm}
            >
              {t("Add agent")}
            </Button>
            <Button
              className="shrink-0"
              iconOnly
              label={t("Reload agents")}
              startIcon={<RefreshCw className="icon-sm" />}
              disabled={loading || !!busy}
              onClick={() => void run("reload", async () => {})}
            />
          </div>
        }
      >
        <div data-acp-status className="flex min-h-8 min-w-0 items-center px-3 py-1">
          {loading || busy ? (
            <LoadingText delay={false} className="min-w-0">
              {loading ? t("Loading ACP agents…") : busyLabel()}
            </LoadingText>
          ) : status ? (
            <InlineMessage tone="info">{statusLabel()}</InlineMessage>
          ) : null}
        </div>
        {error && (
          <Alert
            tone="danger"
            title={failureTitle()}
            extra={<ErrorDetails detail={error} title={failureTitle()} />}
          />
        )}
        {configs.map((config) => (
          <div
            key={config.id}
            {...surfaceAttributes(
              { frame: "pane", edge: "block-end" },
              "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2",
            )}
          >
            <div className="min-w-0 flex-1">
              <OverflowTooltip label={config.name}>
                <Text as="div" size="caption" tone="primary" weight="medium" truncate>
                  {config.name}
                </Text>
              </OverflowTooltip>
              <OverflowTooltip label={config.command}>
                <Text as="div" size="caption" tone="secondary" truncate>
                  {config.command} · {t("{p0} environment values", { p0: config.envKeys.length })}
                </Text>
              </OverflowTooltip>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                className="shrink-0"
                disabled={loading || !!busy}
                onClick={() => {
                  if (draftDirty) {
                    setStatus("draft");
                    openAgentForm();
                    return;
                  }
                  const { envKeys: _keys, ...values } = config;
                  resetForm(values);
                }}
              >
                {t("Edit")}
              </Button>
              <span
                {...surfaceAttributes(
                  { frame: "pane", edge: "inline-start" },
                  "ms-1 shrink-0 ps-2",
                )}
              >
                <ConfirmMorph
                  label={t("Remove")}
                  tone="danger"
                  confirmMode="press"
                  pendingLabel={t("Removing…")}
                  doneLabel={t("Removed")}
                  disabled={loading || !!busy}
                  onConfirm={() =>
                    run("removing", () => request("generic_acp_remove", { id: config.id }), true)
                  }
                />
              </span>
            </div>
          </div>
        ))}
        {!loading && !error && !configs.length ? (
          <EmptyState
            size="inline"
            kind="empty"
            inset="row"
            descriptionText={{ size: "micro" }}
            description={t("No ACP agents configured. Use Add agent or browse the registry.")}
          />
        ) : null}
        <div id="acp-agent-form-disclosure" ref={formDisclosureRef}>
          <AdvancedSettings
            key={`${formRevision}:${editing ? form.id : "new"}`}
            title={editing ? t("Edit agent") : t("Add agent")}
            defaultOpen
          >
            <form
              className="grid gap-x-3 gap-y-3 px-3 pb-3 pt-2 sm:grid-cols-2"
              onChange={() => {
                setDraftDirty(true);
                setStatus("");
              }}
              onSubmit={(event) => {
                event.preventDefault();
                void run("saving", async () => {
                  const args = JSON.parse(argsText);
                  const env = envText.trim() ? JSON.parse(envText) : undefined;
                  await request("generic_acp_save", {
                    config: { ...form, args, ...(env ? { env } : {}) },
                  });
                  if (!activeRef.current) return;
                  setStatus("saved");
                  setFormRevision((revision) => revision + 1);
                  resetForm();
                });
              }}
            >
              <TextField
                label={t("Agent id")}
                fieldClassName="w-full"
                disabled={loading || !!busy}
                value={form.id}
                required
                pattern="[a-z0-9][a-z0-9._-]*"
                spellCheck={false}
                placeholder="my-agent"
                onChange={(event) => setForm({ ...form, id: event.target.value })}
              />
              <TextField
                label={t("Name")}
                fieldClassName="w-full"
                disabled={loading || !!busy}
                value={form.name}
                required
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
              <div className="flex items-end gap-2 sm:col-span-2">
                <TextField
                  label={t("Executable path")}
                  fieldClassName="w-full"
                  disabled={loading || !!busy}
                  monospace
                  value={form.command}
                  required
                  spellCheck={false}
                  onChange={(event) => setForm({ ...form, command: event.target.value })}
                />
                <InfoPopover className="shrink-0">
                  {t(
                    "Configure an executable on the session's machine. Credentials and environment values stay on that machine. Arguments are a JSON array; commands are launched without a shell.",
                  )}
                </InfoPopover>
              </div>
              <div className="sm:col-span-2">
                <AdvancedSettings
                  key={editing ? form.id : "new"}
                  title={t("ACP arguments, environment and model context")}
                  defaultOpen={editing}
                  settingIds={["acp-advanced"]}
                >
                  <div
                    id="setting-acp-advanced"
                    data-setting-id="acp-advanced"
                    className="grid gap-x-3 gap-y-3 py-3 sm:grid-cols-2"
                  >
                    <div className="sm:col-span-2">
                      <TextareaField
                        label={t("Arguments (JSON array)")}
                        disabled={loading || !!busy}
                        monospace
                        minRows={3}
                        value={argsText}
                        spellCheck={false}
                        onChange={(event) => setArgsText(event.target.value)}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <PasswordField
                        label={t("Environment (JSON object; blank preserves stored values)")}
                        fieldClassName="w-full"
                        disabled={loading || !!busy}
                        autoComplete="off"
                        monospace
                        value={envText}
                        spellCheck={false}
                        onChange={(event) => setEnvText(event.target.value)}
                      />
                    </div>
                    <TextField
                      label={t("ACP authentication method id (optional)")}
                      fieldClassName="w-full"
                      disabled={loading || !!busy}
                      value={form.authMethodId ?? ""}
                      spellCheck={false}
                      onChange={(event) =>
                        setForm({ ...form, authMethodId: event.target.value || undefined })
                      }
                    />
                    <NumberField
                      label={t("Context window tokens (optional)")}
                      fieldClassName="w-full"
                      disabled={loading || !!busy}
                      min={1024}
                      value={form.contextWindow ?? ""}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          contextWindow: event.target.value
                            ? Number(event.target.value)
                            : undefined,
                        })
                      }
                    />
                  </div>
                </AdvancedSettings>
              </div>
              <div className="flex items-center gap-2 sm:col-span-2">
                <Button
                  className="shrink-0"
                  loading={busy === "saving"}
                  loadingLabel={t("Saving…")}
                  disabled={loading || !!busy}
                  type="submit"
                >
                  {t("Save agent")}
                </Button>
                <Button
                  className="shrink-0"
                  disabled={loading || !!busy}
                  onClick={() => {
                    resetForm();
                    setFormRevision((revision) => revision + 1);
                  }}
                >
                  {t("Cancel")}
                </Button>
              </div>
            </form>
          </AdvancedSettings>
        </div>
        <div
          id="setting-acp-registry"
          data-setting-id="acp-registry"
          {...surfaceAttributes({ frame: "pane", edge: "top" })}
        >
          <Disclosure
            variant="row"
            size="sm"
            summary={t("Browse ACP Registry")}
            open={registryOpen}
            onOpenChange={toggleRegistry}
          >
            <div
              id="setting-acp-registry-results"
              {...surfaceAttributes({ frame: "pane", edge: "top" })}
            >
              <Text as="p" size="caption" tone="secondary" leading="snug" className="px-3 py-2">
                {t(
                  "Install downloads an exact package version into isolated host storage and may run package installation scripts. Binary and Python distributions can be configured as local commands.",
                )}
              </Text>
              {registryState === "loading" ? (
                <LoadingText delay={false} inset="row">
                  {t("Loading ACP registry…")}
                </LoadingText>
              ) : registryState === "error" ? null : registryState === "loaded" &&
                registry.length > 0 ? (
                <div {...surfaceAttributes({ dividers: "pane" })}>
                  {registry.map((entry) => (
                    <div
                      key={`${entry.id}:${entry.version}`}
                      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <OverflowTooltip label={`${entry.name} ${entry.version}`}>
                          <Text as="div" size="caption" tone="primary" weight="medium" truncate>
                            {entry.name}{" "}
                            <Text size="inherit" tone="secondary">
                              {entry.version}
                            </Text>
                          </Text>
                        </OverflowTooltip>
                        <Text
                          as="p"
                          size="caption"
                          tone="secondary"
                          leading="snug"
                          className="mt-0.5"
                        >
                          {entry.supported
                            ? entry.description
                            : `${entry.description} ${entry.unsupportedReason ?? ""}`.trim()}
                        </Text>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {entry.supported ? (
                          <Button
                            className="shrink-0"
                            disabled={loading || !!busy}
                            onClick={() => {
                              if (!activeRef.current || busyRef.current || loading) return;
                              setInstallingId(entry.id);
                              void run("installing", () =>
                                request("generic_acp_install", {
                                  id: entry.id,
                                  version: entry.version,
                                }),
                              );
                            }}
                          >
                            {t("Install {p0}", { p0: entry.package })}
                          </Button>
                        ) : null}
                        {installingId === entry.id ? (
                          <Button
                            className="shrink-0"
                            tone="danger"
                            loading={cancelingInstallId === entry.id}
                            loadingLabel={t("Stopping installation…")}
                            onClick={() => void cancelInstallation(entry.id)}
                          >
                            {t("Stop installation")}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : registryState === "loaded" ? (
                <EmptyState
                  size="inline"
                  kind="empty"
                  inset="row"
                  descriptionText={{ size: "micro" }}
                  description={t("No ACP registry entries found.")}
                />
              ) : null}
            </div>
          </Disclosure>
        </div>
      </AcpSettingsShell>
    </div>
  );
}
