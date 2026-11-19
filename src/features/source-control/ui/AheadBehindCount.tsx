import { Text } from "../../../shared/ui/Text";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { useT } from "../../../shared/i18n/git";
import { useFormat } from "../../../shared/i18n";

/**
 * Outgoing (ahead) and incoming (behind) commit counts for a checkout header. The arrows are
 * decorative; the tooltip explains them and the wrapper carries one localized accessible name
 * with both counts. `hideZero` drops a zero side (collapsed headers) and renders nothing when
 * both sides are zero.
 */
export function AheadBehindCount({
  ahead,
  behind,
  hideZero = false,
  className,
}: {
  ahead: number;
  behind: number;
  hideZero?: boolean;
  className?: string;
}) {
  const t = useT();
  const format = useFormat();
  if (hideZero && ahead <= 0 && behind <= 0) return null;
  const label = `${t("Outgoing commits")}: ${format.formatNumber(ahead)} · ${t("Incoming commits")}: ${format.formatNumber(behind)}`;
  return (
    <Tooltip label={label}>
      <Text
        as="span"
        size="caption"
        tone="secondary"
        role="img"
        aria-label={label}
        className={`flex items-center gap-1 tabular-nums ${className ?? ""}`}
      >
        {!hideZero || ahead > 0 ? <span aria-hidden>↑{ahead}</span> : null}
        {!hideZero || behind > 0 ? <span aria-hidden>↓{behind}</span> : null}
      </Text>
    </Tooltip>
  );
}
