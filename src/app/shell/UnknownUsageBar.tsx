import { Text } from "../../shared/ui/Text";
import { Tooltip } from "../../shared/ui/Tooltip";
import { surfaceAttributes } from "../../shared/ui/Surface";

/** Unknown quota stays distinct from zero usage, with its reason available on focus/hover. */
export function UnknownUsageBar({ label, loading = false }: { label: string; loading?: boolean }) {
  return (
    <Tooltip label={label}>
      <Text
        aria-label={label}
        size="caption"
        tone="secondary"
        {...surfaceAttributes(
          { radius: "sm", variant: "inset", frame: "stroke", borderStyle: "dashed" },
          "inline-flex h-4 min-w-12 items-center justify-center px-1",
        )}
      >
        {loading ? "···" : "?"}
      </Text>
    </Tooltip>
  );
}
