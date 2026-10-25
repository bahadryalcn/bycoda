import { useEffect, useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Badge } from "../../../shared/ui/Badge";
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

type Props = {
  scope: TaskWorkflowScope;
  draft: TaskWorkflowDraft;
  onApply: (
    draft: TaskWorkflowDraft,
    profile?: Pick<TaskWorkflowProfile, "id" | "updatedAt">,
  ) => void | Promise<void>;
  preflight?: TaskPreflightReport;
  onCheck?: () => void | Promise<void>;
  busy?: boolean;
};

/** Profiles prepare a draft only. Applying or saving one never starts work or grants permissions. */
export function TaskWorkflowControls(props: Props) {
  return (
    <ScopedTaskWorkflowControls
      key={JSON.stringify([props.scope.machineId, props.scope.projectId])}
      {...props}
    />
  );
}

function ScopedTaskWorkflowControls({
  scope,
  draft,
  onApply,
  preflight,
  onCheck,
  busy = false,
}: Props) {
  useLocale();
  const [profiles, setProfiles] = useState<TaskWorkflowProfile[]>([]);
  const [selected, setSelected] = useState(BUILTIN_TASK_WORKFLOWS[0].id);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [activeOperation, setActiveOperation] = useState<string | null>(null);
  const working = activeOperation !== null;
  const operationGate = useRef(false);
  useEffect(() => {
    if (!scope.machineId || !scope.projectId) return;
    let current = true;
    queueMicrotask(() => {
      if (!current) return;
      try {
        setProfiles(loadTaskWorkflows(scope));
      } catch {
        setError(t("Saved workflows could not be read. Existing saved data was preserved."));
      }
    });
    return () => {
      current = false;
    };
  }, [scope.machineId, scope.projectId]);
  const all = [...BUILTIN_TASK_WORKFLOWS, ...profiles];
  const chosen = all.find((profile) => profile.id === selected);
  const custom = profiles.find((profile) => profile.id === selected);
  const blocked = busy || working;
  const run = async (key: string, operation: () => void | Promise<void>) => {
    if (blocked || operationGate.current) return;
    operationGate.current = true;
    setActiveOperation(key);
    setError("");
    setMessage("");
    try {
      await operation();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : t("The workflow could not be updated."),
      );
    } finally {
      operationGate.current = false;
      setActiveOperation(null);
    }
  };
  const requirements = draft.requirements ?? [];
  const updateRequirement = (index: number, patch: Partial<TaskPreflightRequirement>) =>
    onApply({
      ...draft,
      requirements: requirements.map((entry, at) =>
        at === index ? { ...entry, ...patch } : entry,
      ),
    });
  return (
    <details className="min-w-0 space-y-2 border-t border-(--ui-tone-neutral-border) pt-2">
      <summary className="cursor-pointer text-ui-caption font-medium">
        {t("Workflow and preparation")}
      </summary>
      <div className="min-w-0 space-y-3">
        <div className="flex min-w-0 flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <SearchableSelect
              label={t("Workflow")}
              value={selected}
              options={all.map((profile) => ({
                value: profile.id,
                label: profiles.includes(profile) ? profile.name : t(profile.name),
              }))}
              disabled={blocked}
              onChange={(value) => {
                setSelected(value);
                setName(profiles.find((profile) => profile.id === value)?.name ?? "");
                setMessage("");
              }}
            />
          </div>
          <Button
            disabled={blocked || !chosen}
            loading={activeOperation === "apply"}
            onClick={() =>
              void run("apply", async () => {
                if (chosen) await onApply(applyTaskWorkflow(chosen, draft), chosen);
                setMessage(t("Workflow applied to this draft."));
              })
            }
          >
            {t("Apply workflow")}
          </Button>
          <Button
            variant="ghost"
            disabled={blocked || !scope.machineId || !scope.projectId}
            loading={activeOperation === "refresh"}
            onClick={() =>
              void run("refresh", () => {
                let latest: TaskWorkflowProfile[];
                try {
                  latest = loadTaskWorkflows(scope);
                } catch {
                  throw new Error(
                    t("Saved workflows could not be read. Existing saved data was preserved."),
                  );
                }
                setProfiles(latest);
                if (
                  !BUILTIN_TASK_WORKFLOWS.some((profile) => profile.id === selected) &&
                  !latest.some((profile) => profile.id === selected)
                ) {
                  setSelected(BUILTIN_TASK_WORKFLOWS[0].id);
                  setName("");
                }
                setMessage(t("Workflows refreshed."));
              })
            }
          >
            {t("Refresh workflows")}
          </Button>
        </div>
        <p className="text-ui-micro text-(--ui-text-secondary)">
          {t(
            "Keeps your current objective. Applying a workflow does not start work or authorize publication.",
          )}
        </p>
        <div className="flex min-w-0 flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <TextField
              label={t("Workflow name")}
              value={name}
              disabled={blocked}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <Button
            disabled={blocked || !name.trim() || !scope.machineId || !scope.projectId}
            loading={activeOperation === "save"}
            onClick={() =>
              void run("save", () => {
                const now = Date.now();
                const createdAt = custom?.createdAt ?? now;
                const updatedAt = Math.max(now, createdAt, custom ? custom.updatedAt + 1 : now);
                if (
                  !Number.isSafeInteger(now) ||
                  now < 0 ||
                  !Number.isSafeInteger(updatedAt) ||
                  updatedAt > 8_640_000_000_000_000
                )
                  throw new Error(t("The workflow could not be updated."));
                const profile: TaskWorkflowProfile = {
                  schema: "bycoda.task-workflow.v1",
                  id: custom?.id ?? crypto.randomUUID(),
                  name: name.trim(),
                  draft,
                  createdAt,
                  updatedAt,
                };
                const latest = loadTaskWorkflows(scope);
                if (
                  custom &&
                  JSON.stringify(latest.find((entry) => entry.id === custom.id)) !==
                    JSON.stringify(custom)
                )
                  throw new Error(
                    t("This workflow changed in another window. Reopen it before saving."),
                  );
                const next = custom
                  ? latest.map((entry) => (entry.id === custom.id ? profile : entry))
                  : [...latest, profile];
                saveTaskWorkflows(scope, next);
                setProfiles(next);
                setSelected(profile.id);
                setMessage(t("Workflow saved for this project."));
              })
            }
          >
            {t("Save workflow")}
          </Button>
          {custom ? (
            <Button
              tone="danger"
              variant="ghost"
              disabled={blocked}
              loading={activeOperation === "remove"}
              onClick={() =>
                void run("remove", () => {
                  const latest = loadTaskWorkflows(scope);
                  if (
                    JSON.stringify(latest.find((entry) => entry.id === custom.id)) !==
                    JSON.stringify(custom)
                  )
                    throw new Error(
                      t("This workflow changed in another window. Reopen it before saving."),
                    );
                  const next = latest.filter((profile) => profile.id !== custom.id);
                  saveTaskWorkflows(scope, next);
                  setProfiles(next);
                  setSelected(BUILTIN_TASK_WORKFLOWS[0].id);
                  setName("");
                  setMessage(t("Saved workflow removed."));
                })
              }
            >
              {t("Remove workflow")}
            </Button>
          ) : null}
        </div>
        <details className="min-w-0 space-y-2">
          <summary className="cursor-pointer text-ui-caption">
            {t("Required resources")}
            {requirements.length ? ` · ${requirements.length}` : ""}
          </summary>
          {requirements.map((requirement, index) => (
            <div key={index} className="flex min-w-0 flex-wrap items-end gap-2">
              <SearchableSelect
                label={t("Resource type")}
                value={requirement.kind}
                searchable={false}
                disabled={blocked}
                options={[
                  { value: "source", label: t("Source") },
                  { value: "skill", label: t("Skill") },
                  { value: "connection", label: t("Connection") },
                  { value: "tool", label: t("Tool") },
                ]}
                onChange={(kind) =>
                  void updateRequirement(index, { kind: kind as TaskPreflightRequirement["kind"] })
                }
              />
              <div className="min-w-0 basis-full sm:basis-48 sm:flex-1">
                <TextField
                  label={t("Resource reference")}
                  value={requirement.id}
                  disabled={blocked}
                  maxLength={2000}
                  onChange={(event) => void updateRequirement(index, { id: event.target.value })}
                />
              </div>
              <label className="flex items-center gap-1 text-ui-caption">
                <Checkbox
                  checked={requirement.required !== false}
                  disabled={blocked}
                  onChange={(event) =>
                    void updateRequirement(index, { required: event.target.checked })
                  }
                />
                {t("Required")}
              </label>
              <Button
                variant="ghost"
                disabled={blocked}
                onClick={() =>
                  void onApply({
                    ...draft,
                    requirements: requirements.filter((_, at) => at !== index),
                  })
                }
              >
                {t("Remove resource")}
              </Button>
            </div>
          ))}
          <Button
            variant="ghost"
            disabled={blocked || requirements.length >= 40}
            onClick={() =>
              void onApply({
                ...draft,
                requirements: [...requirements, { kind: "source", id: "", required: true }],
              })
            }
          >
            {t("Add resource")}
          </Button>
        </details>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge
            tone={
              preflight?.state === "ready"
                ? "success"
                : preflight?.state === "blocked"
                  ? "danger"
                  : "warning"
            }
          >
            {preflight?.state === "ready"
              ? t("Ready")
              : preflight?.state === "blocked"
                ? t("Preparation blocked")
                : t("Preparation not verified")}
          </Badge>
          {onCheck ? (
            <Button
              disabled={blocked}
              loading={activeOperation === "check"}
              onClick={() => void run("check", onCheck)}
            >
              {t("Check preparation")}
            </Button>
          ) : null}
        </div>
        {preflight ? (
          <ul className="space-y-1 text-ui-micro">
            {preflight.items.map((item) => (
              <li key={item.key} className="min-w-0 break-words">
                <span className="font-medium">{t(item.label)}</span>
                {": "}
                {item.state === "ready"
                  ? t("Ready")
                  : item.state === "blocked"
                    ? t("Unavailable")
                    : t("Not checked")}
                {!item.required ? ` (${t("Optional")})` : ""}
                {item.detail ? ` · ${item.detail}` : ""}
              </li>
            ))}
          </ul>
        ) : null}
        {message ? (
          <p role="status" className="text-ui-micro text-(--ui-text-secondary)">
            {message}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="break-words text-ui-caption text-(--ui-tone-danger-fg)">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}
