import { Text } from "../../shared/ui/Text";
import { Tooltip } from "../../shared/ui/Tooltip";

/**
 * Unknown quota stays distinct from zero usage, with its reason available on focus/hover.
 * `detail` is the raw provider text behind the translated `label`.
 */
export function UnknownUsageBar({
  label,
  detail,
  loading = false,
}: {
  label: string;
  detail?: string;
  loading?: boolean;
}) {
  return (
    <Tooltip label={label} details={detail ? [detail] : undefined}>
      <Text aria-label={detail ? `${label} ${detail}` : label} size="caption" tone="muted">
        {loading ? "…" : "–"}
      </Text>
    </Tooltip>
  );
}
