import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../../../shared/i18n";
import { Modal } from "../../../shared/ui/Modal";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { TextField } from "../../../shared/ui/TextField";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Alert } from "../../../shared/ui/Alert";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { sshEndpointPreview } from "../model/sshEndpointReview";
import type { ServerRecord } from "../model/serverInventory";
import {
  SSH_INHERITED_FIELDS,
  sshGroupDraft,
  sshGroupProfileFromDraft,
  listSshGroupDefaults,
  saveSshGroupDefaults,
  removeSshGroupDefaults,
  previewSshConfiguration,
  setSshInheritance,
  type SshConfigurationPreview,
  type SshGroupDefaults,
  type SshGroupDraft,
  type SshInheritance,
  type SshInheritedField,
} from "../model/sshGroupDefaults";

const labels: Record<SshInheritedField, string> = {
  user: "SSH user",
  port: "SSH port",
  identityFile: "Identity file",
  certificateFile: "Public SSH certificate file",
};
export function SshGroupSettings({
  server,
  onClose,
}: {
  server: ServerRecord;
  onClose: () => void;
}) {
  const [groups, setGroups] = useState<SshGroupDefaults[]>([]);
  const [selected, setSelected] = useState("");
  const [fields, setFields] = useState<SshInheritedField[]>([]);
  const [environment, setEnvironment] = useState(false);
  const [expected, setExpected] = useState<SshInheritance | null>(null);
  const [initialized, setInitialized] = useState(false);
  const loadEpoch = useRef(0);
  const initializedRef = useRef(false),
    mounted = useRef(false),
    locked = useRef(false);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [draft, setDraft] = useRetainedState<{
    value: SshGroupDraft;
    expectedRevision: number | null;
  } | null>(`ssh-group-editor:${server.id}`, null);
  const inheritance: SshInheritance | null = selected
    ? {
        groupId: selected,
        fields: SSH_INHERITED_FIELDS.filter((field) => fields.includes(field)),
        environment,
      }
    : null;
  const scope = JSON.stringify([
    server.id,
    server.sshEndpoint,
    (server.metadata as typeof server.metadata & { sshInheritance?: SshInheritance })
      .sshInheritance ?? null,
    inheritance,
  ]);
  const [preview, setPreview] = useState<{
    value: SshConfigurationPreview;
    scope: string;
    reviewed: boolean;
  }>();
  const activePreview = preview?.scope === scope ? preview : undefined;
  const operation = async (work: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (reason) {
      if (mounted.current) setError(String(reason));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const load = useCallback(async () => {
    const generation = ++loadEpoch.current;
    setLoading(true);
    setError("");
    const results = await Promise.allSettled([
      listSshGroupDefaults(),
      previewSshConfiguration(server.id, null, true),
    ]);
    if (!mounted.current || loadEpoch.current !== generation) return;
    if (results[0].status === "fulfilled") setGroups(results[0].value);
    if (results[1].status === "fulfilled") {
      const saved = results[1].value;
      if (saved.connectionId !== server.id) {
        setError(t("SSH configuration changed. Refresh and preview again."));
        setLoading(false);
        return;
      }
      setExpected(saved.inheritance);
      if (!initializedRef.current) {
        setSelected(saved.inheritance?.groupId ?? "");
        setFields(saved.inheritance?.fields ?? []);
        setEnvironment(saved.inheritance?.environment ?? false);
        initializedRef.current = true;
        setInitialized(true);
      }
    }
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") setError(String(failed.reason));
    setPreview(undefined);
    setLoading(false);
  }, [server.id]);
  useEffect(() => {
    mounted.current = true;
    void Promise.resolve().then(() => {
      if (mounted.current) void load();
    });
    return () => {
      mounted.current = false;
    };
  }, [load]);
  const change = (update: () => void) => {
    update();
    setPreview(undefined);
    setNotice("");
  };
  const selectedGroup = groups.find((group) => group.id === selected);
  const profile = draft ? sshGroupProfileFromDraft(draft.value) : undefined;
  const effectiveValue = (field: string) => {
    const value = (
      activePreview?.value.configuration.endpoint as Record<string, unknown> | undefined
    )?.[field];
    return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
  };
  const editDraft = (patch: Partial<SshGroupDraft>) => {
    if (draft) setDraft({ ...draft, value: { ...draft.value, ...patch } });
  };
  return (
    <Modal title={t("SSH group settings")} onClose={onClose} size="md">
      <div className="flex min-w-0 flex-col gap-3 p-4">
        <p className="text-xs text-(--ui-text-muted)">
          {t(
            "Local connection values stay saved. Only checked fields inherit from the selected group.",
          )}
        </p>
        {error ? (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        ) : null}
        {notice ? (
          <p role="status" className="text-xs text-(--ui-text-muted)">
            {notice}
          </p>
        ) : null}
        <div className="flex min-w-0 flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <SearchableSelect
              label={t("SSH group")}
              value={selected || "none"}
              onChange={(value) => change(() => setSelected(value === "none" ? "" : value))}
              disabled={busy || loading}
              options={[
                { value: "none", label: t("No inherited group") },
                ...groups.map((group) => ({ value: group.id, label: group.name })),
              ]}
            />
          </div>
          <Button disabled={busy || loading} onClick={() => void load()}>
            {t("Refresh")}
          </Button>
          <Button
            disabled={busy}
            onClick={() => setDraft({ value: sshGroupDraft(), expectedRevision: null })}
          >
            {t("New group")}
          </Button>
          <Button
            disabled={busy || !selectedGroup}
            onClick={() => {
              if (selectedGroup)
                setDraft({
                  value: sshGroupDraft(selectedGroup),
                  expectedRevision: selectedGroup.revision,
                });
            }}
          >
            {t("Edit group")}
          </Button>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-2">
          {SSH_INHERITED_FIELDS.map((field) => (
            <label key={field} className="flex items-center gap-1 text-xs">
              <Checkbox
                disabled={!selected || busy || loading}
                checked={fields.includes(field)}
                onChange={(event) =>
                  change(() =>
                    setFields(
                      event.target.checked
                        ? [...fields, field]
                        : fields.filter((entry) => entry !== field),
                    ),
                  )
                }
              />
              {t(labels[field])}
            </label>
          ))}
          <label className="flex items-center gap-1 text-xs">
            <Checkbox
              disabled={!selected || busy || loading}
              checked={environment}
              onChange={(event) => change(() => setEnvironment(event.target.checked))}
            />
            {t("Remote environment")}
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            disabled={busy || loading || !initialized}
            onClick={() =>
              void operation(async () => {
                const value = await previewSshConfiguration(server.id, inheritance, false);
                if (!mounted.current) return;
                if (
                  value.connectionId !== server.id ||
                  !value.configuration.digest ||
                  JSON.stringify(value.inheritance) !== JSON.stringify(inheritance)
                )
                  throw new Error(t("SSH configuration changed. Refresh and preview again."));
                setPreview({ value, scope, reviewed: true });
              })
            }
          >
            {t("Preview effective configuration")}
          </Button>
          <Button
            variant="primary"
            disabled={busy || !activePreview?.reviewed}
            onClick={() =>
              void operation(async () => {
                if (!activePreview?.reviewed) return;
                await setSshInheritance(
                  server.id,
                  inheritance,
                  expected,
                  activePreview.value.configuration.digest,
                );
                if (!mounted.current) return;
                setExpected(inheritance);
                setPreview(undefined);
                setNotice(t("SSH inheritance updated."));
              })
            }
          >
            {t("Apply inheritance")}
          </Button>
        </div>
        {activePreview ? (
          <section aria-label={t("Effective SSH configuration")} className="min-w-0 text-xs">
            <p className="break-all font-medium">
              {sshEndpointPreview(activePreview.value.configuration.endpoint)}
            </p>
            <dl className="mbs-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1">
              {Object.entries(activePreview.value.configuration.provenance).map(
                ([field, source]) => (
                  <div key={field} className="contents">
                    <dt className="break-all">{t(labels[field as SshInheritedField] ?? field)}</dt>
                    <dd className="break-all text-(--ui-text-muted)">
                      {effectiveValue(field) !== undefined ? (
                        <code className="block text-(--color-content)">
                          {effectiveValue(field)}
                        </code>
                      ) : null}
                      {t(
                        source.source === "group"
                          ? "Group"
                          : source.source === "connection"
                            ? "Connection"
                            : "Default",
                      )}
                      {source.groupId
                        ? ` · ${groups.find((group) => group.id === source.groupId)?.name ?? source.groupId} · r${source.revision}`
                        : ""}
                    </dd>
                  </div>
                ),
              )}
            </dl>
            {activePreview.value.configuration.environment.length ? (
              <details className="mbs-2">
                <summary className="cursor-pointer">{t("Remote environment")}</summary>
                <p>
                  {t("Environment shell")}:{" "}
                  {activePreview.value.configuration.shellKind === "powershell"
                    ? "PowerShell"
                    : "POSIX"}
                </p>
                {activePreview.value.configuration.environment.map((entry) => (
                  <p key={entry.name} className="break-all">
                    <code>
                      {entry.name}={entry.value}
                    </code>
                  </p>
                ))}
              </details>
            ) : null}
          </section>
        ) : null}
        {draft ? (
          <section
            aria-label={t("Group defaults")}
            className="flex min-w-0 flex-col gap-2 border-t border-stroke pbs-3"
          >
            <TextField
              label={t("Group name")}
              value={draft.value.name}
              disabled={busy}
              onChange={(event) => editDraft({ name: event.target.value })}
              maxLength={200}
            />
            <div className="grid min-w-0 grid-cols-2 gap-2">
              <TextField
                label={t("Default SSH user")}
                value={draft.value.user}
                disabled={busy}
                onChange={(event) => editDraft({ user: event.target.value })}
              />
              <TextField
                label={t("Default SSH port")}
                value={draft.value.port}
                inputMode="numeric"
                disabled={busy}
                onChange={(event) => editDraft({ port: event.target.value })}
              />
            </div>
            <TextField
              label={t("Default identity file")}
              value={draft.value.identityFile}
              disabled={busy}
              onChange={(event) => editDraft({ identityFile: event.target.value })}
            />
            <TextField
              label={t("Default certificate file")}
              value={draft.value.certificateFile}
              disabled={busy}
              onChange={(event) => editDraft({ certificateFile: event.target.value })}
            />
            <p className="text-xs text-(--ui-text-muted)">
              {t("Use absolute paths or ~/ for group key and certificate references.")}
            </p>
            <details className="text-xs text-(--ui-text-muted)">
              <summary className="cursor-pointer">{t("Remote environment")}</summary>
              <p className="mbs-2">
                {t(
                  "Literal non-secret values apply only to new interactive SSH terminals. SFTP and port forwarding inherit connection defaults only. Do not put passwords, tokens or private keys here.",
                )}
              </p>
              <fieldset disabled={busy} className="min-w-0 border-0 p-0">
                <SegmentedControl
                  label={t("Environment shell")}
                  value={draft.value.shellKind}
                  onValueChange={(value) =>
                    editDraft({ shellKind: value as "posix" | "powershell" })
                  }
                  options={[
                    { value: "posix", label: "POSIX" },
                    { value: "powershell", label: "PowerShell" },
                  ]}
                />
              </fieldset>
              {draft.value.environment.map((entry, index) => (
                <div key={index} className="mbs-2 flex min-w-0 items-end gap-1">
                  <TextField
                    fieldClassName="min-w-0 flex-1"
                    label={`${t("Variable name")} ${index + 1}`}
                    value={entry.name}
                    disabled={busy}
                    onChange={(event) =>
                      editDraft({
                        environment: draft.value.environment.map((item, i) =>
                          i === index ? { ...item, name: event.target.value } : item,
                        ),
                      })
                    }
                  />
                  <TextField
                    fieldClassName="min-w-0 flex-1"
                    label={`${t("Literal value")} ${index + 1}`}
                    value={entry.value}
                    disabled={busy}
                    onChange={(event) =>
                      editDraft({
                        environment: draft.value.environment.map((item, i) =>
                          i === index ? { ...item, value: event.target.value } : item,
                        ),
                      })
                    }
                  />
                  <Button
                    disabled={busy}
                    onClick={() =>
                      editDraft({
                        environment: draft.value.environment.filter((_, i) => i !== index),
                      })
                    }
                  >
                    {t("Remove")}
                  </Button>
                </div>
              ))}
              <Button
                disabled={busy || draft.value.environment.length >= 32}
                onClick={() =>
                  editDraft({ environment: [...draft.value.environment, { name: "", value: "" }] })
                }
              >
                {t("Add environment value")}
              </Button>
            </details>
            {!profile ? (
              <p role="status" className="text-xs text-(--ui-tone-danger-fg)">
                {t("Enter valid group defaults and literal environment values.")}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" disabled={busy} onClick={() => setDraft(null)}>
                {t("Close editor")}
              </Button>
              {draft.expectedRevision !== null ? (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void operation(async () => {
                      await removeSshGroupDefaults(draft.value.id, draft.expectedRevision!);
                      if (!mounted.current) return;
                      setGroups((previous) =>
                        previous.filter((group) => group.id !== draft.value.id),
                      );
                      setDraft(null);
                      setPreview(undefined);
                    })
                  }
                >
                  {t("Delete group")}
                </Button>
              ) : null}
              <Button
                disabled={busy || !profile}
                onClick={() =>
                  void operation(async () => {
                    if (!profile) return;
                    const saved = await saveSshGroupDefaults(profile, draft.expectedRevision);
                    if (!mounted.current) return;
                    setGroups((previous) => [
                      ...previous.filter((group) => group.id !== saved.id),
                      saved,
                    ]);
                    setDraft({ value: sshGroupDraft(saved), expectedRevision: saved.revision });
                    setPreview(undefined);
                    setNotice(t("Group defaults saved."));
                  })
                }
              >
                {t("Save group")}
              </Button>
            </div>
          </section>
        ) : null}
      </div>
    </Modal>
  );
}
