import { Button } from "../../../shared/ui/Button";
import { t } from "../../../shared/i18n";
import type { SocialPublishingPlan } from "../model/social";
import { StatusBadge } from "./socialShared";
import { publishingPlanTime } from "../model/publishingPlanForm";

export function SocialPublishingPlanRow({
  plan,
  accountName,
  status,
  selected,
  disabled,
  onSelect,
}: {
  plan: SocialPublishingPlan;
  accountName?: string;
  status: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <Button
      disabled={disabled}
      type="button"
      variant="item"
      layout="stacked"
      className="social-row"
      aria-pressed={selected}
      onClick={onSelect}
    >
      <strong>{plan.name}</strong>
      <StatusBadge status={status} />
      <span>{accountName ?? t("Account removed")}</span>
      <small>
        {t("{p0} items left", { p0: Math.max(0, plan.campaigns.length - plan.nextIndex) })}
        {plan.nextRunAt ? ` · ${publishingPlanTime(plan.nextRunAt, plan.schedule.timeZone)}` : ""}
      </small>
    </Button>
  );
}
