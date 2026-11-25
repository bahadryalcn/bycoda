import { useEffect, useRef, useState, type Ref } from "react";
import { useFormat, useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Popover } from "../../../shared/ui/Popover";
import { Text } from "../../../shared/ui/Text";
import { Gauge } from "../../../shared/ui/icons";
import { DAILY_SUMMARY_OPEN_EVENT, takeSummaryPanelRequest } from "../model/dailySummaryClient";
import { formatAgentMinutes } from "../model/hostSettings";
import type { MachineLimits } from "../model/settingsClient";
import type { BoardTask } from "../model/taskClient";
import { TASK_GROUPS, taskGroupLabel } from "../model/taskGroups";
import { matchesTaskCount, type TaskCountFilter } from "./TasksViewFilter";

const countFilters = [
  ...TASK_GROUPS.filter((group) => group !== "done" && group !== "blocked"),
  "blocked",
  "doneToday",
] satisfies TaskCountFilter[];

/** Both live and pending notification requests reveal the counts. */
export function useTaskCountsRequest(onOpen: () => void) {
  // The notification can be clicked before Tasks is mounted.
  useEffect(() => {
    const openRequested = () => {
      if (takeSummaryPanelRequest()) onOpen();
    };
    openRequested();
    window.addEventListener(DAILY_SUMMARY_OPEN_EVENT, openRequested);
    return () => window.removeEventListener(DAILY_SUMMARY_OPEN_EVENT, openRequested);
  }, [onOpen]);
}

export function TaskCountChips({
  tasks,
  now,
  selected,
  onSelect,
  incomplete,
  limits,
  missingUsage,
  focusRef,
}: {
  tasks: readonly BoardTask[];
  now: number;
  selected: TaskCountFilter | null;
  onSelect: (filter: TaskCountFilter) => void;
  incomplete: boolean;
  limits: readonly MachineLimits[];
  missingUsage: readonly string[];
  focusRef: Ref<HTMLElement>;
}) {
  const t = useT();
  const { formatNumber } = useFormat();
  const chip = (filter: TaskCountFilter) => {
    const count = tasks.filter((task) => matchesTaskCount(task, filter, now)).length;
    // A zero count is noise: the chip stays only while it is the active filter.
    if (!count && filter !== selected) return null;
    const label =
      filter === "doneToday"
        ? t("Done today")
        : filter === "suggestions"
          ? t("New suggestions")
          : taskGroupLabel(filter);
    const amount = formatNumber(count);
    return (
      <Button
        key={filter}
        variant="chip"
        size="sm"
        pressed={filter === selected}
        trailing={amount}
        aria-label={`${label} · ${amount}`}
        onClick={() => onSelect(filter)}
      >
        {label}
      </Button>
    );
  };
  return (
    <section
      ref={focusRef}
      tabIndex={-1}
      aria-label={t("Task counts")}
      className="task-count-chips"
    >
      {countFilters.map(chip)}
      <TaskAgentTime limits={limits} missingUsage={missingUsage} />
      {chip("suggestions")}
      {incomplete ? (
        <Text size="caption" tone="secondary">
          {t("Task counts may be incomplete.")}
        </Text>
      ) : null}
    </section>
  );
}

function TaskAgentTime({
  limits,
  missingUsage,
}: {
  limits: readonly MachineLimits[];
  missingUsage: readonly string[];
}) {
  const t = useT();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const current = limits.filter((entry) => !entry.stale);
  const minutes = current.reduce((sum, entry) => sum + entry.usedMinutes, 0);
  const partial = Boolean(missingUsage.length || limits.some((entry) => entry.stale));
  const amount = current.length
    ? partial
      ? t("{p0} (incomplete)", { p0: formatAgentMinutes(minutes) })
      : formatAgentMinutes(minutes)
    : t("Unavailable");
  const label = t("Agent time today");
  // Nothing measured and nothing missing: no chip until there is time to show.
  if (current.length && !minutes && !partial) return null;
  return (
    <>
      <Button
        ref={trigger}
        variant="chip"
        size="sm"
        startIcon={<Gauge className="icon-sm" />}
        trailing={amount}
        aria-label={`${label} · ${amount}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </Button>
      {open ? (
        <Popover
          anchor={trigger}
          kind="dialog"
          aria-label={label}
          width={320}
          flow="scroll"
          variant="panel"
          onDismiss={() => setOpen(false)}
        >
          <ul className="task-usage-list">
            {limits.map((entry) => (
              <li key={entry.machineId}>
                <Text as="span" wrap="anywhere">
                  {entry.machineName}
                </Text>
                <Text as="span" tone="secondary" size="caption">
                  {entry.stale ? t("Unavailable") : formatAgentMinutes(entry.usedMinutes)}
                </Text>
              </li>
            ))}
            {missingUsage.map((name) => (
              <li key={name}>
                <Text as="span" wrap="anywhere">
                  {name}
                </Text>
                <Text as="span" tone="secondary" size="caption">
                  {t("Unavailable")}
                </Text>
              </li>
            ))}
          </ul>
          {limits.length === 0 && missingUsage.length === 0 ? (
            <Text as="p" size="caption" tone="secondary">
              {t("Agent time is unavailable.")}
            </Text>
          ) : null}
        </Popover>
      ) : null}
    </>
  );
}
