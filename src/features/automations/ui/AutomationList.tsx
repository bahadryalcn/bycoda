import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { formatDate, t, useLocale } from "../../../shared/i18n";
import { CollectionRow } from "../../../shared/ui/CollectionRow";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { StatusText } from "../../../shared/ui/StatusText";
import { Switch } from "../../../shared/ui/Switch";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { SurfaceLoading } from "../../../shared/ui/SurfaceLoading";
import { projectKey, projectName } from "../../../shared/lib/paths";
import { formatGithubRelativeTime } from "../../../shared/i18n/format";
import { isoTimestamp } from "../../../shared/lib/time/timestamps";
import { resolveTabGroupLabel } from "../../workspace/public/tabGroups";
import { automationKey } from "../model/automationKey";
import { findTriggerEvent, triggerName } from "../model/automationTriggerCatalog";
import {
  automationScheduleLabel,
  automationTriggers,
  type Automation,
  type AutomationTrigger,
} from "../model/automations";
import { RunStatusPill } from "./AutomationRuns";

/** The automations as one column of rows; each row's switch pauses or resumes it at once. */
export function AutomationList({
  automations,
  loading,
  filtered,
  selectedId,
  groupLabels,
  isPending,
  isDisabled,
  onSelect,
  onToggle,
}: {
  automations: readonly Automation[];
  loading: boolean;
  /** A search or status filter hides rows, so an empty list is not first use. */
  filtered: boolean;
  /** The automation open in the editor, if any. */
  selectedId: string | null;
  groupLabels: Record<string, string>;
  isPending: (automation: Automation) => boolean;
  isDisabled: (automation: Automation) => boolean;
  onSelect: (automation: Automation) => void;
  onToggle: (automation: Automation, enabled: boolean) => void;
}) {
  useLocale();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  return (
    <aside
      {...surfaceAttributes(
        { frame: "pane", edge: "responsive-end" },
        "automation-list flex shrink-0 flex-col",
      )}
    >
      <div ref={lockOverscroll} className="min-h-0 flex-1 overflow-y-auto overscroll-none p-1.5">
        {loading ? (
          <SurfaceLoading />
        ) : automations.length > 0 ? (
          <ul className="space-y-0.5">
            {automations.map((automation) => (
              <li key={automationKey(automation)}>
                <AutomationCard
                  automation={automation}
                  pending={isPending(automation)}
                  disabled={isDisabled(automation)}
                  active={automationKey(automation) === selectedId}
                  labels={groupLabels}
                  onSelect={() => onSelect(automation)}
                  onToggle={(enabled) => onToggle(automation, enabled)}
                />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            context="list"
            kind={filtered ? "filtered" : "empty"}
            description={filtered ? t("No matching automations") : t("No automations yet")}
          />
        )}
      </div>
    </aside>
  );
}

function AutomationCard({
  automation,
  active,
  labels,
  onSelect,
  onToggle,
  pending,
  disabled,
}: {
  automation: Automation;
  active: boolean;
  labels: Record<string, string>;
  onSelect: () => void;
  onToggle: (enabled: boolean) => void;
  pending: boolean;
  disabled: boolean;
}) {
  useLocale();
  const key = projectKey(automation.cwd);
  const project = automation.cwd
    ? resolveTabGroupLabel(key, labels, projectName(automation.cwd))
    : t("General");
  const lastRunIso = automation.lastRunAt ? isoTimestamp(automation.lastRunAt) : undefined;
  const lastRun = lastRunIso ? formatGithubRelativeTime(lastRunIso) : null;
  const triggers = automationTriggers(automation);
  const nextRun =
    automation.enabled && !automation.host && triggers.length > 0 && automation.nextRunAt > 0
      ? t("Next: {p0}", {
          p0: formatDate(automation.nextRunAt, {
            weekday: "short",
            hour: "numeric",
            minute: "2-digit",
          }),
        })
      : "";
  const secondary = [
    !triggers.length && !automation.hostTrigger && automation.enabled
      ? t("No trigger, never runs")
      : triggerLabel(automation) + (triggers.length > 1 ? ` +${triggers.length - 1}` : ""),
    nextRun,
    automation.host ? t("on {p0}", { p0: automation.host.machineName }) : "",
    automation.host?.stale ? t("offline, last known") : "",
    project,
  ]
    .filter(Boolean)
    .join(" · ");
  const label = t(automation.enabled ? "Pause {p0}" : "Enable {p0}", { p0: automation.name });
  return (
    <CollectionRow
      data-paused={automation.enabled ? undefined : ""}
      selected={active}
      before={
        // The switch is named by its aria-label; a tooltip would only repeat that name.
        <Switch
          aria-label={label}
          checked={automation.enabled}
          disabled={disabled}
          aria-busy={pending || undefined}
          aria-disabled={pending || disabled || undefined}
          onCheckedChange={(value) => {
            if (!pending && !disabled) onToggle(value);
          }}
          compact
        />
      }
      title={automation.name}
      secondary={secondary}
      trailing={
        automation.host?.needsInput ? (
          <StatusText tone="needs-you">{t("Needs input")}</StatusText>
        ) : automation.lastRunStatus === "failed" || automation.lastRunStatus === "running" ? (
          <RunStatusPill status={automation.lastRunStatus} />
        ) : (
          lastRun
        )
      }
      primary={{
        "aria-current": active ? "true" : undefined,
        "aria-label": t("Open {p0}", { p0: automation.name }),
      }}
      onOpen={onSelect}
    />
  );
}

function triggerText(trigger: AutomationTrigger): string {
  return trigger.kind === "time"
    ? automationScheduleLabel(trigger)
    : (findTriggerEvent(trigger.kind, trigger.event)?.label ?? triggerName(trigger.kind));
}

/** The first trigger; the card lists the others behind a "+N". */
function triggerLabel(automation: Automation): string {
  if (automation.hostTrigger) return automationScheduleLabel(automation);
  const first = automationTriggers(automation)[0];
  return first ? triggerText(first) : "No trigger";
}
