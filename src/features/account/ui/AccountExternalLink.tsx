import { useEffect, useRef, useState } from "react";
import { openExternal } from "../../../platform/tauri/openExternal";
import { copyText } from "../../../platform/tauri/clipboard";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { Text } from "../../../shared/ui/Text";
import { LiveText } from "../../../shared/ui/LiveText";

/** Local browser-link recovery; never sends a message or changes account state. */
export function AccountExternalLink({ url, label }: { url: string; label: string }) {
  const [pending, setPending] = useState<"open" | "copy" | null>(null);
  const [failure, setFailure] = useState<"open" | "copy" | null>(null);
  const [copied, setCopied] = useState(false);
  const busy = useRef(false);
  const mainControl = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- returns DOM focus when successful recovery removes the focused Copy button.
  useEffect(() => {
    if (pending !== null || failure !== null || !returnFocus.current) return;
    returnFocus.current = false;
    mainControl.current?.focus();
  }, [pending, failure]);
  const run = async (operation: "open" | "copy") => {
    if (busy.current) return;
    busy.current = true;
    setPending(operation);
    setCopied(false);
    const origin = document.activeElement;
    returnFocus.current = false;
    try {
      if (operation === "open") await openExternal(url);
      else {
        await copyText(url);
        setCopied(true);
      }
      returnFocus.current = failure !== null && document.activeElement === origin;
      setFailure(null);
    } catch {
      setFailure(operation);
    } finally {
      busy.current = false;
      setPending(null);
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Button
        ref={mainControl}
        variant="link"
        disabled={pending !== null}
        loading={pending === "open"}
        loadingLabel={t("Opening…")}
        onClick={() => void run("open")}
      >
        {failure === "open" ? t("Retry") : label}
      </Button>
      {failure ? (
        <>
          <InlineError>
            {failure === "copy"
              ? t("Could not copy. Select the address and copy it manually.")
              : t("Could not open the link. Copy the address and open it manually.")}
          </InlineError>
          <Text wrap="anywhere">{url}</Text>
          <Button
            disabled={pending !== null}
            loading={pending === "copy"}
            loadingLabel={t("Copying…")}
            onClick={() => void run("copy")}
          >
            {t("Copy")}
          </Button>
        </>
      ) : null}
      {copied ? <LiveText text={t("Copied")} /> : null}
    </div>
  );
}
