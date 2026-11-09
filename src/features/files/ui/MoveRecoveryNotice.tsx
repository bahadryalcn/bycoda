import { useState } from "react";
import { revealPath } from "../../../platform/tauri/fs";
import { t } from "../../../shared/i18n/technical";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";

export type CopyNotice =
  | string
  | { recoveryPath: string; receiptPath: string; warning?: string | null };

export function MoveRecoveryNotice({ notice }: { notice: CopyNotice }) {
  const [error, setError] = useState<string | null>(null);
  if (typeof notice === "string")
    return (
      <p role="status" className="px-2 py-1 text-ui-caption text-(--ui-text-secondary)">
        {notice}
      </p>
    );
  const reveal = () => {
    setError(null);
    return revealPath(notice.recoveryPath);
  };
  return (
    <div className="px-2 py-1 text-ui-caption text-(--ui-text-secondary)">
      <p role="status">
        {t("Moved. Recovery copy retained")}: {notice.recoveryPath}
      </p>
      <p>
        {t("Receipt")}: {notice.receiptPath}
      </p>
      <Button
        type="button"
        variant="link"
        onClick={() => void reveal().catch((reason) => setError(String(reason)))}
      >
        {t("Show recovery copy")}
      </Button>
      {notice.warning ? <InlineError>{notice.warning}</InlineError> : null}
      {error ? <InlineError>{error}</InlineError> : null}
    </div>
  );
}
