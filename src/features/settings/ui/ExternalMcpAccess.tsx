import { Alert } from "../../../shared/ui/Alert";
import { NumberField } from "../../../shared/ui/NumberField";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Modal } from "../../../shared/ui/Modal";
import { Popover } from "../../../shared/ui/Popover";
import { CircleHelp, RefreshCw } from "../../../shared/ui/icons";
import { copyText } from "../../../platform/tauri/clipboard";
import { remoteRequest } from "../../connections/model/connections";
import { isLocalSyncMachine } from "../../connections/model/localSync";
import type { HostProject, RemoteMachine } from "../../connections/model/protocol";
import { Select } from "./settingsControls";
import styles from "./ExternalMcpAccess.module.css";

const groups = ["conversation", "runtime-logs", "social"] as const;
type Group = (typeof groups)[number];
type Scopes = Partial<Record<Group, ("read" | "write")[]>>;
type Grant = {
  id: string;
  name: string;
  projectId: string;
  scopes: Scopes;
  createdAt: number;
  expiresAt: number;
  revokedAt?: number;
};

// Examples contain only an environment variable reference, never a minted secret.
export function externalMcpExamples(endpoint: string) {
  return {
    claude: JSON.stringify(
      {
        mcpServers: {
          bycoda: {
            type: "http",
            url: endpoint,
            headers: { Authorization: "Bearer ${BYCODA_MCP_TOKEN}" },
          },
        },
      },
      null,
      2,
    ),
    codex: `[mcp_servers.bycoda]\nurl = "${endpoint}"\nbearer_token_env_var = "BYCODA_MCP_TOKEN"`,
  };
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const pending = useRef(false);
  return (
    <>
      <Button
        loading={state === "copying"}
        onClick={async () => {
          if (pending.current) return;
          pending.current = true;
          setState("copying");
          try {
            await copyText(value);
            setState("copied");
          } catch {
            setState("error");
          } finally {
            pending.current = false;
          }
        }}
      >
        {label}
      </Button>
      <span role="status">
        {state === "copied" ? t("Copied") : state === "error" ? t("Copy failed. Try again.") : ""}
      </span>
    </>
  );
}

function CreateToken({
  machine,
  projects,
  cwd,
  onClose,
  onCreated,
}: {
  machine: RemoteMachine;
  projects: HostProject[];
  cwd: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState(
    projects.find((p) => p.cwd === cwd)?.id ?? projects[0]?.id ?? "",
  );
  const [days, setDays] = useState("30");
  const [modes, setModes] = useState<Record<Group, string>>({
    conversation: "read",
    "runtime-logs": "",
    social: "",
  });
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const alive = useRef(true);
  const nameField = useRef<HTMLInputElement>(null);
  const tokenField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    (secret ? tokenField : nameField).current?.focus();
  }, [secret]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current || secret) return;
    const duration = Number(days);
    if (
      !name.trim() ||
      !projects.some((p) => p.id === projectId) ||
      !Number.isInteger(duration) ||
      duration < 1 ||
      duration > 366 ||
      !groups.some((g) => modes[g])
    ) {
      setError(t("Choose a project, at least one scope, and a duration from 1 to 366 days."));
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    const scopes: Scopes = {};
    for (const group of groups)
      if (modes[group]) scopes[group] = modes[group].split(",") as ("read" | "write")[];
    try {
      const result = await remoteRequest<Grant & { token: string }>(
        machine.id,
        "mcp.tokens.create",
        {
          name: name.trim(),
          projectId,
          scopes,
          expiresAt: Date.now() + duration * 86400_000,
        },
      );
      if (!alive.current) return;
      setSecret(result.token);
      onCreated();
    } catch {
      // Never render an RPC error payload: it could contain credential material.
      if (alive.current)
        setError(t("Token creation failed. Refresh the list before trying again."));
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Modal
      title={secret ? t("Token created") : t("Create token")}
      onClose={() => {
        if (!pending.current) {
          setSecret(null);
          onClose();
        }
      }}
      size="sm"
    >
      {secret ? (
        <div className={styles.stack}>
          <p>{t("Copy this token now. It will not be shown again.")}</p>
          <TextField
            ref={tokenField}
            label={t("Token")}
            value={secret}
            readOnly
            autoComplete="off"
            spellCheck={false}
          />
          <div className={styles.actions}>
            <CopyButton value={secret} label={t("Copy token")} />
            <Button
              onClick={() => {
                setSecret(null);
                onClose();
              }}
            >
              {t("Done")}
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={(event) => void submit(event)} className={styles.stack} aria-busy={busy}>
          <TextField
            ref={nameField}
            label={t("Token name")}
            autoFocus
            required
            maxLength={200}
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
          <SearchableSelect
            label={t("Project")}
            value={projectId}
            options={projects.map((p) => ({ value: p.id, label: p.name, keywords: p.cwd }))}
            onChange={setProjectId}
            disabled={busy}
          />
          <fieldset disabled={busy} className={styles.stack}>
            <legend>{t("Tool groups and scopes")}</legend>
            {groups.map((group) => (
              <div key={group} className={styles.scope}>
                <span>{group}</span>
                <Select
                  label={group}
                  value={modes[group]}
                  disabled={busy}
                  options={[
                    { value: "", label: t("No access") },
                    { value: "read", label: t("Read") },
                    { value: "write", label: t("Write") },
                    { value: "read,write", label: t("Read and write") },
                  ]}
                  onChange={(value) => setModes((current) => ({ ...current, [group]: value }))}
                />
              </div>
            ))}
          </fieldset>
          <NumberField
            label={t("Duration (days)")}

            min={1}
            max={366}
            step={1}
            required
            value={days}
            disabled={busy}
            onChange={(e) => setDays(e.target.value)}
          />
          {error && (
            <Alert tone="danger" role="alert">
              {error}
            </Alert>
          )}
          <div className={styles.actions}>
            <Button disabled={busy} onClick={onClose}>
              {t("Cancel")}
            </Button>
            <Button variant="primary" type="submit" loading={busy}>
              {t("Create token")}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function ExternalMcpAccess({ cwd }: { cwd: string }) {
  useLocale();
  const [data, setData] = useState<{
    machine: RemoteMachine;
    projects: HostProject[];
    tokens: Grant[];
  }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const info = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  const epoch = useRef(0);
  async function refresh() {
    const version = ++epoch.current;
    setLoading(true);
    setError("");
    try {
      const machines = await invoke<RemoteMachine[]>("remote_machines");
      const machine = machines?.find(isLocalSyncMachine);
      if (!machine) throw new Error("Local host unavailable");
      const [projects, result] = await Promise.all([
        remoteRequest<HostProject[]>(machine.id, "projects.list"),
        remoteRequest<{ tokens: Grant[] }>(machine.id, "mcp.tokens.list"),
      ]);
      if (version === epoch.current) setData({ machine, projects, tokens: result.tokens });
    } catch {
      if (version === epoch.current)
        setError(
          t(
            "External MCP access unavailable. Check the local host connection and version, then refresh.",
          ),
        );
    } finally {
      if (version === epoch.current) setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    return () => {
      epoch.current++;
    };
  }, []);
  async function revoke(grant: Grant) {
    if (!data || pending.current) return;
    pending.current = true;
    setRevoking(grant.id);
    setError("");
    try {
      if (
        !(await ask(
          t('Revoke token "{p0}"? Connected clients will lose access immediately.', {
            p0: grant.name,
          }),
          { title: t("Revoke token"), kind: "warning" },
        ))
      )
        return;
      const result = await remoteRequest<{ revoked: boolean }>(
        data.machine.id,
        "mcp.tokens.revoke",
        { id: grant.id },
      );
      if (!result.revoked) throw new Error("Not revoked");
      setData(
        (current) =>
          current && {
            ...current,
            tokens: current.tokens.map((token) =>
              token.id === grant.id ? { ...token, revokedAt: Date.now() } : token,
            ),
          },
      );
    } catch {
      setError(t("Token revocation failed. Refresh and try again."));
    } finally {
      pending.current = false;
      setRevoking(null);
    }
  }
  const endpoint = data
    ? `http://127.0.0.1:${new URL(data.machine.endpoint).port || "80"}/mcp`
    : "http://127.0.0.1:<port>/mcp";
  const examples = externalMcpExamples(endpoint);
  return (
    <section
      id="setting-external-mcp-access"
      className={styles.section}
      aria-labelledby="external-mcp-heading"
      data-setting-id="external-mcp-access"
    >
      <div className={styles.header}>
        <h2 id="external-mcp-heading">{t("External MCP access")}</h2>
        <div className={styles.actions}>
          <Button
            ref={info}
            variant="ghost"
            iconOnly
            label={t("MCP connection examples")}
            aria-expanded={help}
            aria-haspopup="dialog"
            onClick={() => setHelp(!help)}
          >
            <CircleHelp className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            iconOnly
            label={t("Refresh tokens")}
            loading={loading}
            disabled={revoking !== null}
            onClick={() => void refresh()}
          >
            <RefreshCw className="size-3.5" />
          </Button>
          <Button
            disabled={!data?.projects.length || loading || !!error || revoking !== null}
            onClick={() => setCreating(true)}
          >
            {t("Create token")}
          </Button>
        </div>
      </div>
      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
      {loading && <p role="status">{t("Loading tokens…")}</p>}
      {!loading && data && !data.projects.length && (
        <p>{t("Register a project on the local host before creating a token.")}</p>
      )}
      {!loading && data && !data.tokens.length && (
        <p>{t("No external tokens. Create a token to connect a client.")}</p>
      )}
      <div className={styles.list}>
        {data?.tokens.map((grant) => (
          <div key={grant.id} className={styles.row}>
            <div className={styles.identity}>
              <span>{grant.name}</span>
              <span className={styles.metadata}>
                {data.projects.find((p) => p.id === grant.projectId)?.name ?? grant.projectId} ·{" "}
                {grant.revokedAt !== undefined
                  ? t("Revoked")
                  : grant.expiresAt <= Date.now()
                    ? t("Expired")
                    : t("Active")}
              </span>
              <span className={styles.metadata}>
                {t("Expires")}: {new Date(grant.expiresAt).toLocaleString()}
              </span>
              <details>
                <summary>{t("Scopes")}</summary>
                <span className={styles.metadata}>
                  {Object.entries(grant.scopes)
                    .map(
                      ([group, modes]) =>
                        `${group}: ${modes.map((mode) => (mode === "read" ? t("Read") : t("Write"))).join(", ")}`,
                    )
                    .join(" · ")}
                </span>
              </details>
            </div>
            {grant.revokedAt === undefined && (
              <Button
                variant="danger"
                loading={revoking === grant.id}
                disabled={loading || (revoking !== null && revoking !== grant.id)}
                onClick={() => void revoke(grant)}
              >
                {t("Revoke token")}
              </Button>
            )}
          </div>
        ))}
      </div>
      {help && (
        <Popover
          anchor={info}
          width={420}
          autoFocus
          onDismiss={() => setHelp(false)}
          role="dialog"
          aria-label={t("MCP connection examples")}
        >
          <div className={styles.help}>
            <p>
              {t(
                "Set BYCODA_MCP_TOKEN in the client environment, then restart the client. Keep it out of URLs and configuration files.",
              )}
            </p>
            <p>{t("This address connects to bycoda on this computer.")}</p>
            <strong>Claude Code · .mcp.json</strong>
            <pre>{examples.claude}</pre>
            <CopyButton value={examples.claude} label={t("Copy Claude Code example")} />
            <strong>Codex · config.toml</strong>
            <pre>{examples.codex}</pre>
            <CopyButton value={examples.codex} label={t("Copy Codex example")} />
          </div>
        </Popover>
      )}
      {creating && data && (
        <CreateToken
          machine={data.machine}
          projects={data.projects}
          cwd={cwd}
          onClose={() => setCreating(false)}
          onCreated={() => void refresh()}
        />
      )}
    </section>
  );
}
