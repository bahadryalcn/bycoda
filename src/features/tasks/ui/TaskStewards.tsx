import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Button } from "../../../shared/ui/Button";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Plus, Trash2 } from "../../../shared/ui/icons";
import { taskMatchesProject, type TaskProjectScope } from "../model/taskBoardScope";
import { HostModelSource } from "../../connections/public/HostModelSource";
import { t, useLocale } from "../../../shared/i18n";
import { type FormEvent, useMemo, useState } from "react";
import { backgroundMachineFor } from "../../automations/model/hostAutomationClient";
import type { RemoteMachine } from "../../connections";
import { isProjectLockedIn, type LockSnapshot } from "../../group-lock/public/lockState";
import { looksLikeProject, type RecentProject } from "../../projects/public/recents";
import {
  defaultSessionChoice,
  firstEnabledHarness,
  modelsFor,
  preferredModelId,
} from "../../sessions/public/models";
import {
  type BoardSteward,
  deleteSteward,
  draftFromSteward,
  newStewardDraft,
  runStewardNow,
  saveSteward,
  setStewardEnabled,
  type StewardDraft,
  stewardProjectName,
} from "../model/stewardClient";
import type { TaskBoardOperations } from "./useTaskBoardOperations";
import { machineName } from "./TaskFormFields";
import { StewardForm } from "./TaskStewardForm";
import { StewardRow } from "./TaskStewardRow";
import "./task-ops.css";

/** The stewards above the board: one row per project with its schedule and
 * last run, and the form that adds or edits one. */
function StewardsPanel({
  stewards,
  draft,
  recents,
  machine,
  saving,
  error,
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
  /** Why the last save of the open draft failed. */
  error: string | null;
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
      {...surfaceAttributes(
        { frame: "pane", edge: "block-end" },
        `task-ops-panel ${draft ? "max-h-[80%]" : "max-h-[45%]"}`,
      )}
    >
      <div className="task-ops-head">
        <div className="task-ops-head-text">
          <SectionLabel count={stewards.length}>{t("Stewards")}</SectionLabel>
          <Text
            as="p"
            size="caption"
            tone="secondary"
            leading="inherit"
            className="task-ops-caption"
          >
            {t(
              "A steward reads its project on a schedule and suggests the next work as To do items. Nothing runs until you start it.",
            )}
          </Text>
        </div>
        <Button
          variant="secondary"
          type="button"
          onClick={onAdd}
          disabled={draft != null}
          startIcon={<Plus className="icon-sm" strokeWidth={1.75} />}
        >
          {t("Add steward")}
        </Button>
      </div>
      {draft ? (
        <StewardForm
          draft={draft}
          recents={recents}
          machine={machine}
          saving={saving}
          error={error}
          onChange={onChange}
          onCancel={onCancel}
          onSubmit={onSubmit}
        />
      ) : null}
      {stewards.length > 0 ? (
        <ul aria-label={t("Steward list")} className="task-ops-frame">
          {stewards.map((steward) => {
            const key = `${steward.machineId}:${steward.id}`;
            return (
              <li key={key}>
                <StewardRow
                  steward={steward}
                  acting={acting}
                  now={now}
                  menuOpen={menu?.key === key}
                  onToggle={onToggle}
                  onRunNow={onRunNow}
                  onEdit={onEdit}
                  onOpenMenu={(target, anchor) =>
                    setMenu({ key: `${target.machineId}:${target.id}`, anchor })
                  }
                />
              </li>
            );
          })}
        </ul>
      ) : !draft ? (
        <ul aria-label={t("Steward list")}>
          <li>
            <EmptyState size="inline" description={t("No stewards yet.")} />
          </li>
        </ul>
      ) : null}
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
  const [saveError, setSaveError] = useState<string | null>(null);
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
    setSaveError(null);
    setDraft(newStewardDraft(project, harness, model));
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      putSteward(await saveSteward(capable, draft));
      setDraft(null);
      setError(null);
      void refresh();
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      setSaveError(message);
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
    saveError,
    open,
    toggle: () => setOpen((value) => !value),
    begin,
    save,
    actOn,
    remove,
    startEditing: (steward: BoardSteward) => {
      if (saving) return;
      setError(null);
      setSaveError(null);
      setDraft(draftFromSteward(steward));
    },
    change: (next: StewardDraft) => {
      if (!saving) setDraft(next);
    },
    cancel: () => {
      if (saving) return;
      setSaveError(null);
      setDraft(null);
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
        error={stewards.saveError}
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
