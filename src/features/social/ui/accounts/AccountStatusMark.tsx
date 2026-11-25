import { CircleAlert, Pause, TriangleAlert } from "../../../../shared/ui/icons";
import { t } from "../../../../shared/i18n";
import { Tooltip } from "../../../../shared/ui/Tooltip";
import type { HealthStatus } from "../common/HealthDot";

const MARKS = {
  warn: { Icon: TriangleAlert, tone: "warning" },
  error: { Icon: CircleAlert, tone: "danger" },
  paused: { Icon: Pause, tone: "warning" },
} as const;

/**
 * Status of an account as one icon: the meaning is the tooltip and the accessible name, never a
 * text tag on the row.
 */
export function AccountStatusMark({
  status,
  label,
}: {
  status: Exclude<HealthStatus, "ok"> | "paused";
  label: string;
}) {
  const { Icon, tone } = MARKS[status];
  return (
    <Tooltip label={label}>
      <Icon
        className="icon-sm shrink-0"
        tone={tone}
        aria-label={t("Account status: {p0}", { p0: label })}
      />
    </Tooltip>
  );
}
