import { ActionHost, InlineMoreAction, InlineTextAction } from "../../../shared/ui/ActionHost";
import { Heading } from "../../../shared/ui/Heading";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { Spinner } from "../../../shared/ui/Spinner";
import { Switch } from "../../../shared/ui/Switch";
import { Text } from "../../../shared/ui/Text";
import { t, useLocale } from "../../../shared/i18n";
import { automationScheduleLabel, nextRunPreview } from "../../automations/public/automations";
import { projectDisplayName } from "../../projects/public/projectNames";
import { type BoardSteward, stewardProjectName } from "../model/stewardClient";
import { formatTaskSpan } from "../model/taskClient";
import { StewardRunBadge } from "./StewardRunBadge";
import "./task-ops.css";

/** A project steward with a schedule and two direct actions. */
export function StewardRow({
  steward,
  acting,
  now,
  menuOpen,
  onToggle,
  onRunNow,
  onOpenMenu,
}: {
  steward: BoardSteward;
  acting: string | null;
  now: number;
  menuOpen: boolean;
  onToggle: (steward: BoardSteward) => void;
  onRunNow: (steward: BoardSteward) => void;
  onOpenMenu: (steward: BoardSteward, anchor: HTMLButtonElement) => void;
}) {
  useLocale();
  const busy = acting != null;
  const pending = acting === `steward:${steward.machineId}:${steward.id}`;
  const project = stewardProjectName(steward);
  const name = projectDisplayName(steward.cwd);
  const status = steward.run ? "running" : steward.lastRunStatus;
  const lastRunError =
    status === "failed" || status === "skipped" ? steward.lastRunError : undefined;
  const machine =
    steward.stale && !steward.pendingRefresh
      ? t("on {p0} (offline, last known)", { p0: steward.machineName })
      : t("on {p0}", { p0: steward.machineName });

  return (
    <ActionHost
      as="article"
      aria-label={t("Steward for {p0}", { p0: project })}
      data-steward-status={status}
      aria-busy={pending || undefined}
      className="task-ops-row"
    >
      <div className="task-ops-row-text">
        <Heading size="item" level={3} leading="inherit" className="break-words">
          {name}
        </Heading>
        <Text size="caption" tone="secondary" wrap="anywhere">
          {name !== project ? `${project} · ` : null}
          {automationScheduleLabel(steward)} · {machine}
          {steward.enabled && !steward.run ? ` · ${nextRunPreview(steward.nextRunAt)}` : ""}
        </Text>
        {status ? (
          <div className="task-ops-run">
            <StewardRunBadge status={status} />
            {status !== "running" ? (
              <Text size="caption" tone="secondary">
                {steward.lastRunAt
                  ? t(" {p0} ago", { p0: formatTaskSpan(now - steward.lastRunAt) })
                  : null}
                {status === "succeeded" && steward.lastProposed !== undefined
                  ? t(
                      steward.lastProposed === 1
                        ? " · {p0} new suggestion"
                        : " · {p0} new suggestions",
                      { p0: steward.lastProposed },
                    )
                  : null}
              </Text>
            ) : null}
          </div>
        ) : null}
        {lastRunError &&
          (status === "failed" ? (
            <InlineError live="off">{lastRunError}</InlineError>
          ) : (
            <InlineMessage live="off">{lastRunError}</InlineMessage>
          ))}
      </div>
      <div className="task-ops-actions">
        {pending ? <Spinner size="xs" tone="secondary" /> : null}
        <Switch
          aria-label={t("Enabled")}
          checked={steward.enabled}
          disabled={busy}
          onCheckedChange={() => onToggle(steward)}
        />
        <InlineTextAction
          disabled={busy || Boolean(steward.run)}
          disabledReason={steward.run ? t("A run is already in progress.") : undefined}
          onClick={() => onRunNow(steward)}
        >
          {t("Run now")}
        </InlineTextAction>
        <InlineMoreAction
          reveal="always"
          label={t("More actions")}
          disabled={busy}
          expanded={menuOpen}
          onOpen={(anchor) => onOpenMenu(steward, anchor)}
        />
      </div>
    </ActionHost>
  );
}
