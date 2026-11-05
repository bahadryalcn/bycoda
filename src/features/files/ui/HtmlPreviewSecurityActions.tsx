import { useState } from "react";
import { t } from "../../../shared/i18n/technical";
import { Button } from "../../../shared/ui/Button";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { InlineError } from "../../../shared/ui/InlineError";
import { ExternalLink } from "../../../shared/ui/icons";

/** Generated content retains its sandbox; opening a saved file is an explicit owner action. */
export function HtmlPreviewSecurityActions({ path }: { path: string }) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedPath = path.startsWith("/") || path.startsWith("\\\\") || /^[a-z]:[/\\]/i.test(path);
  const openSavedFile = async () => {
    if (opening || !savedPath) return;
    setOpening(true);
    setError(null);
    try {
      const { openPathWithDefaultApp } = await import("../../../platform/tauri/fs");
      await openPathWithDefaultApp(path);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setOpening(false);
    }
  };
  return (
    <div className="flex min-w-0 items-center gap-1">
      <InfoPopover label={t("Preview restrictions")}>
        <p>{t("This sandbox restricts external data requests and hidden files. Open a saved HTML file in its default app when it needs those resources.")}</p>
      </InfoPopover>
      {savedPath ? (
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          label={t("Open saved file in default app")}
          loading={opening}
          onClick={() => { void openSavedFile().catch((cause: unknown) => setError(String(cause))); }}
        >
          <ExternalLink className="icon-sm" aria-hidden />
        </Button>
      ) : null}
      {error ? <InlineError>{error}</InlineError> : null}
    </div>
  );
}
