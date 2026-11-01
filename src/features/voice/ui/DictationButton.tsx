import { useEffect, useRef, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { Mic } from "../../../shared/ui/icons";
import { useLocale, useT } from "../../../shared/i18n";
import { Dictation, type DictationState } from "../model/dictation";
import { useVoiceSettings, voiceRuntimeSettings } from "../model/voiceSettings";
import styles from "./DictationButton.module.css";

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
  const visual = useRef<HTMLSpanElement>(null);
  const latest = useRef({ onText, onError });
  latest.current = { onText, onError };

  useEffect(() => () => dictation.current?.cancel(), []);
  useEffect(() => {
    if (disabled || !settings.enabled) dictation.current?.cancel();
  }, [disabled, settings.enabled]);

  if (!settings.enabled) return null;

  const toggle = () => {
    if (state === "finishing") return;
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
          visual.current?.style.setProperty("--dictation-level", "0");
          if (value === "idle") dictation.current = null;
        },
        error: (message) => latest.current.onError(t(message)),
        level: (value) => {
          if (dictation.current !== next) return;
          // Only the tiny visual updates at capture cadence, never the composer.
          visual.current?.style.setProperty(
            "--dictation-level",
            String(Math.min(1, Math.max(0, value) * 7)),
          );
        },
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
      tooltip={state === "idle" ? t("Dictate: speak and the text appears here") : label}
      data-dictation-state={state}
      aria-busy={state === "starting" || state === "finishing" || undefined}
      aria-disabled={state === "finishing" || undefined}
      pressed={listening || state === "starting"}
      tone={listening ? "danger" : undefined}
      // Preparing can take a while; the button stays clickable so it can be cancelled.
      disabled={disabled}
      // Keep the caret in the message box while the microphone toggles.
      onMouseDown={(event) => event.preventDefault()}
      onClick={toggle}
    >
      <span ref={visual} className={styles.visual} data-state={state} aria-hidden="true">
        {state === "idle" ? (
          <Mic className="size-3.5" strokeWidth={1.9} />
        ) : state === "starting" ? (
          <span className={styles.ring} />
        ) : state === "listening" ? (
          <span className={styles.wave}>
            {[0, 1, 2, 3, 4].map((index) => (
              <i key={index} />
            ))}
          </span>
        ) : (
          <span className={styles.dots}>
            <i />
            <i />
            <i />
          </span>
        )}
      </span>
    </Button>
  );
}
