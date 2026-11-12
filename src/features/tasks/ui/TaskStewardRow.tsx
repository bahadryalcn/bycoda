import { Tooltip } from "../../../shared/ui/Tooltip";
import { Text } from "../../../shared/ui/Text";
import { Heading } from "../../../shared/ui/Heading";
import { ActionHost, InlineAction, InlineMoreAction } from "../../../shared/ui/ActionHost";
import { Badge } from "../../../shared/ui/Badge";
import { Spinner } from "../../../shared/ui/Spinner";
import { Switch } from "../../../shared/ui/Switch";
import { Bot, Pencil, Play } from "../../../shared/ui/icons";
import { t, useLocale } from "../../../shared/i18n";
import { automationScheduleLabel, nextRunPreview } from "../../automations/public/automations";
import { type BoardSteward, stewardProjectName } from "../model/stewardClient";
import { formatTaskSpan } from "../model/taskClient";
import { StewardRunBadge } from "./StewardRunBadge";
import "./task-ops.css";

/** One steward: project, status, schedule and last run, with its actions at the
 * right. Delete lives in the overflow menu the panel opens. */
export function StewardRow({
  steward,
  acting,
  now,
  menuOpen,
  onToggle,
  onRunNow,
  onEdit,
  onOpenMenu,
}: {
  steward: BoardSteward;
  acting: string | null;
  now: number;
  menuOpen: boolean;
  onToggle: (steward: BoardSteward) => void;
  onRunNow: (steward: BoardSteward) => void;
  onEdit: (steward: BoardSteward) => void;
  onOpenMenu: (steward: BoardSteward, anchor: HTMLButtonElement) => void;
}) {
  useLocale();
  const busy = acting != null;
  const pending = acting === `steward:${steward.machineId}:${steward.id}`;
  const running = steward.run != null;
  const failedOrSkipped = steward.lastRunStatus === "failed" || steward.lastRunStatus === "skipped";
  return (
    <ActionHost
      as="article"
      aria-label={t("Steward for {p0}", { p0: stewardProjectName(steward) })}
      data-steward-status={steward.lastRunStatus}
      aria-busy={pending || undefined}
      className="task-ops-row"
    >
      <div className="task-ops-row-text">
        <div className="task-ops-title-line">
          <Bot className="icon-sm shrink-0" tone="secondary" />
          <Tooltip label={steward.focus || undefined} asChild>
            <Heading size="section" level={3} leading="inherit" truncate>
              {stewardProjectName(steward)}
            </Heading>
          </Tooltip>
          {!steward.enabled ? <Badge size="xs">{t("Paused")}</Badge> : null}
        </div>
        <Text as="p" size="caption" tone="secondary" leading="inherit" className="task-ops-caption">
          {t("on ")}
          {steward.machineName}
          {steward.stale ? t(" (offline, last known)") : ""} · {automationScheduleLabel(steward)}
        </Text>
        <Text
          as="p"
          size="caption"
          tone="secondary"
          leading="inherit"
          className="task-ops-caption flex flex-wrap items-center gap-1"
        >
          {steward.lastRunStatus ? (
            <>
              {t("Last run: ")}
              <StewardRunBadge status={steward.lastRunStatus} />
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
          {steward.enabled ? ` · ${nextRunPreview(steward.nextRunAt)}` : ""}
        </Text>
        {steward.lastRunError && failedOrSkipped ? (
          <Text
            as="p"
            size="caption"
            tone={steward.lastRunStatus === "failed" ? "danger" : "secondary"}
            leading="inherit"
            className="task-ops-caption"
            data-tone={steward.lastRunStatus === "failed" ? "danger" : undefined}
          >
            {steward.lastRunError}
          </Text>
        ) : null}
      </div>
      <div className="task-ops-actions">
        {pending ? <Spinner size="xs" tone="secondary" className="mx-1.5" /> : null}
        <Switch
          aria-label={t("Enabled")}
          checked={steward.enabled}
          disabled={busy}
          onCheckedChange={() => onToggle(steward)}
        />
        <InlineAction
          reveal="always"
          label={t("Run now")}
          disabled={busy || running}
          onClick={() => onRunNow(steward)}
        >
          <Play className="icon-xs" />
        </InlineAction>
        <InlineAction
          reveal="always"
          label={t("Edit")}
          disabled={busy}
          onClick={() => onEdit(steward)}
        >
          <Pencil className="icon-xs" />
        </InlineAction>
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
