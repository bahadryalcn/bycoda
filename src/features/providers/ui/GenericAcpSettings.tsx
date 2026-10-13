import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { hostFeatureRequest } from "../../connections/model/hostFeatureClient";
import { parseRemotePath } from "../../connections/model/remoteProjects";
import { refreshGenericAcpCatalog } from "../../../integrations/harness/providers/generic-acp/genericAcpAdapter";
import { probeHarnessAvailability } from "../../../integrations/harness/core/availability";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { Group, Row } from "../../settings/ui/settingsControls";
import type { AcpRegistryEntry, GenericAcpConfig, GenericAcpSummary } from "../model/genericAcp";

const inputClass =
  "h-8 w-full rounded-md border border-content/10 bg-transparent px-2 text-[12px] text-content outline-none placeholder:text-content/30 focus:border-content/20 disabled:opacity-40";

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
    <label
      className={`flex min-w-0 flex-col gap-1 text-[12px] font-medium text-content/80 ${wide ? "sm:col-span-2" : ""}`}
    >
      {label}
      {children}
      {hint ? (
        <span className="text-[11px] font-normal leading-snug text-content/45">{hint}</span>
      ) : null}
    </label>
  );
}

export function GenericAcpSettings({ cwd = "" }: { cwd?: string }) {
  useLocale();
  const [configs, setConfigs] = useState<GenericAcpSummary[]>([]);
  const [registry, setRegistry] = useState<AcpRegistryEntry[]>([]);
  const [form, setForm] = useState<GenericAcpConfig>({ id: "", name: "", command: "", args: [] });
  const [argsText, setArgsText] = useState("[]");
  const [envText, setEnvText] = useState("");
  const resetForm = (next: GenericAcpConfig = { id: "", name: "", command: "", args: [] }) => {
    setForm(next);
    setArgsText(JSON.stringify(next.args));
    setEnvText("");
  };
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const request = <T,>(command: string, params: Record<string, unknown> = {}) =>
    parseRemotePath(cwd)
      ? hostFeatureRequest<T>(cwd, "generic-acp-v1", command, params)
      : invoke<T>(command, params);
  async function reload() {
    const result = await request<GenericAcpSummary[]>("generic_acp_list");
    if (!Array.isArray(result))
      throw new Error("ACP configuration is unavailable on this machine. Update its app or host.");
    setConfigs(result);
  }
  useEffect(() => {
    void reload().catch((reason) => setError(String(reason)));
  }, [cwd]);
  async function run(label: string, action: () => Promise<void>) {
    setError("");
    setBusy(label);
    try {
      await action();
      await reload();
      if (!parseRemotePath(cwd)) {
        await refreshGenericAcpCatalog();
        await probeHarnessAvailability({ force: true });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy("");
    }
  }
  const editing = configs.some((config) => config.id === form.id);
  return (
    <div className="space-y-8 pt-8" aria-label={t("Generic ACP agents")}>
      <Group
        layout="full"
        title={t("ACP agents")}
        description={t(
          "Configure an executable on the session's machine. Credentials and environment values stay on that machine. Arguments are a JSON array; commands are launched without a shell.",
        )}
      >
        {error && (
          <p
            role="alert"
            className="border-b border-content/5 px-4 py-3 text-[12px] text-red-400/90"
          >
            {error}
          </p>
        )}
        {configs.map((config) => (
          <Row
            key={config.id}
            label={config.name}
            description={`${config.command} · ${config.envKeys.length}${t(" environment values")}`}
          >
            <SecondaryButton
              disabled={!!busy}
              onClick={() => {
                const { envKeys: _keys, ...values } = config;
                resetForm(values);
              }}
            >
              {t("Edit")}
            </SecondaryButton>
            <SecondaryButton
              danger
              disabled={!!busy}
              onClick={() =>
                void run("Removing", () => request("generic_acp_remove", { id: config.id }))
              }
            >
              {t("Remove")}
            </SecondaryButton>
          </Row>
        ))}
        <form
          className="grid gap-x-4 gap-y-3.5 px-4 py-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run("Saving", async () => {
              const args = JSON.parse(argsText);
              const env = envText.trim() ? JSON.parse(envText) : undefined;
              await request("generic_acp_save", {
                config: { ...form, args, ...(env ? { env } : {}) },
              });
              resetForm();
            });
          }}
        >
          <Field label={t("Agent id")}>
            <input
              className={inputClass}
              value={form.id}
              required
              pattern="[a-z0-9][a-z0-9._-]*"
              spellCheck={false}
              placeholder="my-agent"
              onChange={(event) => setForm({ ...form, id: event.target.value })}
            />
          </Field>
          <Field label={t("Name")}>
            <input
              className={inputClass}
              value={form.name}
              required
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </Field>
          <Field wide label={t("Executable path")}>
            <input
              className={`${inputClass} font-mono`}
              value={form.command}
              required
              spellCheck={false}
              onChange={(event) => setForm({ ...form, command: event.target.value })}
            />
          </Field>
          <Field wide label={t("Arguments (JSON array)")}>
            <input
              className={`${inputClass} font-mono`}
              value={argsText}
              spellCheck={false}
              onChange={(event) => setArgsText(event.target.value)}
            />
          </Field>
          <Field wide label={t("Environment (JSON object; blank preserves stored values)")}>
            <input
              type="password"
              autoComplete="off"
              className={`${inputClass} font-mono`}
              value={envText}
              spellCheck={false}
              onChange={(event) => setEnvText(event.target.value)}
            />
          </Field>
          <Field label={t("ACP authentication method id (optional)")}>
            <input
              className={inputClass}
              value={form.authMethodId ?? ""}
              spellCheck={false}
              onChange={(event) =>
                setForm({ ...form, authMethodId: event.target.value || undefined })
              }
            />
          </Field>
          <Field label={t("Context window tokens (optional)")}>
            <input
              type="number"
              min={1024}
              className={inputClass}
              value={form.contextWindow ?? ""}
              onChange={(event) =>
                setForm({
                  ...form,
                  contextWindow: event.target.value ? Number(event.target.value) : undefined,
                })
              }
            />
          </Field>
          <div className="flex items-center gap-2 sm:col-span-2">
            <SecondaryButton disabled={!!busy} type="submit">
              {t("Save agent")}
            </SecondaryButton>
            {editing && (
              <SecondaryButton
                disabled={!!busy}
                onClick={() => {
                  resetForm();
                }}
              >
                {t("Cancel")}
              </SecondaryButton>
            )}
            {busy && (
              <span role="status" className="text-[12px] text-content/45">
                {busy}…
              </span>
            )}
          </div>
        </form>
      </Group>
      <Group
        layout="full"
        title={t("Browse ACP Registry")}
        description={t(
          "Install downloads an exact package version into isolated host storage and may run package installation scripts. Binary and Python distributions can be configured as local commands.",
        )}
        action={
          <SecondaryButton
            disabled={!!busy}
            onClick={() =>
              void run("Loading registry", async () =>
                setRegistry(await request("generic_acp_registry", { refresh: true })),
              )
            }
          >
            {t("Browse ACP Registry")}
          </SecondaryButton>
        }
      >
        {registry.map((entry) => (
          <Row
            key={`${entry.id}:${entry.version}`}
            label={`${entry.name} ${entry.version}`}
            description={
              entry.supported
                ? entry.description
                : `${entry.description} ${entry.unsupportedReason ?? ""}`.trim()
            }
          >
            {entry.supported && (
              <SecondaryButton
                disabled={!!busy}
                onClick={() =>
                  void run(`Installing ${entry.id}`, () =>
                    request("generic_acp_install", { id: entry.id, version: entry.version }),
                  )
                }
              >
                {t("Install ")}
                {entry.package}
              </SecondaryButton>
            )}
            {busy === `Installing ${entry.id}` && (
              <SecondaryButton
                danger
                onClick={() =>
                  void request("generic_acp_cancel_install", { id: entry.id }).catch((reason) =>
                    setError(String(reason)),
                  )
                }
              >
                {t("Cancel installation")}
              </SecondaryButton>
            )}
          </Row>
        ))}
      </Group>
    </div>
  );
}
