import { Text, type TextTone } from "../../../shared/ui/Text";
import { useEffect, useState } from "react";
import { ActionHost, InlineAction } from "../../../shared/ui/ActionHost";
import { TextField } from "../../../shared/ui/TextField";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { CheckCircle, Clock, Inbox, X } from "../../../shared/ui/icons";
import { InboxProviderMark } from "../../inbox/ui/InboxProviderMark";
import { formatDate, t, useLocale } from "../../../shared/i18n";
import { gitBranches } from "../../../platform/tauri/fs";
import { looksLikeProject } from "../../projects/model/recents";
import {
  AUTOMATION_WEEKDAYS,
  gmtOffsetLabel,
  nextAutomationRunAt,
  nextRunPreview,
  type AutomationTrigger,
  type AutomationTriggerKind,
} from "../model/automations";
import { previewHostAutomation, type HostSchedulePreview } from "../model/hostAutomationClient";
import { findTriggerEvent } from "../model/automationTriggerCatalog";
import type { AutomationSchedule } from "../model/automationSchedule";

export function TriggerMark({
  kind,
  className,
  tone,
}: {
  kind: AutomationTriggerKind;
  className?: string;
  tone?: TextTone;
}) {
  useLocale();
  if (kind === "time") {
    return <Clock className={className} tone={tone} strokeWidth={1.75} />;
  }
  if (kind === "tasks") return <CheckCircle className={className} tone={tone} strokeWidth={1.75} />;
  if (kind === "social") return <Inbox className={className} tone={tone} strokeWidth={1.75} />;
  return <InboxProviderMark provider={kind} className={className} tone={tone} />;
}

export function TriggerRow({
  trigger,
  cwd,
  background = false,
  machineId,
  onChange,
  onRemove,
}: {
  trigger: AutomationTrigger;
  cwd: string;
  background?: boolean;
  machineId?: string;
  onChange: (trigger: AutomationTrigger) => void;
  onRemove: () => void;
}) {
  useLocale();
  // Branch names belong to the project they were read for; another project or a
  // trigger without a branch has none until its own read answers.
  const [loadedBranches, setLoadedBranches] = useState<{ path: string; names: string[] }>({
    path: "",
    names: [],
  });
  const projectPath = looksLikeProject(cwd) ? cwd : "";
  const push = trigger.event === "push_to_branch";
  const branches =
    projectPath && push && loadedBranches.path === projectPath ? loadedBranches.names : [];
  useEffect(() => {
    if (!projectPath || !push) return;
    let cancelled = false;
    void gitBranches(projectPath).then(
      (info) => {
        if (!cancelled)
          setLoadedBranches({
            path: projectPath,
            names: info.branches.map((branch) => branch.name),
          });
      },
      () => {
        if (!cancelled) setLoadedBranches({ path: projectPath, names: [] });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectPath, push]);
  const branchOptions = branches.map((name) => ({ value: name, label: name }));
  if (trigger.branch && !branchOptions.some((option) => option.value === trigger.branch)) {
    branchOptions.unshift({ value: trigger.branch, label: trigger.branch });
  }
  const previewKey = `${machineId}:${trigger.scheduleKind}:${trigger.time}:${trigger.minute}:${trigger.dayOfWeek}`;
  const [preview, setPreview] = useState<{ key: string; value: HostSchedulePreview } | null>(null);
  useEffect(() => {
    if (!background || !machineId || trigger.kind !== "time") return;
    let cancelled = false;
    void previewHostAutomation(machineId, trigger).then(
      (value) => {
        if (!cancelled) setPreview({ key: previewKey, value });
      },
      () => {
        if (!cancelled) setPreview(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [background, machineId, previewKey, trigger.kind]);
  const hostPreview = preview?.key === previewKey ? preview.value : undefined;
  const nextAt =
    trigger.kind === "time"
      ? background
        ? (hostPreview?.nextRunAt ?? 0)
        : nextAutomationRunAt(trigger)
      : 0;

  return (
    <ActionHost
      controlMinHeight="large"
      padding={{ inline: "md", block: "xs" }}
      className="-mx-2 gap-2.5"
    >
      <TriggerMark kind={trigger.kind} className="icon-sm shrink-0" tone="muted" />
      <Text
        as="div"
        size="secondary"
        tone="neutral"
        className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1"
      >
        {trigger.kind === "time" ? (
          <TimeTriggerSentence
            trigger={trigger}
            nextAt={nextAt}
            onChange={onChange}
            executionTimeZone={background ? (hostPreview?.timeZone ?? null) : undefined}
          />
        ) : (
          <EventTriggerSentence
            trigger={trigger}
            branchOptions={branchOptions}
            projectChosen={Boolean(projectPath)}
            onChange={onChange}
          />
        )}
      </Text>
      <InlineAction label={t("Remove trigger")} onClick={onRemove}>
        <X />
      </InlineAction>
    </ActionHost>
  );
}

export function TimeTriggerSentence<T extends AutomationSchedule>({
  trigger,
  nextAt,
  executionTimeZone,
  onChange,
}: {
  trigger: T;
  nextAt: number;
  executionTimeZone?: string | null;
  onChange: (trigger: T) => void;
}) {
  useLocale();
  const dayOptions = AUTOMATION_WEEKDAYS.map((label, value) => ({
    value: String(value),
    label,
  }));
  const minuteOptions = [0, 15, 30, 45].map((value) => ({
    value: String(value),
    label: `:${String(value).padStart(2, "0")}`,
  }));
  const prefix =
    trigger.scheduleKind === "hourly"
      ? "Every hour at"
      : trigger.scheduleKind === "daily"
        ? "Every day at"
        : trigger.scheduleKind === "weekdays"
          ? "Every weekday at"
          : "Every week on";
  return (
    <>
      <span>{t(prefix)}</span>
      {trigger.scheduleKind === "weekly" ? (
        <>
          <TriggerPill
            label={t("Day")}
            value={String(trigger.dayOfWeek)}
            options={dayOptions}
            onChange={(value) => onChange({ ...trigger, dayOfWeek: Number(value) })}
          />
          <span>{t("at")}</span>
        </>
      ) : null}
      {trigger.scheduleKind === "hourly" ? (
        <TriggerPill
          label={t("Minute")}
          value={String(trigger.minute)}
          options={minuteOptions}
          onChange={(value) => onChange({ ...trigger, minute: Number(value) })}
        />
      ) : (
        <TriggerPill
          label={t("Time")}
          value={trigger.time}
          options={timeOptions(trigger.time)}
          onChange={(value) => onChange({ ...trigger, time: value })}
        />
      )}
      <Text size="inherit" tone="muted">
        {executionTimeZone === undefined
          ? gmtOffsetLabel()
          : (executionTimeZone ?? t("Execution host timezone unavailable"))}
      </Text>
      <Text size="inherit" tone="muted" className="ml-1">
        {executionTimeZone === undefined
          ? nextRunPreview(nextAt)
          : executionTimeZone && nextAt
            ? `${t("Next run")} ${formatDate(nextAt, { timeZone: executionTimeZone, timeZoneName: "short" })}`
            : t("Host schedule preview unavailable")}
      </Text>
    </>
  );
}

export function EventTriggerSentence({
  trigger,
  branchOptions,
  projectChosen,
  onChange,
}: {
  trigger: AutomationTrigger;
  branchOptions: { value: string; label: string }[];
  projectChosen: boolean;
  onChange: (trigger: AutomationTrigger) => void;
}) {
  useLocale();
  if (trigger.kind === "tasks" || trigger.kind === "social")
    return <span>{findTriggerEvent(trigger.kind, trigger.event)?.label ?? trigger.event}</span>;
  const stem =
    trigger.event === "push_to_branch"
      ? "Push"
      : (findTriggerEvent(trigger.kind, trigger.event)?.label ?? trigger.event);
  const push = trigger.event === "push_to_branch";
  const labeled = trigger.event === "issue_labeled" || trigger.event === "pull_request_labeled";
  return (
    <>
      {labeled ? (
        <>
          <span>{t("Label")}</span>
          <TextField
            label={t("Label")}
            hideLabel
            aria-label={t("Label")}
            value={trigger.label ?? ""}
            onChange={(event) => onChange({ ...trigger, label: event.target.value })}
            placeholder={t("any label")}
            spellCheck={false}
            autoComplete="off"
            fieldClassName="w-32"
          />
          <span>
            {t("added to")} {trigger.event === "issue_labeled" ? t("issue") : t("pull request")}
          </span>
        </>
      ) : (
        <span>{stem}</span>
      )}
      {push ? (
        <>
          <span>{t("on")}</span>
          <TriggerPill
            label={t("Branch")}
            value={trigger.branch}
            options={branchOptions}
            placeholder={t("Select a branch")}
            disabled={!projectChosen}
            emptyLabel={projectChosen ? "No branches found" : "Choose a project first"}
            onChange={(value) => onChange({ ...trigger, branch: value })}
          />
        </>
      ) : null}
      <span>{t("by")}</span>
      <TriggerPill
        label={t("Actor")}
        value={trigger.actor || "anyone"}
        options={[
          {
            value: "anyone",
            get label() {
              return t("Anyone");
            },
          },
        ]}
        onChange={(value) => onChange({ ...trigger, actor: value })}
      />
    </>
  );
}

function TriggerPill({
  label,
  value,
  options,
  onChange,
  placeholder,
  disabled,
  emptyLabel,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string; keywords?: string }[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  emptyLabel?: string;
}) {
  useLocale();
  return (
    <SearchableSelect
      hideLabel
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      emptyLabel={emptyLabel}
      variant="pill"
      searchable={label === t("Branch") || options.length > 8}
    />
  );
}

function timeOptions(current: string) {
  const options = Array.from({ length: 24 }, (_, hour) => {
    const prefix = String(hour).padStart(2, "0");
    return [
      { value: `${prefix}:00`, label: `${prefix}:00` },
      { value: `${prefix}:30`, label: `${prefix}:30` },
    ];
  }).flat();
  if (current && !options.some((option) => option.value === current)) {
    options.unshift({ value: current, label: current });
  }
  return options;
}
