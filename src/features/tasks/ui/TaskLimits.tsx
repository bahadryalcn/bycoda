import { NumberField } from "../../../shared/ui/NumberField";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { useRef, useState } from "react";
import { LoaderCircle } from "../../../shared/ui/icons";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import type { RemoteMachine } from "../../connections/model/protocol";
import {
  DAILY_LIMIT_CHOICES,
  formatAgentMinutes,
  type HostSettings,
  MAX_RUNNING_TASKS_LIMIT,
} from "../model/hostSettings";
import { type MachineLimits, saveMachineLimits } from "../model/settingsClient";

const DAILY_LIMIT_LABELS: Record<number, string> = {
  0: "No limit",
  60: "1 hour",
  120: "2 hours",
  240: "4 hours",
  480: "8 hours",
  720: "12 hours",
};

/** Saves limits on the machine named; true once its host acknowledged them. */
export type SaveLimits = (
  machineId: string,
  settings: Partial<HostSettings>,
) => void | boolean | Promise<void | boolean>;

/** An unsaved hours edit, with the machine value it started from. `saved` is set
 * once the machine acknowledged it, until the refreshed limits catch up. */
type HoursDraft = { hours: string; baseline: number; saved: boolean };

/** Daily hours for one machine. The input shows the machine's own value until the
 * owner edits it; an edit keeps the baseline it began from, so a refreshed value
 * is reported next to the draft instead of replacing it. Parent keys this by
 * machine, so a draft never moves to another machine. */
export function CustomDailyLimit({
  entry,
  onChange,
}: {
  entry: MachineLimits;
  onChange: SaveLimits;
}) {
  useLocale();
  const [draft, setDraft] = useState<HoursDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const current = entry.dailyAgentMinutes;
  const hours = draft?.hours ?? String(current / 60);
  const minutes = Math.round(Number(hours) * 60);
  const valid = hours.trim() !== "" && Number(hours) >= 0 && Number.isSafeInteger(minutes);
  // Rebase on the machine's answer, adjusted during render: once a save was
  // acknowledged and the refreshed limits arrived, they are the input's value.
  if (draft?.saved && (current !== draft.baseline || (valid && minutes === current)))
    setDraft(null);
  const dirty = draft !== null && !draft.saved && !(valid && minutes === current);
  const changedElsewhere = draft !== null && dirty && draft.baseline !== current;
  return (
    <form
      aria-label={t("Custom daily agent time on {p0}", { p0: entry.machineName })}
      className="flex flex-wrap items-center gap-2"
      aria-busy={saving}
      onSubmit={async (event) => {
        event.preventDefault();
        if (!valid || saving || submitting.current) return;
        submitting.current = true;
        setSaving(true);
        try {
          const saved = await onChange(entry.machineId, { dailyAgentMinutes: minutes });
          if (saved !== false) setDraft((open) => (open ? { ...open, saved: true } : open));
        } finally {
          submitting.current = false;
          setSaving(false);
        }
      }}
    >
      <label className="flex items-center gap-2">
        {t("Hours")}
        <NumberField
          hideLabel
          label=""

          min="0"
          step="any"
          aria-label={t("Daily agent hours on {p0}", { p0: entry.machineName })}
          value={hours}
          disabled={saving}
          onChange={(event) => {
            if (saving) return;
            const next = event.target.value;
            setDraft((open) => ({
              hours: next,
              baseline: open && !open.saved ? open.baseline : current,
              saved: false,
            }));
          }}
          fieldClassName="w-24 max-w-24"
        />
      </label>
      <Button variant="secondary" type="submit" loading={saving} disabled={!valid || saving}>
        {t("Save")}
      </Button>
      {dirty ? (
        <Button variant="ghost" type="button" disabled={saving} onClick={() => setDraft(null)}>
          {t(changedElsewhere ? "Use machine value" : "Reset")}
        </Button>
      ) : null}
      <span className="text-ui-micro text-(--ui-text-secondary)">{t("0 = no limit")}</span>
      {changedElsewhere ? (
        <span role="status" className="text-ui-micro text-(--ui-tone-warning-fg)">
          {t("Now {p0} h on this machine. Your edit is kept.", { p0: String(current / 60) })}
        </span>
      ) : null}
    </form>
  );
}

export function MachineConcurrency({
  machineId,
  limits,
  onChange,
}: {
  machineId: string;
  limits: readonly MachineLimits[];
  onChange: (machineId: string, settings: Partial<HostSettings>) => void;
}) {
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const limit = limits.find((entry) => entry.machineId === machineId);
  if (!limit) return null;
  // A machine setting, not part of the task: it saves as soon as it changes.
  return (
    <section className="task-form-limit" aria-busy={saving}>
      <label className="task-form-limit-row">
        <span className="font-medium">{t("Machine task limit")}</span>
        <SearchableSelect
          label={t("Machine task limit")}
          value={String(limit.maxRunningTasks)}
          searchable={false}
          options={Array.from({ length: MAX_RUNNING_TASKS_LIMIT }, (_, index) => ({
            value: String(index + 1),
            label: String(index + 1),
          }))}
          disabled={saving}
          onChange={async (value) => {
            if (pending.current) return;
            pending.current = true;
            setSaving(true);
            try {
              await onChange(machineId, { maxRunningTasks: Number(value) });
            } finally {
              pending.current = false;
              setSaving(false);
            }
          }}
        />
        {saving ? <LoaderCircle className="icon-sm animate-spin" aria-hidden="true" /> : null}
      </label>
      <p>
        {t("Applies to all goals and tasks on this machine.")}{" "}
        {t("Saved immediately for {p0}; it is not part of this task.", {
          p0: limit.machineName,
        })}
      </p>
    </section>
  );
}

/** Each machine's work limits: how many tasks run at once, how much agent time
 * a day may use, and how much of today's is gone. */
export function LimitsPanel({
  limits,
  onChange,
}: {
  limits: readonly MachineLimits[];
  onChange: SaveLimits;
}) {
  useLocale();
  const [savingMachine, setSavingMachine] = useState<string | null>(null);
  const pending = useRef(false);
  const save = async (machineId: string, settings: Partial<HostSettings>) => {
    if (pending.current) return;
    pending.current = true;
    setSavingMachine(machineId);
    try {
      await onChange(machineId, settings);
    } finally {
      pending.current = false;
      setSavingMachine(null);
    }
  };
  // A limit set some other way stays selectable.
  const choices = (current: number) =>
    [...new Set([...DAILY_LIMIT_CHOICES, current])]
      .sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : a - b))
      .map((minutes) => ({
        value: String(minutes),
        label: DAILY_LIMIT_LABELS[minutes] ?? formatAgentMinutes(minutes),
      }));
  return (
    <ul
      aria-label={t("Work limits")}
      className="flex shrink-0 flex-col gap-2 border-b border-(--ui-tone-neutral-border) p-3"
    >
      {limits.map((entry) => (
        <li
          key={entry.machineId}
          aria-busy={savingMachine === entry.machineId}
          className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-ui-caption text-(--ui-text-secondary)"
        >
          <span className="min-w-24 font-medium text-(--ui-text-secondary)">
            {entry.machineName}
            {savingMachine === entry.machineId ? (
              <LoaderCircle className="ml-1 inline icon-xs animate-spin" aria-hidden="true" />
            ) : null}
          </span>
          <span className="flex items-center gap-2">
            {t("Max concurrent tasks")}
            <SearchableSelect
              variant="pill"
              searchable={false}
              label={t("Max concurrent tasks on {p0}", { p0: entry.machineName })}
              value={String(entry.maxRunningTasks)}
              options={Array.from({ length: MAX_RUNNING_TASKS_LIMIT }, (_, i) => ({
                value: String(i + 1),
                label: String(i + 1),
              }))}
              disabled={savingMachine !== null}
              onChange={(value) => save(entry.machineId, { maxRunningTasks: Number(value) })}
            />
          </span>
          <span className="flex items-center gap-2">
            {t("Daily agent time")}
            <SearchableSelect
              variant="pill"
              searchable={false}
              label={t("Daily agent time on {p0}", { p0: entry.machineName })}
              value={String(entry.dailyAgentMinutes)}
              options={choices(entry.dailyAgentMinutes)}
              disabled={savingMachine !== null}
              onChange={(value) => save(entry.machineId, { dailyAgentMinutes: Number(value) })}
            />
          </span>
          <CustomDailyLimit key={entry.machineId} entry={entry} onChange={onChange} />
          <span className="tabular-nums text-(--ui-text-secondary)">
            {t("Used today: ")}
            {formatAgentMinutes(entry.usedMinutes)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The save handler for machine limits. The machine a request names must still be
 * one the board knows; its acknowledged state goes into the board query, which
 * owns the displayed limits. Resolves true only when the host acknowledged. */
export function useMachineLimitSave(
  machines: readonly RemoteMachine[],
  putLimits: (saved: MachineLimits) => void,
  onResult: (error: string | null) => void,
): SaveLimits {
  return useStableCallback(async (machineId: string, settings: Partial<HostSettings>) => {
    const machine = machines.find((entry) => entry.id === machineId);
    if (!machine) return false;
    try {
      putLimits(await saveMachineLimits(machine, settings));
      onResult(null);
      return true;
    } catch (reason: unknown) {
      onResult(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  });
}
