import { t } from "../../../../shared/i18n";
import { StatusDot, type StatusDotProps } from "../../../../shared/ui/StatusDot";
import { Tooltip } from "../../../../shared/ui/Tooltip";

/** Compact status mark with a readable pointer hint and its own accessible name. */
export function SocialStatusDot({ label, ...props }: StatusDotProps & { label: string }) {
  return (
    <Tooltip asChild label={t("{p0}: {p1}", { p0: t("Status"), p1: label })}>
      <StatusDot {...props} label={label} />
    </Tooltip>
  );
}
