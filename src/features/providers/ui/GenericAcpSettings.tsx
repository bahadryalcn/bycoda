import { Alert } from "../../../shared/ui/Alert";
import { NumberField } from "../../../shared/ui/NumberField";
import { PasswordField } from "../../../shared/ui/PasswordField";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { hostFeatureRequest } from "../../connections/model/hostFeatureClient";
import { parseRemotePath } from "../../connections/model/remoteProjects";
import { refreshGenericAcpCatalog } from "../../../integrations/harness/providers/generic-acp/genericAcpAdapter";
import { probeHarnessAvailability } from "../../../integrations/harness/core/availability";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { AdvancedSettings, Group, settingDomId } from "../../settings/ui/settingsControls";
import type { AcpRegistryEntry, GenericAcpConfig, GenericAcpSummary } from "../model/genericAcp";

function Field({
  label,
  hint,
  wide,
  children,
}: {
  label: string;
  hint?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex min-w-0 flex-col gap-1 text-[12px] font-medium text-content/80 ${wide ? "sm:col-span-2" : ""}`}
    >
      <span>{label}</span>
      {children}
      {hint ? (
        <span className="text-[11px] font-normal leading-snug text-content/45">{hint}</span>
      ) : null}
    </div>
  );
}

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
    <section
      id={settingDomId("acp-agents")}
      data-setting-id="acp-agents"
      className="min-w-0"
      aria-label={t("ACP agents")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-content/5 px-3 py-2">
        <div className="min-w-0">
          <p className="text-[10px] leading-snug text-content/55">{scope}</p>
          <p className="text-[10px] text-content/45">{t("Changes require saving")}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const remote = parseRemotePath(cwd);
  const scope = remote
    ? t("Target machine: remote host {p0}. ACP configuration and credentials stay on that host.", {
        p0: remote.environmentId,
      })
    : t("Target machine: this machine. ACP configuration and credentials stay here.");
  const request = <T,>(command: string, params: Record<string, unknown> = {}) =>
    activeRef.current
      ? parseRemotePath(cwd)
        ? hostFeatureRequest<T>(cwd, "generic-acp-v1", command, params)
        : invoke<T>(command, params)
      : Promise.reject(new Error("ACP settings closed before the request completed."));
  async function reload() {
    const result = await request<GenericAcpSummary[]>("generic_acp_list");
    if (!activeRef.current) return;
    if (!Array.isArray(result))
      throw new Error("ACP configuration is unavailable on this machine. Update its app or host.");
    setConfigs(result);
  }
  useEffect(() => {
    let cancelled = false;
    activeRef.current = true;
    setLoading(true);
    setConfigs([]);
    setRegistry([]);
    setRegistryOpen(false);
    setRegistryState("idle");
    setError("");
    setStatus("");
    resetForm();
    void request<GenericAcpSummary[]>("generic_acp_list")
      .then((result) => {
        if (cancelled) return;
        if (!Array.isArray(result))
          throw new Error(
            "ACP configuration is unavailable on this machine. Update its app or host.",
          );
        setConfigs(result);
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      activeRef.current = false;
    };
  }, [cwd]);
  async function run(label: string, action: () => Promise<void>) {
    if (!activeRef.current || busyRef.current || loading) return;
    busyRef.current = true;
    setError("");
    setStatus("");
    setBusy(label);
    try {
      await action();
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
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      busyRef.current = false;
      if (activeRef.current) setBusy("");
      if (cancelingInstallRef.current) {
        cancelingInstallRef.current = "";
        if (activeRef.current) setCancelingInstallId("");
      }
    }
  }
  const editing = configs.some((config) => config.id === form.id);
  const openAgentForm = () => {
    const details = formDisclosureRef.current?.querySelector("details");
    const summary = details?.querySelector("summary");
    if (!details || !summary) return;
    if (!details.open) summary.click();
    summary.focus();
  };
  const openRegistry = () => {
    if (!activeRef.current || busyRef.current) return;
    if (registryOpen) {
      setRegistryOpen(false);
      return;
    }
    setRegistryOpen(true);
    setRegistryState("loading");
    void run("Loading registry", async () => {
      try {
        const entries = await request<AcpRegistryEntry[]>("generic_acp_registry", {
          refresh: true,
        });
        if (!activeRef.current) return;
        if (!Array.isArray(entries)) {
          throw new Error(
            "ACP configuration is unavailable on this machine. Update its app or host.",
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
        setError(reason instanceof Error ? reason.message : String(reason));
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
            <SecondaryButton
              aria-controls="acp-agent-form-disclosure"
              disabled={loading || !!busy}
              onClick={openAgentForm}
            >
              {t("Add agent")}
            </SecondaryButton>
            <SecondaryButton
              disabled={loading || !!busy}
              onClick={() => void run("Loading agents…", async () => {})}
            >
              {t("Reload agents")}
            </SecondaryButton>
          </div>
        }
      >
        {loading || busy || status || (!configs.length && !error) ? (
          <Alert tone="info" role="status">
            {loading
              ? t("Loading ACP agents…")
              : busy
                ? t(busy)
                : status
                  ? t(status)
                  : t("No ACP agents configured. Use Add agent or browse the registry.")}
          </Alert>
        ) : null}
        {error && (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        )}
        {configs.map((config) => (
          <div
            key={config.id}
            className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-content/5 px-3 py-2 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-medium text-content" title={config.name}>
                {config.name}
              </div>
              <div className="truncate text-[10px] text-content/50" title={config.command}>
                {config.command} · {config.envKeys.length}
                {t(" environment values")}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <SecondaryButton
                disabled={loading || !!busy}
                onClick={() => {
                  if (draftDirty) {
                    setStatus("Save or cancel the current agent draft before opening another.");
                    openAgentForm();
                    return;
                  }
                  const { envKeys: _keys, ...values } = config;
                  resetForm(values);
                }}
              >
                {t("Edit")}
              </SecondaryButton>
              <SecondaryButton
                danger
                disabled={loading || !!busy}
                onClick={() =>
                  void run("Removing", () => request("generic_acp_remove", { id: config.id }))
                }
              >
                {t("Remove")}
              </SecondaryButton>
            </div>
          </div>
        ))}
        <div id="acp-agent-form-disclosure" ref={formDisclosureRef}>
          <AdvancedSettings
            key={`${formRevision}:${editing ? form.id : "new"}`}
            defaultOpen={editing}
            title={editing ? t("Edit agent") : t("Add agent")}
            settingIds={["acp-advanced"]}
          >
            <form
              className="grid gap-x-3 gap-y-3 px-3 pb-3 pt-2 sm:grid-cols-2"
              onChange={() => {
                setDraftDirty(true);
                setStatus("");
              }}
              onSubmit={(event) => {
                event.preventDefault();
                void run("Saving", async () => {
                  const args = JSON.parse(argsText);
                  const env = envText.trim() ? JSON.parse(envText) : undefined;
                  await request("generic_acp_save", {
                    config: { ...form, args, ...(env ? { env } : {}) },
                  });
                  if (!activeRef.current) return;
                  setStatus("ACP agent saved on the target machine.");
                  setFormRevision((revision) => revision + 1);
                  resetForm();
                });
              }}
            >
              <p className="text-[11px] font-normal leading-snug text-content/55 sm:col-span-2">
                {t(
                  "Configure an executable on the session's machine. Credentials and environment values stay on that machine. Arguments are a JSON array; commands are launched without a shell.",
                )}
              </p>
              <Field label={t("Agent id")}>
                <TextField
                  label={t("Agent id")}
                  hideLabel
                  fieldClassName="w-full"
                  disabled={loading || !!busy}
                  value={form.id}
                  required
                  pattern="[a-z0-9][a-z0-9._-]*"
                  spellCheck={false}
                  placeholder="my-agent"
                  onChange={(event) => setForm({ ...form, id: event.target.value })}
                />
              </Field>
              <Field label={t("Name")}>
                <TextField
                  label={t("Name")}
                  hideLabel
                  fieldClassName="w-full"
                  disabled={loading || !!busy}
                  value={form.name}
                  required
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </Field>
              <Field wide label={t("Executable path")}>
                <TextField
                  label={t("Executable path")}
                  hideLabel
                  fieldClassName="w-full"
                  disabled={loading || !!busy}
                  className="font-mono"
                  value={form.command}
                  required
                  spellCheck={false}
                  onChange={(event) => setForm({ ...form, command: event.target.value })}
                />
              </Field>
              <div className="sm:col-span-2">
                <AdvancedSettings
                  key={editing ? form.id : "new"}
                  defaultOpen={editing}
                  title={t("ACP arguments, environment and model context")}
                  settingIds={["acp-advanced"]}
                >
                  <div
                    id="setting-acp-advanced"
                    data-setting-id="acp-advanced"
                    className="grid gap-x-3 gap-y-3 py-3 sm:grid-cols-2"
                  >
                    <Field wide label={t("Arguments (JSON array)")}>
                      <TextareaField
                        label={t("Arguments (JSON array)")}
                        hideLabel
                        disabled={loading || !!busy}
                        aria-label={t("Arguments (JSON array)")}
                        className="min-h-20 font-mono"
                        value={argsText}
                        spellCheck={false}
                        rows={3}
                        onChange={(event) => setArgsText(event.target.value)}
                      />
                    </Field>
                    <Field
                      wide
                      label={t("Environment (JSON object; blank preserves stored values)")}
                    >
                      <PasswordField
                        label={t("Environment (JSON object; blank preserves stored values)")}
                        hideLabel
                        fieldClassName="w-full"
                        disabled={loading || !!busy}

                        autoComplete="off"
                        className="font-mono"
                        value={envText}
                        spellCheck={false}
                        onChange={(event) => setEnvText(event.target.value)}
                      />
                    </Field>
                    <Field label={t("ACP authentication method id (optional)")}>
                      <TextField
                        label={t("ACP authentication method id (optional)")}
                        hideLabel
                        fieldClassName="w-full"
                        disabled={loading || !!busy}
                        value={form.authMethodId ?? ""}
                        spellCheck={false}
                        onChange={(event) =>
                          setForm({ ...form, authMethodId: event.target.value || undefined })
                        }
                      />
                    </Field>
                    <Field label={t("Context window tokens (optional)")}>
                      <NumberField
                        label={t("Context window tokens (optional)")}
                        hideLabel
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
                    </Field>
                  </div>
                </AdvancedSettings>
              </div>
              <div className="flex items-center gap-2 sm:col-span-2">
                <SecondaryButton disabled={loading || !!busy} type="submit">
                  {busy === "Saving" ? t("Saving…") : t("Save agent")}
                </SecondaryButton>
                <SecondaryButton
                  disabled={loading || !!busy}
                  onClick={() => {
                    resetForm();
                    setFormRevision((revision) => revision + 1);
                  }}
                >
                  {t("Cancel")}
                </SecondaryButton>
              </div>
            </form>
          </AdvancedSettings>
        </div>
        <div
          id="setting-acp-registry"
          data-setting-id="acp-registry"
          className="border-t border-content/5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span className="text-[11px] text-content/55">
              {t("Install compatible ACP agents from the registry.")}
            </span>
            <SecondaryButton
              aria-expanded={registryOpen}
              aria-controls="setting-acp-registry-results"
              disabled={loading || !!busy}
              onClick={openRegistry}
            >
              {t("Browse ACP Registry")}
            </SecondaryButton>
          </div>
          <div
            id="setting-acp-registry-results"
            className="border-t border-content/5"
            hidden={!registryOpen}
          >
            <p className="px-3 py-2 text-[10px] leading-snug text-content/45">
              {t(
                "Install downloads an exact package version into isolated host storage and may run package installation scripts. Binary and Python distributions can be configured as local commands.",
              )}
            </p>
            {registryState === "loading" ? (
              <Alert tone="info" role="status">
                {t("Loading ACP registry…")}
              </Alert>
            ) : registryState === "error" ? null : registryState === "loaded" &&
              registry.length > 0 ? (
              <div className="divide-y divide-content/5">
                {registry.map((entry) => (
                  <div
                    key={`${entry.id}:${entry.version}`}
                    className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div
                        className="truncate text-[12px] font-medium text-content"
                        title={`${entry.name} ${entry.version}`}
                      >
                        {entry.name} <span className="text-content/50">{entry.version}</span>
                      </div>
                      <p className="mt-0.5 text-[10px] leading-snug text-content/55">
                        {entry.supported
                          ? entry.description
                          : `${entry.description} ${entry.unsupportedReason ?? ""}`.trim()}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {entry.supported ? (
                        <SecondaryButton
                          disabled={loading || !!busy}
                          onClick={() =>
                            void run(t("Installing {p0}…", { p0: entry.id }), () =>
                              request("generic_acp_install", {
                                id: entry.id,
                                version: entry.version,
                              }),
                            )
                          }
                        >
                          {t("Install ")}
                          {entry.package}
                        </SecondaryButton>
                      ) : null}
                      {busy === t("Installing {p0}…", { p0: entry.id }) ? (
                        <SecondaryButton
                          danger
                          disabled={cancelingInstallId === entry.id}
                          loading={cancelingInstallId === entry.id}
                          onClick={() => void cancelInstallation(entry.id)}
                        >
                          {cancelingInstallId === entry.id
                            ? t("Cancelling installation…")
                            : t("Cancel installation")}
                        </SecondaryButton>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : registryState === "loaded" ? (
              <p className="px-3 pb-2 text-[11px] text-content/55">
                {t("No ACP registry entries found.")}
              </p>
            ) : null}
          </div>
        </div>
      </AcpSettingsShell>
    </div>
  );
}
