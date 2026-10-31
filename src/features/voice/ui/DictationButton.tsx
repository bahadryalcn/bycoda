import { useEffect, useRef, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { Mic } from "../../../shared/ui/icons";
import { useLocale, useT } from "../../../shared/i18n";
import { Dictation, type DictationState } from "../model/dictation";
import { useVoiceSettings, voiceRuntimeSettings } from "../model/voiceSettings";

/**
 * Composer microphone: speech is recognized on this computer and each phrase is
 * inserted where the caret is. Offered once voice is enabled in Chat settings,
 * because recognition uses the same local installation.
 */
export function DictationButton({
  disabled = false,
  onText,
  onError,
}: {
  disabled?: boolean;
  onText: (text: string) => void;
  onError: (message: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const settings = useVoiceSettings();
  const [state, setState] = useState<DictationState>("idle");
  const dictation = useRef<Dictation | null>(null);
  const latest = useRef({ onText, onError });
  latest.current = { onText, onError };

  useEffect(() => () => dictation.current?.cancel(), []);
  useEffect(() => {
    if (disabled || !settings.enabled) dictation.current?.cancel();
  }, [disabled, settings.enabled]);

  if (!settings.enabled) return null;

  const toggle = () => {
    const current = dictation.current;
    if (current) {
      void current.stop();
      return;
    }
    const next = new Dictation(
      {
        text: (text) => latest.current.onText(text),
        state: (value) => {
          if (dictation.current !== next) return;
          setState(value);
          if (value === "idle") dictation.current = null;
        },
        error: (message) => latest.current.onError(t(message)),
      },
      locale.split("-")[0],
      voiceRuntimeSettings(settings),
    );
    dictation.current = next;
    void next.start();
  };

  const listening = state === "listening";
  const label =
    state === "starting"
      ? t("Preparing dictation…")
      : state === "finishing"
        ? t("Transcribing…")
        : listening
          ? t("Stop dictation")
          : t("Dictate");
  return (
    <Button
      variant="ghost"
      motion="none"
      iconOnly
      label={label}
      tooltip={listening ? t("Stop dictation") : t("Dictate: speak and the text appears here")}
      pressed={listening || state === "starting"}
      tone={listening ? "danger" : undefined}
      // Preparing can take a while; the button stays clickable so it can be cancelled.
      loading={state === "finishing"}
      loadingLabel={label}
      disabled={disabled}
      // Keep the caret in the message box while the microphone toggles.
      onMouseDown={(event) => event.preventDefault()}
      onClick={toggle}
    >
      <Mic className="size-3.5" strokeWidth={1.9} />
    </Button>
  );
}
