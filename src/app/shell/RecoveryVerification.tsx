import { Text } from "../../shared/ui/Text";
import { useT } from "../../shared/i18n";
import { InlineError } from "../../shared/ui/InlineError";

export function RecoveryVerification({
  verification,
  readError,
  pending,
  onRetry,
}: {
  verification: string;
  readError?: string | null;
  pending: boolean;
  onRetry: () => void;
}) {
  const t = useT();
  return (
    <div className="grid gap-(--ui-space-1)">
      <Text size="caption" tone="secondary" wrap="anywhere">
        {verification}
      </Text>
      {readError ? (
        <InlineError retry={{ label: t("Retry verification"), pending, onRetry }}>
          {readError}
        </InlineError>
      ) : null}
    </div>
  );
}
