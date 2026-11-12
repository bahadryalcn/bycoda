import { Text } from "../../shared/ui/Text";
import { useT } from "../../shared/i18n";
import { Button } from "../../shared/ui/Button";

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
    <Text as="div" size="caption" tone="secondary" className="break-words">
      <span>{verification}</span>
      {readError ? (
        <>
          <p className="select-text [overflow-wrap:anywhere]">{readError}</p>
          <Button variant="ghost" size="sm" disabled={pending} onClick={onRetry}>
            {t("Retry verification")}
          </Button>
        </>
      ) : null}
    </Text>
  );
}
