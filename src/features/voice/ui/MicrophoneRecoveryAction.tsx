import { useEffect, useRef, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { useT } from "../../../shared/i18n";
import { openPrivacySettings } from "../../../platform/tauri/privacySettings";
import { canOpenMicrophoneSettings, isMicrophoneBlocked } from "../model/microphoneAccess";

/** Opens settings only; permission remains owned by the OS and the user. */
export function MicrophoneRecoveryAction({ message }: { message: string }) {
  const t = useT();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  if (!canOpenMicrophoneSettings() || !isMicrophoneBlocked(message)) return null;

  async function open() {
    if (pending.current) return;
    pending.current = true;
    setOpening(true);
    setError("");
    try {
      await openPrivacySettings("microphone");
    } catch {
      if (mounted.current)
        setError(t("Could not open microphone settings. Open your system settings manually."));
    } finally {
      pending.current = false;
      if (mounted.current) setOpening(false);
    }
  }
  return (
    <>
      <Button
        loading={opening}
        disabled={opening}
        onClick={() =>
          void open().catch(() => {
            if (mounted.current)
              setError(
                t("Could not open microphone settings. Open your system settings manually."),
              );
          })
        }
      >
        {t("Open Privacy Settings")}
      </Button>
      {error ? <InlineError>{error}</InlineError> : null}
    </>
  );
}
