import { useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { catalogText } from "../../sessions/public/catalogText";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { DropdownMenu, type DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { ChevronDown, X } from "../../../shared/ui/icons";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Text } from "../../../shared/ui/Text";
import { TextField } from "../../../shared/ui/TextField";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import {
  applyTaskWorkflow,
  BUILTIN_TASK_WORKFLOWS,
  loadTaskWorkflows,
  saveTaskWorkflows,
  type TaskWorkflowDraft,
  type TaskWorkflowProfile,
  type TaskWorkflowScope,
} from "../model/taskWorkflows";
import type { TaskPreflightReport, TaskPreflightRequirement } from "../model/taskPreflight";
import {
  alignRequirementRowKeys,
  appendRequirementRowKey,
  EMPTY_REQUIREMENT_ROW_KEYS,
  removeRequirementRowKey,
} from "../model/taskRequirementRows";

type TemplateProps = {
  scope: TaskWorkflowScope;
  draft: TaskWorkflowDraft;
  templateId?: string;
  busy: boolean;
  onApply: (draft: TaskWorkflowDraft, profile: TaskWorkflowProfile) => void;
};

/** Applying or saving a template changes the draft only. */
export function TaskTemplateMenu(props: TemplateProps) {
  return <ScopedTemplateMenu key={JSON.stringify(props.scope)} {...props} />;
}

function readTemplates(scope: TaskWorkflowScope) {
  if (!scope.machineId || !scope.projectId) return [];
  try {
    return loadTaskWorkflows(scope);
  } catch {
    throw new Error(t("Saved templates could not be read. Existing saved data was preserved."));
  }
}

function ScopedTemplateMenu({ scope, draft, templateId, busy, onApply }: TemplateProps) {
  useLocale();
  const anchor = useRef<HTMLButtonElement>(null);
  const initial = () => {
    try {
      return readTemplates(scope);
    } catch {
      return [];
    }
  };
  const [profiles, setProfiles] = useState(initial);
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [nameOwner, setNameOwner] = useState<string>();
  const [error, setError] = useState<{ details?: string } | null>(null);
  const all = [...BUILTIN_TASK_WORKFLOWS, ...profiles];
  const custom = profiles.find((profile) => profile.id === templateId);
  const profileName = (profile: TaskWorkflowProfile) => {
    if (!BUILTIN_TASK_WORKFLOWS.includes(profile)) return profile.name;
    if (profile.id === "preset-bug-fix") return t("Bug fix");
    if (profile.id === "preset-source-research") return t("Source research");
    if (profile.id === "preset-ui-change") return t("UI change");
    return profile.name;
  };
  const selected = all.find((profile) => profile.id === templateId);
  const close = () => {
    setOpen(false);
    setNaming(false);
  };
  const attempt = (operation: () => void) => {
    setError(null);
    try {
      operation();
    } catch (failure) {
      setError({ details: failure instanceof Error ? failure.message : undefined });
    }
  };
  const latestForEdit = () => {
    const latest = readTemplates(scope);
    if (
      custom &&
      JSON.stringify(latest.find((entry) => entry.id === custom.id)) !== JSON.stringify(custom)
    )
      throw new Error(t("This template changed in another window. Reopen the menu before saving."));
    return latest;
  };
  const save = () =>
    attempt(() => {
      const latest = latestForEdit();
      const now = Date.now();
      const createdAt = custom?.createdAt ?? now;
      const updatedAt = Math.max(now, createdAt, custom ? custom.updatedAt + 1 : now);
      if (
        !Number.isSafeInteger(now) ||
        now < 0 ||
        !Number.isSafeInteger(updatedAt) ||
        updatedAt > 8_640_000_000_000_000
      )
        throw new Error(t("The template could not be updated."));
      const profile: TaskWorkflowProfile = {
        schema: "bycoda.task-workflow.v1",
        id: custom?.id ?? crypto.randomUUID(),
        name: name.trim(),
        draft,
        createdAt,
        updatedAt,
      };
      const next = custom
        ? latest.map((entry) => (entry.id === custom.id ? profile : entry))
        : [...latest, profile];
      try {
        saveTaskWorkflows(scope, next);
      } catch {
        throw new Error(t("The template could not be updated."));
      }
      setProfiles(next);
      onApply(draft, profile);
      setNaming(false);
      setName("");
      setNameOwner(undefined);
    });
  const remove = () =>
    attempt(() => {
      const next = latestForEdit().filter((profile) => profile.id !== custom?.id);
      try {
        saveTaskWorkflows(scope, next);
      } catch {
        throw new Error(t("The template could not be updated."));
      }
      setProfiles(next);
      setNaming(false);
      setName("");
      setNameOwner(undefined);
    });
  const items: DropdownMenuItem[] = [
    ...all.map((profile): DropdownMenuItem => ({
      kind: "item",
      id: `template:${profile.id}`,
      label: profileName(profile),
      selectionRole: "radio",
      checked: profile.id === templateId,
      closeOnSelect: false,
    })),
    { kind: "sep" },
    {
      kind: "item",
      id: "save",
      label: t("Save as template"),
      disabled: !scope.machineId || !scope.projectId,
      closeOnSelect: false,
    },
    ...(custom
      ? [
          {
            kind: "item" as const,
            id: "remove",
            label: t("Remove template"),
            danger: true,
            closeOnSelect: false,
          },
        ]
      : []),
    ...(naming
      ? [
          {
            kind: "content" as const,
            id: "name",
            node: (
              <div className="flex min-w-0 items-end gap-2">
                <TextField
                  label={t("Template name")}
                  autoFocus
                  value={name}
                  maxLength={120}
                  onChange={(event) => setName(event.target.value)}
                />
                <Button
                  type="button"
                  disabled={!name.trim()}
                  disabledReason={name.trim() ? undefined : t("Enter a template name first.")}
                  onClick={save}
                >
                  {t("Save")}
                </Button>
              </div>
            ),
          },
        ]
      : []),
    ...(error
      ? [
          {
            kind: "content" as const,
            id: "error",
            node: (
              <InlineError details={error.details}>
                {t("The template could not be updated.")}
              </InlineError>
            ),
          },
        ]
      : []),
  ];
  return (
    <>
      <Button
        ref={anchor}
        type="button"
        variant="ghost"
        className="min-w-0 max-w-full"
        disabled={busy}
        aria-haspopup="menu"
        expanded={open && !busy}
        endIcon={<ChevronDown className="icon-xs" aria-hidden />}
        onClick={() => {
          if (open) {
            close();
            return;
          }
          attempt(() => setProfiles(readTemplates(scope)));
          setOpen(true);
        }}
      >
        <Text truncate size="inherit" tone="inherit">
          {selected ? t("Template: {p0}", { p0: profileName(selected) }) : t("Template")}
        </Text>
      </Button>
      {open && !busy ? (
        <DropdownMenu
          anchor={anchor}
          label={t("Template")}
          size="md"
          side="top"
          align="start"
          onClose={close}
          items={items}
          onPick={(id) => {
            if (id === "save") {
              const owner = templateId ?? "";
              if (nameOwner !== owner) {
                setName(custom?.name ?? "");
                setNameOwner(owner);
              }
              setNaming(true);
            } else if (id === "remove") {
              remove();
            } else {
              const profile = all.find((entry) => `template:${entry.id}` === id);
              if (profile)
                attempt(() => {
                  onApply(applyTaskWorkflow(profile, draft), profile);
                  close();
                  anchor.current?.focus();
                });
            }
          }}
        />
      ) : null}
    </>
  );
}

export type PreparationState = {
  pending?: boolean;
  error?: string;
  report?: TaskPreflightReport;
  retry?: () => void;
};

export function TaskResourceFields({
  requirements,
  onChange,
  preparation,
}: {
  requirements: readonly TaskPreflightRequirement[];
  onChange: (requirements: TaskPreflightRequirement[]) => void;
  preparation: PreparationState;
}) {
  useLocale();
  const [rowKeys, setRowKeys] = useState(EMPTY_REQUIREMENT_ROW_KEYS);
  const rows = alignRequirementRowKeys(rowKeys, requirements.length);
  const options = [
    { value: "source", label: t("Source") },
    { value: "skill", label: t("Skill") },
    { value: "connection", label: t("Connection") },
    { value: "tool", label: t("Tool") },
  ];
  const update = (index: number, patch: Partial<TaskPreflightRequirement>) =>
    onChange(requirements.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)));
  const { report, pending, error, retry } = preparation;
  return (
    <div className="task-resource-fields">
      <div className="task-form-row">
        <Text size="secondary">{t("Required resources")}</Text>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {pending ? (
            <LoadingText>{t("Checking preparation…")}</LoadingText>
          ) : report ? (
            <InlineMessage
              tone={
                report.state === "ready"
                  ? "success"
                  : report.state === "blocked"
                    ? "warning"
                    : "neutral"
              }
            >
              {report.state === "ready"
                ? t("Ready")
                : report.state === "blocked"
                  ? t("Preparation blocked")
                  : t("Preparation not verified")}
            </InlineMessage>
          ) : null}
          <Button
            type="button"
            size="xs"
            aria-label={t("Add resource")}
            disabled={requirements.length >= 40}
            disabledReason={t("A task can have at most 40 resources.")}
            onClick={() => {
              setRowKeys(appendRequirementRowKey(rowKeys, requirements.length));
              onChange([...requirements, { kind: "source", id: "", required: true }]);
            }}
          >
            {t("Add")}
          </Button>
        </div>
      </div>
      {requirements.map((resource, index) => {
        const kind =
          options.find((option) => option.value === resource.kind)?.label ?? resource.kind;
        const reference = resource.id.trim()
          ? truncateGraphemes(resource.id.trim(), 60)
          : t("No reference yet");
        return (
          <div
            key={rows.keys[index]}
            role="group"
            aria-label={t("{p1}: {p2}", { p1: kind, p2: reference })}
            className="task-resource-row"
          >
            <SearchableSelect
              hideLabel
              label={t("Resource type")}
              searchable={false}
              options={options}
              value={resource.kind}
              onChange={(value) =>
                update(index, { kind: value as TaskPreflightRequirement["kind"] })
              }
            />
            <TextField
              hideLabel
              label={t("Resource reference")}
              placeholder={t("Resource reference")}
              fieldVariant="compact"
              maxLength={2000}
              value={resource.id}
              onChange={(event) => update(index, { id: event.target.value })}
            />
            <Checkbox
              size="caption"
              label={t("Required")}
              checked={resource.required !== false}
              onChange={(event) => update(index, { required: event.target.checked })}
            />
            <Button
              type="button"
              variant="ghost"
              iconOnly
              label={t("Remove {p1}: {p2}", { p1: kind, p2: reference })}
              onClick={() => {
                setRowKeys(removeRequirementRowKey(rowKeys, requirements.length, index));
                onChange(requirements.filter((_, at) => at !== index));
              }}
            >
              <X aria-hidden className="icon-sm" />
            </Button>
          </div>
        );
      })}
      {error ? (
        <InlineError retry={retry ? { onRetry: retry } : undefined} details={error} />
      ) : null}
      {report?.items
        .filter((item) => item.state !== "ready" || item.detail)
        .map((item) => (
          <Text as="div" size="caption" tone="secondary" key={item.key} className="break-words">
            {catalogText(t, item.label)}
            {!item.required ? ` (${t("Optional")})` : ""}
            {item.detail
              ? ` · ${item.detail}`
              : ` · ${item.state === "blocked" ? t("Unavailable") : t("Not checked")}`}
          </Text>
        ))}
    </div>
  );
}
