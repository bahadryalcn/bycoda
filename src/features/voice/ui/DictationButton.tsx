import { useEffect, useRef, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { motionAttributes } from "../../../shared/ui/Motion";
import { Spinner } from "../../../shared/ui/Spinner";
import { Mic } from "../../../shared/ui/icons";
import { useLocale, useT } from "../../../shared/i18n";
import { Dictation, type DictationState } from "../model/dictation";
import { reportDictation } from "../model/dictationActivity";
import { dictationLanguage, useVoiceSettings, voiceRuntimeSettings } from "../model/voiceSettings";
import { DictationOptions } from "./DictationOptions";
import styles from "./DictationButton.module.css";

/**
 * Composer microphone: speech is recognized on this computer (the voice
 * companion's local installation) or by the chosen cloud provider. The phrase in
 * progress appears live where the caret is and is corrected when it ends.
 * `onText` receives the dictation run so a preview is replaced only by its own run.
 * While it listens off screen (another tab or view), the workspace footer shows it.
 */
export function DictationButton({
  sessionId,
  disabled = false,
  onText,
  onError,
}: {
  /** Session whose message box receives the text, named by the off-screen indicator. */
  sessionId?: string;
  disabled?: boolean;
  onText: (text: string, final: boolean, run: object) => void;
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

  const [owner] = useState(() => Symbol("dictation"));
  const [visible, setVisible] = useState(true);
  const active = state !== "idle";

  useEffect(() => () => dictation.current?.cancel(), []);
  // A hidden pane keeps its composer mounted, so dictation can outlive the view.
  useEffect(() => {
    const element = visual.current;
    if (!active || !element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) =>
      setVisible(entries[entries.length - 1]?.isIntersecting ?? true),
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      setVisible(true);
    };
  }, [active]);
  useEffect(() => {
    if (state === "idle") return reportDictation(owner, undefined);
    reportDictation(owner, {
      sessionId,
      state,
      visible,
      stop: () => void dictation.current?.stop().catch(() => {}),
    });
  }, [owner, sessionId, state, visible]);
  useEffect(() => () => reportDictation(owner, undefined), [owner]);
  useEffect(() => {
    if (disabled || !settings.dictationEnabled) dictation.current?.cancel();
  }, [disabled, settings.dictationEnabled]);

  if (!settings.dictationEnabled) return null;

  const toggle = () => {
    const current = dictation.current;
    if (state === "finishing") {
      current?.cancel();
      return;
    }
    if (current) {
      void current.stop().catch(() => {});
      return;
    }
    const next = new Dictation(
      {
        text: (text, final) => latest.current.onText(text, final, next),
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
      dictationLanguage(settings, locale),
      voiceRuntimeSettings(settings),
      settings.microphoneId,
      settings.dictationEngine,
      settings.dictationEngine === "local"
        ? undefined
        : settings.dictationModels[settings.dictationEngine],
    );
    dictation.current = next;
    void next.start();
  };

  const listening = state === "listening";
  const label =
    state === "starting"
      ? t("Preparing dictation…")
      : state === "finishing"
        ? t("Cancel transcription")
        : listening
          ? t("Stop dictation")
          : t("Dictate");
  return (
    <span className={styles.group}>
      <Button
        variant="ghost"
        motion="none"
        iconOnly
        label={label}
        tooltip={state === "idle" ? t("Dictate: speak and the text appears here") : label}
        data-dictation-state={state}
        aria-busy={state === "starting" || state === "finishing" || undefined}
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
            <Mic className="icon-sm" strokeWidth={2} />
          ) : state === "listening" ? (
            <span className={styles.wave}>
              {[0, 1, 2, 3, 4].map((index) => (
                <i key={index} {...motionAttributes({ duration: "instant" })} />
              ))}
            </span>
          ) : (
            <Spinner size="sm" />
          )}
        </span>
      </Button>
      {/* Options apply to the next run, so they wait until this one ends. */}
      <DictationOptions settings={settings} disabled={disabled || state !== "idle"} />
    </span>
  );
}
