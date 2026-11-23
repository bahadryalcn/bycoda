import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Switch } from "../../../shared/ui/Switch";
import { Text } from "../../../shared/ui/Text";
import { Row } from "../../../shared/ui/settings";
import { canOrganizeSessions } from "../../sessions/public/sessionOrganizationOperations";
import {
  DEFAULT_MISSED_RUN_GRACE_MINUTES,
  withBackgroundChoice,
} from "../model/automationDraftRules";
import {
  GRACE_OPTIONS,
  RUN_TIME_LIMIT_OPTIONS,
  RUNS_PER_DAY_OPTIONS,
  optionLabel,
} from "../model/automationLimitOptions";
import type { AutomationDraft } from "../model/automations";
import { useAutomationFolderOptions } from "../hooks/useAutomationFolderOptions";

const CONVERSATION_OPTIONS = [
  {
    value: "fresh",
    get label() {
      return t("Start fresh");
    },
  },
  {
    value: "reuse",
    get label() {
      return t("Continue last");
    },
  },
] as const;

/**
 * The rare settings in one closed disclosure whose summary lists only the values that differ from
 * the defaults: session, session folder, missed-run grace, run time limit and runs per day.
 * The session rows belong to app runs; a Host starts its own sessions.
 */
export function AutomationMoreOptions({
  draft,
  background,
  onChange,
}: {
  draft: AutomationDraft;
  /** Offers the choice to keep running when the app is closed, with the machine's name. */
  background?: { machineName: string };
  onChange: (draft: AutomationDraft) => void;
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  const folders = useAutomationFolderOptions(draft.cwd, draft.sessionFolderId);
  const foldersUnavailable = !canOrganizeSessions(draft.cwd);
  const update = <K extends keyof AutomationDraft>(key: K, value: AutomationDraft[K]) =>
    onChange({ ...draft, [key]: value });
  const folder = draft.sessionFolderId
    ? (folders.options.find((option) => option.value === draft.sessionFolderId)?.label ??
      draft.sessionFolderId)
    : undefined;
  const summary = [
    background && draft.runInBackground
      ? t("In the background on {p0}", { p0: background.machineName })
      : undefined,
    !draft.runInBackground && draft.reuseSession ? t("Continue last") : undefined,
    !draft.runInBackground ? folder : undefined,
    draft.missedRunGraceMinutes !== DEFAULT_MISSED_RUN_GRACE_MINUTES
      ? `${t("Missed-run grace")}: ${optionLabel(GRACE_OPTIONS, draft.missedRunGraceMinutes)}`
      : undefined,
    draft.maxRunMinutes !== 0
      ? `${t("Run time limit")}: ${optionLabel(RUN_TIME_LIMIT_OPTIONS, draft.maxRunMinutes)}`
      : undefined,
    draft.maxRunsPerDay !== 0
      ? `${t("Runs per day")}: ${optionLabel(RUNS_PER_DAY_OPTIONS, draft.maxRunsPerDay)}`
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Disclosure
      variant="compact"
      open={open}
      onOpenChange={setOpen}
      summary={
        <>
          {t("More options")}
          {!open && summary ? (
            <Text truncate size="caption" tone="muted" className="ms-1 min-w-0">
              · {summary}
            </Text>
          ) : null}
        </>
      }
    >
      <div>
        {background ? (
          <Row label={t("In the background on {p0}", { p0: background.machineName })}>
            <Switch
              aria-label={t("In the background on {p0}", { p0: background.machineName })}
              checked={draft.runInBackground}
              onCheckedChange={(runInBackground) =>
                onChange(withBackgroundChoice(draft, runInBackground))
              }
            />
          </Row>
        ) : null}
        {draft.runInBackground ? null : (
          <>
            <Row label={t("Session")}>
              <PillSelect
                label={t("Session")}
                value={draft.reuseSession ? "reuse" : "fresh"}
                disabled={draft.workspaceMode === "worktree"}
                options={CONVERSATION_OPTIONS}
                onChange={(value) => update("reuseSession", value === "reuse")}
              />
            </Row>
            <Row
              label={t("Session folder")}
              description={
                foldersUnavailable
                  ? t("Open a project to use folders")
                  : (folders.error ?? (folders.loading ? t("Loading folders…") : undefined))
              }
              descriptionVisible
            >
              <SearchableSelect
                hideLabel
                variant="pill"
                searchable
                align="end"
                label={t("Session folder")}
                value={draft.sessionFolderId}
                options={folders.options}
                disabled={foldersUnavailable || folders.loading || !!folders.error}
                onChange={(value) => update("sessionFolderId", value)}
              />
            </Row>
          </>
        )}
        <Row label={t("Missed-run grace")}>
          <PillSelect
            label={t("Missed-run grace")}
            value={String(draft.missedRunGraceMinutes)}
            options={GRACE_OPTIONS}
            onChange={(value) => update("missedRunGraceMinutes", Number(value))}
          />
        </Row>
        <Row label={t("Run time limit")}>
          <PillSelect
            label={t("Run time limit")}
            value={String(draft.maxRunMinutes)}
            options={RUN_TIME_LIMIT_OPTIONS}
            onChange={(value) => update("maxRunMinutes", Number(value))}
          />
        </Row>
        <Row label={t("Runs per day")}>
          <PillSelect
            label={t("Runs per day")}
            value={String(draft.maxRunsPerDay)}
            options={RUNS_PER_DAY_OPTIONS}
            onChange={(value) => update("maxRunsPerDay", Number(value))}
          />
        </Row>
      </div>
    </Disclosure>
  );
}

function PillSelect({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <SearchableSelect
      hideLabel
      variant="pill"
      searchable={false}
      align="end"
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      disabled={disabled}
    />
  );
}
