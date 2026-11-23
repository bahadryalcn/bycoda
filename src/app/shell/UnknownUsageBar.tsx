import { Text } from "../../shared/ui/Text";
import { Tooltip } from "../../shared/ui/Tooltip";

/** Unknown quota stays distinct from zero usage, with its reason available on focus/hover. */
export function UnknownUsageBar({ label, loading = false }: { label: string; loading?: boolean }) {
  return (
    <Tooltip label={label}>
      <Text aria-label={label} size="caption" tone="muted">
        {loading ? "…" : "–"}
      </Text>
    </Tooltip>
  );
}
