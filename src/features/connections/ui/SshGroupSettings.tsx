import { Code } from "../../../shared/ui/Code";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { FieldGroup } from "../../../shared/ui/FieldGroup";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../../../shared/i18n";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { ConfirmMorph } from "../../../shared/ui/ConfirmMorph";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { LiveText } from "../../../shared/ui/LiveText";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { TextField } from "../../../shared/ui/TextField";
import { SshIdentityField } from "./SshIdentityField";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
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
    [notice, setNotice] = useState<"" | "saved" | "applied">("");
  const [draft, setDraft] = useRetainedState<{
    value: SshGroupDraft;
    expectedRevision: number | null;
  } | null>(`ssh-group-editor:${server.id}`, null);
  const environmentIds = useRef<number[]>([]).current;
  const nextEnvironmentId = useRef(0);
  const environmentScope = useRef<string | undefined>(undefined);
  if (environmentScope.current !== draft?.value.id) {
    environmentScope.current = draft?.value.id;
    environmentIds.length = 0;
  }
  const environmentCount = draft?.value.environment.length ?? 0;
  while (environmentIds.length < environmentCount) environmentIds.push(nextEnvironmentId.current++);
  if (environmentIds.length > environmentCount) environmentIds.length = environmentCount;
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
    (
      server.metadata as typeof server.metadata & {
        sshInheritance?: SshInheritance;
      }
    ).sshInheritance ?? null,
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
    setNotice("");
  };
  return (
    <Modal
      title={t("SSH group settings")}
      onClose={onClose}
      size="md"
      footer={
        <ModalActions>
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
                setNotice("applied");
              })
            }
          >
            {t("Apply inheritance")}
          </Button>
        </ModalActions>
      }
    >
      <div className="flex min-w-0 flex-col gap-3">
        <Text as="p" tone="muted">
          {t("Target")}: {server.name}
        </Text>
        <Text as="p" tone="muted">
          {t(
            "Local connection values stay saved. Only checked fields inherit from the selected group.",
          )}
        </Text>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <LiveText
          text={notice === "applied" ? t("SSH inheritance updated.") : ""}
          size="caption"
          tone="muted"
        />
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
            onClick={() => {
              setDraft({ value: sshGroupDraft(), expectedRevision: null });
              setNotice("");
            }}
          >
            {t("New group")}
          </Button>
          <Button
            disabled={busy || !selectedGroup}
            onClick={() => {
              setNotice("");
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
        <FieldGroup legend={t("Inherited fields")}>
          <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-x-3 gap-y-2">
            {SSH_INHERITED_FIELDS.map((field) => (
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
                label={t(labels[field])}
                key={field}
                size="caption"
                className="flex items-center gap-1"
              />
            ))}
            <Checkbox
              disabled={!selected || busy || loading}
              checked={environment}
              onChange={(event) => change(() => setEnvironment(event.target.checked))}
              label={t("Remote environment")}
              size="caption"
              className="flex items-center gap-1"
            />
          </div>
        </FieldGroup>
        {activePreview ? (
          <Text
            as="section"
            size="caption"
            tone="inherit"
            aria-label={t("Effective SSH configuration")}
            className="min-w-0"
          >
            <Text as="p" size="inherit" tone="inherit" weight="medium" className="break-all">
              {sshEndpointPreview(activePreview.value.configuration.endpoint)}
            </Text>
            <DescriptionList size="sm" className="mbs-2">
              {Object.entries(activePreview.value.configuration.provenance).map(
                ([field, source]) => (
                  <DescriptionItem
                    key={field}
                    term={t(labels[field as SshInheritedField] ?? field)}
                  >
                    {effectiveValue(field) !== undefined ? (
                      <Code className="block">{effectiveValue(field)}</Code>
                    ) : null}
                    <Text size="inherit" tone="muted">
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
                    </Text>
                  </DescriptionItem>
                ),
              )}
            </DescriptionList>
            {activePreview.value.configuration.environment.length ? (
              <Disclosure size="sm" className="mbs-2" summary={t("Remote environment")}>
                <p>
                  {t("Environment shell")}:{" "}
                  {activePreview.value.configuration.shellKind === "powershell"
                    ? "PowerShell"
                    : "POSIX"}
                </p>
                {activePreview.value.configuration.environment.map((entry) => (
                  <p key={entry.name} className="break-all">
                    <Code>
                      {entry.name}={entry.value}
                    </Code>
                  </p>
                ))}
              </Disclosure>
            ) : null}
          </Text>
        ) : null}
        {draft ? (
          <section
            aria-label={t("Group defaults")}
            {...surfaceAttributes(
              { frame: "stroke", edge: "top" },
              "flex min-w-0 flex-col gap-2 pbs-3",
            )}
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
            <SshIdentityField
              pathLabel={t("Default identity file")}
              value={draft.value.identityFile}
              disabled={busy}
              onChange={(value) => editDraft({ identityFile: value })}
            />
            <TextField
              label={t("Default certificate file")}
              value={draft.value.certificateFile}
              disabled={busy}
              onChange={(event) => editDraft({ certificateFile: event.target.value })}
            />
            <Text as="p" tone="muted">
              {t("Use absolute paths or ~/ for group key and certificate references.")}
            </Text>
            <Disclosure size="sm" textSize="caption" tone="muted" summary={t("Remote environment")}>
              <Text as="div" size="caption" tone="muted">
                <p>
                  {t(
                    "Literal non-secret values apply only to new interactive SSH terminals. SFTP and port forwarding inherit connection defaults only. Do not put passwords, tokens or private keys here.",
                  )}
                </p>
                <FieldGroup variant="bare" disabled={busy}>
                  <RadioGroup
                    variant="inline"
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
                </FieldGroup>
                {draft.value.environment.map((entry, index) => (
                  <div key={environmentIds[index]} className="mbs-2 flex min-w-0 items-end gap-1">
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
                      onClick={() => {
                        environmentIds.splice(index, 1);
                        editDraft({
                          environment: draft.value.environment.filter((_, i) => i !== index),
                        });
                      }}
                    >
                      {t("Remove")}
                    </Button>
                  </div>
                ))}
                <Button
                  disabled={busy || draft.value.environment.length >= 32}
                  onClick={() =>
                    editDraft({
                      environment: [...draft.value.environment, { name: "", value: "" }],
                    })
                  }
                >
                  {t("Add environment value")}
                </Button>
              </Text>
            </Disclosure>
            {!profile ? (
              <InlineError live="polite">
                {t("Enter valid group defaults and literal environment values.")}
              </InlineError>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" disabled={busy} onClick={() => setDraft(null)}>
                {t("Close editor")}
              </Button>
              {draft.expectedRevision !== null ? (
                <span className="me-auto">
                  <ConfirmMorph
                    label={t("Delete group")}
                    tone="danger"
                    disabled={busy}
                    onConfirm={() =>
                      operation(async () => {
                        await removeSshGroupDefaults(draft.value.id, draft.expectedRevision!);
                        if (!mounted.current) return;
                        setGroups((previous) =>
                          previous.filter((group) => group.id !== draft.value.id),
                        );
                        setDraft(null);
                        setPreview(undefined);
                      })
                    }
                  />
                </span>
              ) : null}
              <Button
                disabled={busy || !profile}
                success={notice === "saved"}
                successLabel={t("Saved")}
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
                    setNotice("saved");
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
