import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { Badge } from "../../../shared/ui/Badge";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Switch } from "../../../shared/ui/Switch";
import { NumberField } from "../../../shared/ui/NumberField";
import { projectDisplayName } from "../../projects/model/projectNames";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { taskMatchesProject, type TaskProjectScope } from "../model/taskBoardScope";
import { HostModelSource } from "../../connections/ui/HostModelSource";
import { formatTaskSpan, TASK_MACHINE_ERROR } from "../model/taskClient";
import { t, useLocale } from "../../../shared/i18n";
import { type FormEvent, useMemo, useState } from "react";
import { AccessPicker } from "../../sessions/ui/AccessPicker";
import {
  Bot,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "../../../shared/ui/icons";
import {
  AUTOMATION_WEEKDAYS,
  automationScheduleLabel,
  nextRunPreview,
} from "../../automations/model/automations";
import { ModelPicker } from "../../sessions/ui/ModelPicker";
import { SearchableProjectPicker } from "../../projects/ui/SearchableProjectPicker";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { backgroundMachineFor } from "../../automations/model/hostAutomationClient";
import type { RemoteMachine } from "../../connections/model/protocol";
import { isProjectLockedIn, type LockSnapshot } from "../../group-lock/model/lockState";
import { looksLikeProject, type RecentProject } from "../../projects/model/recents";
import {
  defaultSessionChoice,
  firstEnabledHarness,
  modelsFor,
  preferredModelId,
} from "../../sessions/model/models";
import { MAX_OPEN_LIMIT, MAX_PROPOSALS_LIMIT } from "../model/hostStewards";
import {
  type BoardSteward,
  deleteSteward,
  draftFromSteward,
  newStewardDraft,
  runStewardNow,
  saveSteward,
  setStewardEnabled,
  STEWARD_STATUS_LABELS,
  type StewardDraft,
  stewardProjectName,
} from "../model/stewardClient";
import type { TaskBoardOperations } from "./useTaskBoardOperations";
import { AutoMergeField, machineName } from "./TaskFormFields";

function scheduleOf(draft: StewardDraft) {
  return {
    scheduleKind: draft.scheduleKind,
    minute: draft.minute,
    time: draft.time,
    dayOfWeek: draft.dayOfWeek,
  };
}

const SCHEDULE_OPTIONS = [
  {
    value: "hourly",
    get label() {
      return t("Hourly");
    },
  },
  {
    value: "daily",
    get label() {
      return t("Daily");
    },
  },
  {
    value: "weekdays",
    get label() {
      return t("Weekdays");
    },
  },
  {
    value: "weekly",
    get label() {
      return t("Weekly");
    },
  },
] as const;

/** The stewards above the board: one row per project with its schedule and
 * last run, and the form that adds or edits one. */
function StewardsPanel({
  stewards,
  draft,
  recents,
  machine,
  saving,
  acting,
  now,
  onAdd,
  onEdit,
  onChange,
  onCancel,
  onSubmit,
  onToggle,
  onRunNow,
  onDelete,
}: {
  stewards: readonly BoardSteward[];
  draft: StewardDraft | null;
  recents: RecentProject[];
  /** The machine that would run the draft's steward, when it is connected. */
  machine?: string;
  saving: boolean;
  acting: string | null;
  now: number;
  onAdd: () => void;
  onEdit: (steward: BoardSteward) => void;
  onChange: (draft: StewardDraft) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent) => void;
  onToggle: (steward: BoardSteward) => void;
  onRunNow: (steward: BoardSteward) => void;
  onDelete: (steward: BoardSteward) => void;
}) {
  useLocale();
  const [menu, setMenu] = useState<{ key: string; anchor: HTMLButtonElement } | null>(null);
  const menuSteward = menu
    ? stewards.find((steward) => `${steward.machineId}:${steward.id}` === menu.key)
    : undefined;
  const menuBusy = !menuSteward || acting != null;
  return (
    <section
      aria-label={t("Stewards")}
      className="flex max-h-[45%] shrink-0 flex-col gap-1.5 overflow-y-auto border-b border-(--ui-tone-neutral-border) p-3"
    >
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-ui-caption text-(--ui-text-secondary)">
          {t(
            "A steward reads its project on a schedule and suggests the next work as To do items. Nothing runs until you start it.",
          )}
        </p>
        <Button variant="secondary" type="button" onClick={onAdd} disabled={draft != null}>
          <Plus className="icon-sm" strokeWidth={1.75} />
          {t("Add steward")}
        </Button>
      </div>
      {draft ? (
        <StewardForm
          draft={draft}
          recents={recents}
          machine={machine}
          saving={saving}
          onChange={onChange}
          onCancel={onCancel}
          onSubmit={onSubmit}
        />
      ) : null}
      <ul aria-label={t("Steward list")} className="flex flex-col gap-1.5">
        {stewards.map((steward) => {
          const busy = acting != null;
          const pending = acting === `steward:${steward.machineId}:${steward.id}`;
          const running = steward.run != null;
          return (
            <li key={`${steward.machineId}:${steward.id}`}>
              <article
                aria-label={t("Steward for {p0}", { p0: stewardProjectName(steward) })}
                data-steward-status={steward.lastRunStatus}
                aria-busy={pending || undefined}
                className="rounded-(--ui-radius-card) border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised) px-3 py-2"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Bot className="icon-sm shrink-0 text-(--ui-text-secondary)" />
                  <h3
                    title={steward.focus || undefined}
                    className="min-w-0 truncate text-ui-secondary font-medium text-(--ui-tone-neutral-fg)"
                  >
                    {stewardProjectName(steward)}
                  </h3>
                  <span className="min-w-0 truncate text-ui-micro text-(--ui-text-secondary)">
                    {t("on ")}
                    {steward.machineName}
                    {steward.stale ? t(" (offline, last known)") : ""} ·{" "}
                    {automationScheduleLabel(steward)}
                  </span>
                  <div className="ml-auto flex flex-wrap items-center gap-0.5">
                    {pending ? (
                      <LoaderCircle className="mx-1.5 icon-xs animate-spin text-(--ui-text-secondary)" />
                    ) : null}
                    <span className="flex items-center gap-1.5 px-1.5 text-ui-micro text-(--ui-text-secondary)">
                      <Switch
                        aria-label={t("Enabled")}
                        title={t("Enabled")}
                        checked={steward.enabled}
                        disabled={busy}
                        onCheckedChange={() => onToggle(steward)}
                      />
                      {t("Enabled")}
                    </span>
                    <Button
                      variant="ghost"

                      disabled={busy || running}
                      onClick={() => onRunNow(steward)}
                    >
                      <Play className="icon-xs" />
                      {t("Run now")}
                    </Button>
                    <Button variant="ghost" disabled={busy} onClick={() => onEdit(steward)}>
                      <Pencil className="icon-xs" />
                      {t("Edit")}
                    </Button>
                    <Button
                      variant="ghost"
                      iconOnly
                      label={t("More actions")}
                      disabled={busy}
                      aria-haspopup="menu"
                      aria-expanded={menu?.key === `${steward.machineId}:${steward.id}`}
                      onClick={(event) =>
                        setMenu({
                          key: `${steward.machineId}:${steward.id}`,
                          anchor: event.currentTarget,
                        })
                      }
                    >
                      <MoreHorizontal className="icon-sm" />
                    </Button>
                  </div>
                </div>
                <p className="mt-1 flex min-w-0 flex-wrap items-center gap-1 break-words text-ui-micro leading-snug text-(--ui-text-secondary)">
                  {steward.lastRunStatus ? (
                    <>
                      {t("Last run: ")}
                      <Badge
                        tone={
                          steward.lastRunStatus === "failed"
                            ? "danger"
                            : steward.lastRunStatus === "succeeded"
                              ? "success"
                              : steward.lastRunStatus === "running"
                                ? "info"
                                : "neutral"
                        }
                      >
                        {t(STEWARD_STATUS_LABELS[steward.lastRunStatus])}
                      </Badge>
                      {steward.lastRunAt
                        ? t(" {p0} ago", { p0: formatTaskSpan(now - steward.lastRunAt) })
                        : ""}
                      {steward.lastRunStatus === "succeeded" && steward.lastProposed !== undefined
                        ? t(
                            steward.lastProposed === 1
                              ? " · {p0} new suggestion"
                              : " · {p0} new suggestions",
                            { p0: steward.lastProposed },
                          )
                        : ""}
                    </>
                  ) : (
                    t("Has not run yet")
                  )}
                  {steward.enabled ? ` · ${nextRunPreview(steward.nextRunAt)}` : t(" · Paused")}
                </p>
                {steward.lastRunError &&
                (steward.lastRunStatus === "failed" || steward.lastRunStatus === "skipped") ? (
                  <p
                    className={`mt-0.5 break-words text-ui-micro leading-snug ${
                      steward.lastRunStatus === "failed"
                        ? "text-(--ui-tone-danger-fg)"
                        : "text-(--ui-text-secondary)"
                    }`}
                  >
                    {steward.lastRunError}
                  </p>
                ) : null}
              </article>
            </li>
          );
        })}
        {stewards.length === 0 && !draft ? (
          <li>
            <EmptyState description={t("No stewards yet.")} />
          </li>
        ) : null}
      </ul>
      {menu && menuSteward ? (
        <DropdownMenu
          anchor={menu.anchor}
          label={t("More actions")}
          items={[
            {
              kind: "item",
              id: "delete",
              label: t("Delete"),
              danger: true,
              disabled: menuBusy,
              icon: <Trash2 className="icon-xs" />,
            },
          ]}
          onClose={() => setMenu(null)}
          onPick={() => {
            if (!menuBusy) onDelete(menuSteward);
          }}
        />
      ) : null}
    </section>
  );
}

/** The steward form: the project, what to look for, when to look, and the
 * agent that does it. */
function StewardForm({
  draft,
  recents,
  machine,
  saving,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: StewardDraft;
  recents: RecentProject[];
  machine?: string;
  saving: boolean;
  onChange: (draft: StewardDraft) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  useLocale();
  const update = <K extends keyof StewardDraft>(key: K, value: StewardDraft[K]) =>
    onChange({ ...draft, [key]: value });
  const valid = looksLikeProject(draft.cwd) && draft.model.length > 0 && machine != null;
  const number = (
    label: string,
    value: number,
    max: number,
    key: "maxProposals" | "maxOpen" | "minute",
    min = 1,
  ) => (
    <label className="flex items-center gap-2">
      <span className="shrink-0">{label}</span>
      <NumberField
        hideLabel
        label=""

        aria-label={label}
        min={min}
        max={max}
        value={value}
        onChange={(event) => {
          const next = Math.trunc(Number(event.target.value));
          if (Number.isFinite(next)) update(key, Math.min(max, Math.max(min, next)));
        }}
        fieldClassName="w-16 max-w-16"
      />
    </label>
  );
  return (
    <form
      aria-label={draft.id ? t("Edit steward") : t("New steward")}
      aria-busy={saving}
      onSubmit={onSubmit}
      className="task-form rounded-(--ui-radius-card) border border-(--ui-tone-neutral-border) bg-(--ui-surface)"
    >
      <div className="task-form-body">
        <fieldset disabled={saving} inert={saving} className="task-form-fields">
          <div className="task-form-context">
            {draft.id ? (
              // A steward stays with the project it was created for.
              <span className="truncate">{projectDisplayName(draft.cwd)}</span>
            ) : (
              <SearchableProjectPicker
                cwd={draft.cwd}
                recents={recents}
                onSelectProject={(cwd) => update("cwd", cwd)}
              />
            )}
            <span aria-hidden className="h-3 w-px shrink-0 bg-(--ui-tone-neutral-border)" />
            {machine ? (
              <span className="truncate">
                {t("Runs on ")}
                {machine}
              </span>
            ) : (
              <span role="alert" className="text-(--ui-tone-warning-fg)">
                {TASK_MACHINE_ERROR}
              </span>
            )}
          </div>
          <TextareaField
            hideLabel
            label=""
            aria-label={t("Focus")}
            value={draft.focus}
            onChange={(event) => update("focus", event.target.value)}
            placeholder={t(
              "What should it look for? e.g. follow docs/ROADMAP.md, or find bugs and missing tests",
            )}
            rows={2}
            fieldClassName="block w-full"
            className="resize-y"
          />
          <div className="task-form-context">
            <span className="shrink-0">{t("Look")}</span>
            <SearchableSelect
              variant="pill"
              searchable={false}
              label={t("Schedule")}
              value={draft.scheduleKind}
              options={SCHEDULE_OPTIONS}
              onChange={(value) => update("scheduleKind", value as StewardDraft["scheduleKind"])}
            />
            {draft.scheduleKind === "weekly" ? (
              <SearchableSelect
                variant="pill"
                searchable={false}
                label={t("Day of week")}
                value={String(draft.dayOfWeek)}
                options={AUTOMATION_WEEKDAYS.map((day, index) => ({
                  value: String(index),
                  label: day,
                }))}
                onChange={(value) => update("dayOfWeek", Number(value))}
              />
            ) : null}
            {draft.scheduleKind === "hourly" ? (
              number("Minute", draft.minute, 59, "minute", 0)
            ) : (
              <TextField
                hideLabel
                label=""
                type="time"
                aria-label={t("Time")}
                value={draft.time}
                onChange={(event) => {
                  if (event.target.value) update("time", event.target.value);
                }}
              />
            )}
            <span className="text-ui-micro text-(--ui-text-secondary)">
              {automationScheduleLabel(scheduleOf(draft))}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <ModelPicker
              harness={draft.harness}
              model={draft.model}
              values={draft.modelSettings}
              project={draft.cwd}
              onChange={(harness, model) => onChange({ ...draft, harness, model })}
              onSettingsChange={(modelSettings) => update("modelSettings", modelSettings)}
            />
            {draft.harness !== "fx" ? (
              <AccessPicker
                value={draft.runtimeMode}
                onChange={(runtimeMode) => update("runtimeMode", runtimeMode)}
              />
            ) : null}
          </div>
          <div className="task-form-checks">
            {number(
              "Max suggestions per run",
              draft.maxProposals,
              MAX_PROPOSALS_LIMIT,
              "maxProposals",
            )}
            {number("Pause at open suggestions", draft.maxOpen, MAX_OPEN_LIMIT, "maxOpen")}
            <label className="flex cursor-pointer items-center gap-1.5">
              <Checkbox
                checked={draft.autoStart}
                onChange={(event) => update("autoStart", event.target.checked)}
              />
              {t("Start suggestions automatically")}
            </label>
            <AutoMergeField
              checked={draft.autoMerge}
              onChange={(checked) => update("autoMerge", checked)}
            />
            {draft.autoStart ? (
              <span role="status" className="text-ui-micro text-(--ui-tone-warning-fg)">
                {t("Suggestions will run without you reviewing the idea first.")}
                {t(" Each still waits for your review before it is merged.")}
              </span>
            ) : null}
          </div>
        </fieldset>
      </div>
      <div className="task-form-footer">
        <Button variant="ghost" type="button" disabled={saving} onClick={onCancel}>
          {t("Cancel")}
        </Button>
        <Button variant="primary" type="submit" loading={saving} disabled={!valid || saving}>
          {t("Save")}
        </Button>
      </div>
    </form>
  );
}

type StewardScope = {
  cwd?: string;
  recents: RecentProject[];
  projectFilter: string;
  lock: LockSnapshot;
  machines: RemoteMachine[];
  selectedProject?: TaskProjectScope;
};

/** Steward drafts and actions. The stewards themselves are the board query's;
 * this keeps the open panel and the form being edited, and puts every
 * host-confirmed steward back into that query. */
export function useTaskStewards({
  ops,
  scope,
  stored,
  capable,
  putSteward,
  removeSteward,
}: {
  ops: TaskBoardOperations;
  scope: StewardScope;
  stored: BoardSteward[];
  capable: RemoteMachine[];
  putSteward: (saved: BoardSteward) => void;
  removeSteward: (removed: BoardSteward) => void;
}) {
  const { saving, setSaving, setError, refresh, act, confirm } = ops;
  const { cwd, recents, projectFilter, lock, machines, selectedProject } = scope;
  const [draft, setDraft] = useState<StewardDraft | null>(null);
  const [open, setOpen] = useState(false);
  const stewards = useMemo(
    () =>
      stored.filter(
        (steward) =>
          !isProjectLockedIn(lock, steward.cwd) &&
          taskMatchesProject(steward, projectFilter, machines),
      ),
    [lock, stored, projectFilter, machines],
  );

  const begin = () => {
    const project =
      selectedProject?.cwd ?? (cwd && looksLikeProject(cwd) ? cwd : (recents[0]?.path ?? "~"));
    const preferred = defaultSessionChoice(project);
    const harness = firstEnabledHarness(project, preferred.harness);
    const model =
      (preferred.harness === harness ? preferred.model : undefined) ??
      modelsFor(harness)[0]?.id ??
      preferredModelId(harness);
    setError(null);
    setDraft(newStewardDraft(project, harness, model));
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !draft) return;
    setSaving(true);
    try {
      putSteward(await saveSteward(capable, draft));
      setDraft(null);
      setError(null);
      void refresh();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const actOn = (steward: BoardSteward, action: () => Promise<BoardSteward>) =>
    act({ id: `steward:${steward.machineId}:${steward.id}` }, action, putSteward);

  const remove = async (steward: BoardSteward) => {
    if (
      !(await confirm({
        title: t("Delete steward"),
        message: t("Delete the steward for {p0}? Its suggestions stay on the board.", {
          p0: stewardProjectName(steward),
        }),
        confirmLabel: t("Delete"),
      }))
    )
      return;
    void act(
      { id: `steward:${steward.machineId}:${steward.id}` },
      () => deleteSteward(steward),
      () => removeSteward(steward),
    );
  };

  return {
    stewards,
    draft,
    open,
    toggle: () => setOpen((value) => !value),
    begin,
    save,
    actOn,
    remove,
    startEditing: (steward: BoardSteward) => {
      if (saving) return;
      setError(null);
      setDraft(draftFromSteward(steward));
    },
    change: (next: StewardDraft) => {
      if (!saving) setDraft(next);
    },
    cancel: () => {
      if (!saving) setDraft(null);
    },
  };
}

export type TaskStewardsController = ReturnType<typeof useTaskStewards>;

/** The stewards panel, with the model options of the host the draft would use. */
export function StewardsSection({
  stewards,
  capable,
  recents,
  saving,
  acting,
  now,
}: {
  stewards: TaskStewardsController;
  capable: RemoteMachine[];
  recents: RecentProject[];
  saving: boolean;
  acting: string | null;
  now: number;
}) {
  if (!stewards.open || capable.length === 0) return null;
  const draft = stewards.draft;
  return (
    <HostModelSource
      machine={draft ? backgroundMachineFor(capable, draft.cwd) : undefined}
      cwd={draft?.cwd ?? "~"}
      model={draft?.model ?? ""}
      values={draft?.modelSettings ?? {}}
    >
      <StewardsPanel
        stewards={stewards.stewards}
        draft={draft}
        recents={recents}
        machine={draft ? machineName(capable, draft.cwd) : undefined}
        saving={saving}
        acting={acting}
        now={now}
        onAdd={stewards.begin}
        onEdit={stewards.startEditing}
        onChange={stewards.change}
        onCancel={stewards.cancel}
        onSubmit={stewards.save}
        onToggle={(steward) =>
          void stewards.actOn(steward, () => setStewardEnabled(steward, !steward.enabled))
        }
        onRunNow={(steward) => void stewards.actOn(steward, () => runStewardNow(steward))}
        onDelete={stewards.remove}
      />
    </HostModelSource>
  );
}
