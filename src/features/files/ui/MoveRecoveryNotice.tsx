import { Text } from "../../../shared/ui/Text";
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
      <Text role="status" as="p" size="caption" tone="secondary" className="px-2 py-1">
        {notice}
      </Text>
    );
  const reveal = () => {
    setError(null);
    return revealPath(notice.recoveryPath);
  };
  return (
    <Text as="div" size="caption" tone="secondary" className="px-2 py-1">
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
    </Text>
  );
}
