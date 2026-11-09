import { useT } from "../../shared/i18n";
import { Button } from "../../shared/ui/Button";
import { Disclosure } from "../../shared/ui/Disclosure";

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
    <div className="break-words text-ui-caption text-(--ui-text-secondary)">
      <span>{verification}</span>
      {readError ? (
        <>
          <Disclosure summary={t("Details")} size="sm">
            <p className="select-text [overflow-wrap:anywhere]">{readError}</p>
          </Disclosure>
          <Button variant="ghost" size="sm" disabled={pending} onClick={onRetry}>
            {t("Retry verification")}
          </Button>
        </>
      ) : null}
    </div>
  );
}
