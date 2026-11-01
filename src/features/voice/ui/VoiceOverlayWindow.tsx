import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Button } from "../../../shared/ui/Button";
import {
  AppWindow,
  Maximize2,
  Minimize2,
  Mic,
  MicOff,
  Square,
  VolumeX,
  X,
} from "../../../shared/ui/icons";
import { t, useLocale } from "../../../shared/i18n";
import {
  VOICE_OVERLAY_COMMAND_EVENT,
  VOICE_OVERLAY_COMPACT_SIZE,
  VOICE_OVERLAY_EXPANDED_WIDTH,
  VOICE_OVERLAY_LEVEL_EVENT,
  VOICE_OVERLAY_STATE_EVENT,
  voiceSummaryLine,
  type VoiceOverlayCommand,
  type VoiceOverlayState,
} from "../model/voiceOverlay";
import { loadVoiceSettings, saveVoiceSettings, useVoiceSettings } from "../model/voiceSettings";
import { VoiceVisualizer } from "./VoiceVisualizer";
import styles from "./VoiceOverlayWindow.module.css";

const MOVES: Record<string, [number, number]> = {
  ArrowLeft: [-16, 0],
  ArrowRight: [16, 0],
  ArrowUp: [0, -16],
  ArrowDown: [0, 16],
};

/**
 * Always-on-top mirror of one workspace window's voice companion. It owns no
 * audio: every action is a command the workspace window carries out. Native
 * `title` tooltips are used because in-page tooltips would be clipped by this
 * small window.
 */
export function VoiceOverlayWindow({ owner }: { owner: string }) {
  useLocale();
  const settings = useVoiceSettings();
  const compact = settings.compact;
  const [state, setState] = useState<VoiceOverlayState | null>(null);
  const level = useRef(0);
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const current = getCurrentWebviewWindow();
    const subscriptions = Promise.all([
      current.listen<VoiceOverlayState>(VOICE_OVERLAY_STATE_EVENT, ({ payload }) =>
        setState(payload),
      ),
      current.listen<number>(VOICE_OVERLAY_LEVEL_EVENT, ({ payload }) => {
        level.current = Number.isFinite(payload) ? payload : 0;
      }),
    ]);
    // Ask for the current state once both listeners exist.
    void subscriptions.then(() => send("sync")).catch(() => undefined);
    return () => {
      void subscriptions.then((stops) => stops.forEach((stop) => stop())).catch(() => undefined);
    };
  }, []);

  // The native window follows the content, so expanding never clips the conversation.
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    let last = "";
    const fit = () => {
      const width = compact ? VOICE_OVERLAY_COMPACT_SIZE.width : VOICE_OVERLAY_EXPANDED_WIDTH;
      const height = compact
        ? VOICE_OVERLAY_COMPACT_SIZE.height
        : Math.ceil(element.getBoundingClientRect().height);
      const key = `${width}x${height}`;
      if (key === last) return;
      last = key;
      void invoke("voice_overlay_fit", { width, height }).catch(() => undefined);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [compact]);

  function send(command: VoiceOverlayCommand) {
    void emitTo(owner, VOICE_OVERLAY_COMMAND_EVENT, command).catch(() => undefined);
  }
  function showApp() {
    void invoke("voice_overlay_show_owner").catch(() => undefined);
  }
  function setCompact(value: boolean) {
    saveVoiceSettings({ ...loadVoiceSettings(), compact: value });
  }
  function onHandleKey(event: KeyboardEvent) {
    const move = MOVES[event.key];
    if (!move) return;
    event.preventDefault();
    void invoke("voice_overlay_nudge", { dx: move[0], dy: move[1] }).catch(() => undefined);
  }

  const status = state?.status ?? "idle";
  const muted = state?.muted ?? false;
  const statusText = state?.statusText ?? t("Connecting voice...");
  const summary = state ? voiceSummaryLine(state) : statusText;
  const moveLabel = t("Move voice window. Use arrow keys to reposition.");
  const micLabel = t(status === "idle" ? "Start voice" : muted ? "Resume" : "Pause mic");
  const backLabel = t("Return voice companion to the app");
  const sizeLabel = t(compact ? "Expand voice companion" : "Compact voice companion");

  const handle = (
    <Button
      iconOnly
      variant="ghost"
      label={moveLabel}
      title={moveLabel}
      className={styles.handle}
      onPointerDown={(event) => {
        if (event.button !== 0 || event.detail > 1) return;
        void getCurrentWebviewWindow()
          .startDragging()
          .catch(() => undefined);
      }}
      onDoubleClick={() => setCompact(!compact)}
      onKeyDown={onHandleKey}
    >
      <VoiceVisualizer
        visual={settings.visual}
        state={state?.visualState ?? "connecting"}
        working={Boolean(state?.working)}
        level={level}
        small
      />
    </Button>
  );

  return (
    <main
      ref={root}
      className={styles.panel}
      aria-label={t("Voice companion")}
      data-compact={compact || undefined}
      data-voice-state={state?.visualState}
      // Empty surface drags too; controls keep their own pointer behavior.
      onPointerDown={(event) => {
        if (event.button !== 0 || event.target !== event.currentTarget) return;
        void getCurrentWebviewWindow()
          .startDragging()
          .catch(() => undefined);
      }}
    >
      <header className={styles.header}>
        {handle}
        <div className={styles.heading}>
          <h1 className={styles.title} title={state?.title}>
            {state?.title ?? t("Voice companion")}
          </h1>
          {compact && (
            <span className={styles.summary} aria-hidden="true" title={summary}>
              {summary}
            </span>
          )}
        </div>
        {compact && (
          <Button
            iconOnly
            variant={status === "idle" || (status === "live" && !muted) ? "primary" : "secondary"}
            tone={muted ? "danger" : undefined}
            label={micLabel}
            title={micLabel}
            loading={status === "connecting"}
            disabled={!state || (status === "idle" ? !state.canStart : status !== "live")}
            selected={status === "live" && muted}
            aria-pressed={status === "idle" ? undefined : muted}
            onClick={() => send(status === "idle" ? "start" : "toggleMute")}
          >
            {muted ? <MicOff size={14} /> : <Mic size={14} />}
          </Button>
        )}
        <Button iconOnly label={backLabel} title={backLabel} onClick={() => send("dock")}>
          <AppWindow size={14} />
        </Button>
        <Button
          iconOnly
          label={sizeLabel}
          title={sizeLabel}
          aria-expanded={!compact}
          onClick={() => setCompact(!compact)}
        >
          {compact ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
        </Button>
        {!compact && (
          <Button
            iconOnly
            label={t("Close voice companion")}
            title={t("Close voice companion")}
            onClick={() => send("close")}
          >
            <X size={14} />
          </Button>
        )}
      </header>
      <div role="status" className={compact ? styles.srOnly : styles.status}>
        {state?.error || statusText}
        {state?.working ? ` | ${t("Agent working")}` : ""}
      </div>
      {!compact && (
        <div className={styles.body}>
          {status === "idle" && state?.privacy && <p className={styles.caption}>{state.privacy}</p>}
          {state?.transcript && (
            <div className={styles.turn}>
              <span className={styles.caption}>{t("You")}</span>
              <p className={styles.message}>{state.transcript}</p>
            </div>
          )}
          {state?.message && (
            <div className={styles.turn} aria-live="polite">
              <span className={styles.caption}>{t("Reply")}</span>
              <p className={styles.message}>{state.message}</p>
            </div>
          )}
          {state?.error && (
            <p role="alert" className={styles.error}>
              {state.error}
            </p>
          )}
          <div className={styles.actions}>
            {status === "idle" ? (
              <Button
                variant="primary"
                disabled={!state?.canStart}
                onClick={() => send("start")}
                startIcon={<Mic size={14} />}
              >
                {t("Start voice")}
              </Button>
            ) : status === "connecting" ? (
              <>
                <Button loading disabled>
                  {statusText}
                </Button>
                <Button
                  iconOnly
                  label={t("Cancel")}
                  title={t("Cancel")}
                  onClick={() => send("disconnect")}
                >
                  <X size={14} />
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant={muted ? "secondary" : "primary"}
                  tone={muted ? "danger" : undefined}
                  selected={muted}
                  aria-pressed={muted}
                  startIcon={muted ? <MicOff size={14} /> : <Mic size={14} />}
                  onClick={() => send("toggleMute")}
                >
                  {t(muted ? "Resume" : "Pause mic")}
                </Button>
                <Button
                  iconOnly
                  label={t("Silence")}
                  title={t("Silence")}
                  onClick={() => send("silence")}
                >
                  <VolumeX size={14} />
                </Button>
                <Button
                  iconOnly
                  label={t("Disconnect voice")}
                  title={t("Disconnect voice")}
                  onClick={() => send("disconnect")}
                >
                  <Square size={14} />
                </Button>
              </>
            )}
            <Button variant="ghost" className={styles.showApp} onClick={showApp}>
              {t("Show app")}
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
