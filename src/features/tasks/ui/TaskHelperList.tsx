import { t } from "../../../shared/i18n";
import { StatusText, type StatusTextTone } from "../../../shared/ui/StatusText";
import { Text } from "../../../shared/ui/Text";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { HarnessIcon } from "../../sessions/public/HarnessIcon";
import { resolveModel } from "../../sessions/public/models";
import type { HarnessId } from "../../sessions/public/session";
import type { TaskHelper } from "../model/taskHelpers";

const TONE: Record<TaskHelper["status"], StatusTextTone> = {
  running: "running",
  succeeded: "done",
  failed: "failed",
  cancelled: "idle",
};
const LABEL: Record<TaskHelper["status"], () => string> = {
  running: () => t("Running"),
  succeeded: () => t("Done"),
  failed: () => t("Failed"),
  cancelled: () => t("Cancelled"),
};

/**
 * The subagents and advisors a task's worker and reviewer started: title, model and the state the
 * Host recorded. A record holds no result or cost, so none is shown.
 */
export function TaskHelperList({ helpers }: { helpers: readonly TaskHelper[] }) {
  if (helpers.length === 0) return null;
  return (
    <ul aria-label={t("Helpers")} className="grid min-w-0 gap-1">
      {helpers.map((helper) => (
        <li
          key={helper.runId}
          data-task-helper={helper.status}
          className="flex min-w-0 items-center gap-2"
        >
          <HarnessIcon harness={helper.harness as HarnessId} className="icon-sm shrink-0" />
          <Text as="span" size="secondary" truncate className="min-w-0 shrink">
            {helper.title}
          </Text>
          <Text as="span" size="caption" tone="muted" truncate className="min-w-0 flex-1">
            {[
              helper.kind === "advisor" ? t("Advisor") : t("Subagent"),
              resolveModel(helper.harness as HarnessId, helper.model).name,
            ].join(" · ")}
          </Text>
          <Tooltip label={helper.error}>
            <StatusText tone={TONE[helper.status]}>{LABEL[helper.status]()}</StatusText>
          </Tooltip>
        </li>
      ))}
    </ul>
  );
}
