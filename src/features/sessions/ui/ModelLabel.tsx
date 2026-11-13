import { Bot } from "../../../shared/ui/icons";
import { HarnessIcon } from "../../../shared/ui/identity/HarnessIcon";
import { IDENTITY_SIZE_CLASS, type IdentitySize } from "../../../shared/ui/identity/identitySize";
import { Text } from "../../../shared/ui/Text";
import { useModelDisplayName, useModelHarness } from "../model/reactiveReads";

/**
 * A model as the user sees it everywhere: provider icon plus a readable name on one line,
 * truncated at the end. Pass the raw id (or a harness plus id); the name comes from
 * `modelDisplayName`, so `claude-haiku-4-5-20251001` shows as "Haiku 4.5". `iconOnly` gives the
 * icon for a select option's `icon` slot, next to its readable `label`.
 */
export function ModelLabel({
  model,
  harness,
  name,
  size = "sm",
  iconOnly = false,
  wrap = false,
  className,
}: {
  /** Raw model id; stored and submitted values stay this id. */
  model: string;
  /** Provider of the model when known; any string is accepted (an unknown one falls back to the id). */
  harness?: string;
  /** An already resolved display name (catalog entry, account suffix); defaults to the derived one. */
  name?: string;
  size?: IdentitySize;
  iconOnly?: boolean;
  /** Full identity in expanded detail; compact callers retain their one-line label. */
  wrap?: boolean;
  className?: string;
}) {
  const provider = useModelHarness(model, harness);
  const displayName = useModelDisplayName(model, harness);
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className ?? ""}`}>
      {provider ? (
        <HarnessIcon harness={provider} size={size} />
      ) : (
        <Bot aria-hidden className={`${IDENTITY_SIZE_CLASS[size]} shrink-0`} />
      )}
      {!iconOnly && (
        <Text size="inherit" tone="inherit" truncate={!wrap} wrap={wrap ? "anywhere" : undefined}>
          {name ?? displayName}
        </Text>
      )}
    </span>
  );
}
