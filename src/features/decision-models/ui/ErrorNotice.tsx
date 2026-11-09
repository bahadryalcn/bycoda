import { useState } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { errorDetail } from "../model/decisionView";

/** Plain message first; the raw error text stays behind "Technical details". */
export function ErrorNotice({
  error,
  onRetry,
  retrying = false,
}: {
  error: unknown;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <InlineError
        retry={onRetry ? { onRetry, label: t("Try again"), pending: retrying } : undefined}
      >
        {t("This did not work. Try again.")}
      </InlineError>
      <div>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {t("Technical details")}
        </Button>
      </div>
      {open ? (
        <div className="text-ui-micro break-words whitespace-pre-wrap text-(--ui-text-muted)">
          {errorDetail(error)}
        </div>
      ) : null}
    </div>
  );
}
