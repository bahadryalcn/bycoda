import { useId, useState } from "react";
import { useT } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";

export function InboxLoadError({
  error,
  retrying,
  disabled,
  onRetry,
}: {
  error: string;
  retrying: boolean;
  disabled: boolean;
  onRetry: () => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return (
    <Alert
      tone="danger"
      title={t("Could not load.")}
      action={
        <Button loading={retrying} disabled={disabled} onClick={onRetry}>
          {t("Retry")}
        </Button>
      }
    >
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? t("Hide details") : t("Show details")}
      </Button>
      {expanded ? (
        <div id={id} className="max-h-40 overflow-y-auto whitespace-pre-wrap wrap-anywhere">
          {error}
        </div>
      ) : null}
    </Alert>
  );
}
