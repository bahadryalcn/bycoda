import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Button } from "../../../shared/ui/Button";
import { Heading } from "../../../shared/ui/Heading";
import {
  Maximize2,
  Minimize2,
  Mic,
  MicOff,
  Square,
  TriangleAlert,
  VolumeX,
  Volume2,
  Pause,
  X,
} from "../../../shared/ui/icons";
import { listenWindowAsync } from "../../../platform/tauri/listenWindow";
import { t, useLocale } from "../../../shared/i18n";
import {
  VOICE_OVERLAY_COMMAND_EVENT,
  VOICE_OVERLAY_CHOICE_EVENT,
  VOICE_OVERLAY_JOB_EVENT,
  VOICE_OVERLAY_ACTIVITY_EVENT,
  VOICE_OVERLAY_COMPACT_SIZE,
  VOICE_OVERLAY_EXPANDED_WIDTH,
  VOICE_OVERLAY_LEVEL_EVENT,
  VOICE_OVERLAY_STATE_EVENT,
  voiceSummaryLine,
  type VoiceOverlayCommand,
  type VoiceOverlayState,
} from "../model/voiceOverlay";
import { loadVoiceSettings, saveVoiceSettings, useVoiceSettings } from "../model/voiceSettings";
import {
  VOICE_SIDE_PANEL_GAP,
  VOICE_SIDE_PANEL_WIDTH,
  voiceOverlaySide,
  type VoiceOverlaySide,
} from "../model/voiceSidePanel";
import { VoiceTurnControl } from "./VoiceTurnControl";
import { VoiceVisualizer } from "./VoiceVisualizer";
import { VoiceCore } from "./companion/VoiceCore";
import { VoiceChatTranscript } from "./companion/VoiceChatTranscript";
import parts from "./companion/VoiceCompanionParts.module.css";
import styles from "./VoiceOverlayWindow.module.css";
import { VoiceChoiceCard } from "./VoiceChoiceCard";
import { VoiceJobReview } from "./VoiceJobReview";
import { InlineError } from "../../../shared/ui/InlineError";
import { LiveText } from "../../../shared/ui/LiveText";
import { VoiceToolActivityPanel } from "./VoiceToolActivityPanel";
import { isActionableVoiceError, voiceErrorTitle } from "./companion/VoiceErrorNotice";
import { monotonicNow } from "../../../shared/lib/time/timestamps";
import { useVoicePushToTalk } from "./useVoicePushToTalk";

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
  const [state, setState] = useState<VoiceOverlayState | null>(null);
  const [menuError, setMenuError] = useState("");
  const compact = settings.compact && !state?.choice && !state?.jobReview && !menuError;
  function menuFailed() {
    setMenuError(t("The turn mode menu could not be opened. Try again."));
  }
  function changeTurnMode(manual: boolean) {
    setMenuError("");
    send(manual ? "manualTurnEnd" : "automaticTurnEnd");
  }
  const level = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const sideScroller = useRef<HTMLElement>(null);
  const openKey = state?.choice?.id ?? state?.jobReview?.id ?? "";
  // Which way the window grows for the open question, decided once per question.
  const [sideFor, setSideFor] = useState<{ key: string; side: VoiceOverlaySide }>();
  const side = openKey && sideFor?.key === openKey ? sideFor.side : undefined;
  const beside = side === "left" || side === "right" ? side : undefined;
  useEffect(() => {
    if (!openKey) return;
    let current = true;
    invoke<{ left: number; right: number }>("voice_overlay_room")
      .then((room) => voiceOverlaySide(room))
      .catch((): VoiceOverlaySide => "inline")
      .then((next) => {
        if (current) setSideFor({ key: openKey, side: next });
      });
    return () => {
      current = false;
    };
  }, [openKey]);
  useEffect(() => {
    if (!beside) return;
    // After the card focuses its first option, bring the answer actions into view.
    const frame = requestAnimationFrame(() => {
      const node = sideScroller.current;
      if (node) node.scrollTop = node.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [openKey, beside]);
  const grownLeft = useRef(false);

  useEffect(() => {
    let disposed = false;
    const stops: (() => void)[] = [];
    const keep = (stop: () => void) => {
      if (disposed) stop();
      else stops.push(stop);
    };
    const subscriptions = Promise.all([
      listenWindowAsync<VoiceOverlayState>(VOICE_OVERLAY_STATE_EVENT, ({ payload }) =>
        setState({
          ...payload,
          activity: payload.activity?.map((entry) => ({
            ...entry,
            startedAt: monotonicNow() - (entry.elapsedMs ?? 0),
            elapsedMs:
              entry.state === "running" || entry.state === "waiting-owner"
                ? undefined
                : entry.elapsedMs,
          })),
        }),
      ).then(keep),
      listenWindowAsync<number>(VOICE_OVERLAY_LEVEL_EVENT, ({ payload }) => {
        level.current = Number.isFinite(payload) ? payload : 0;
      }).then(keep),
    ]);
    // Ask for the current state once both listeners exist.
    void subscriptions
      .then(() => {
        if (!disposed) send("sync");
      })
      .catch(() => {
        if (!disposed)
          setMenuError(t("Voice window could not connect. Return to the app and retry."));
      });
    return () => {
      disposed = true;
      stops.forEach((stop) => stop());
    };
  }, []);

  // The native window follows the content, so expanding never clips the conversation.
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    let last = "";
    // Opening on the left moves the window's left edge out, and back when it closes, so the
    // companion itself stays where it was.
    const extra = VOICE_SIDE_PANEL_WIDTH + VOICE_SIDE_PANEL_GAP;
    const left = beside === "left" && !compact;
    let shift = (grownLeft.current ? extra : 0) - (left ? extra : 0);
    grownLeft.current = left;
    const fit = () => {
      const width =
        (compact ? VOICE_OVERLAY_COMPACT_SIZE.width : VOICE_OVERLAY_EXPANDED_WIDTH) +
        (beside && !compact ? extra : 0);
      const height = compact
        ? VOICE_OVERLAY_COMPACT_SIZE.height
        : Math.ceil(element.getBoundingClientRect().height);
      const key = `${width}x${height}`;
      if (key === last && !shift) return;
      last = key;
      const shiftX = shift;
      shift = 0;
      void invoke("voice_overlay_fit", { width, height, ...(shiftX ? { shiftX } : {}) }).catch(
        () => undefined,
      );
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [compact, beside]);

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
  useVoicePushToTalk({
    enabled: status === "live",
    begin: () => {
      if (!state?.muted) return false;
      send("beginPushToTalk");
      return true;
    },
    end: () => send("endPushToTalk"),
    cancel: () => send("cancelPushToTalk"),
  });
  const speakerMuted = state?.speakerMuted ?? false;
  const speakerButton = (
    <Button
      iconOnly
      label={t(speakerMuted ? "Unmute speaker" : "Mute speaker")}
      selected={speakerMuted}
      aria-pressed={speakerMuted}
      disabled={!state}
      onClick={() => send("toggleSpeaker")}
    >
      {speakerMuted ? <VolumeX className="icon-sm" /> : <Volume2 className="icon-sm" />}
    </Button>
  );
  const statusText = state?.statusText ?? t("Connecting voice...");
  const summary = state ? voiceSummaryLine(state) : statusText;
  const moveLabel = t("Move voice window. Use arrow keys to reposition.");
  const canTalk = status === "idle" || status === "sleeping" || status === "ready";
  const micLabel = t(
    canTalk ? (status === "idle" ? "Start voice" : "Talk") : muted ? "Resume" : "Pause mic",
  );
  // One close: the floating window returns to the app and voice keeps running,
  // matching the native close. Disconnect stays an explicit body action.
  const backLabel = t("Return voice companion to the app");
  function returnToApp() {
    send("dock");
    showApp();
  }
  const sizeLabel = t(compact ? "Expand voice companion" : "Compact voice companion");

  // Questions and job review open in a panel beside the companion when the screen has room.
  const questions = (
    <>
      {state?.choice ? (
        <VoiceChoiceCard
          choice={state.choice}
          onRetry={() => {
            void emitTo(owner, VOICE_OVERLAY_CHOICE_EVENT, {
              id: state.choice!.id,
              action: "retry",
            }).catch(() => undefined);
          }}
          onReply={(reply) => {
            void emitTo(owner, VOICE_OVERLAY_CHOICE_EVENT, {
              id: state.choice!.id,
              reply,
            }).catch(() => undefined);
          }}
        />
      ) : null}
      {state?.jobReview ? (
        <VoiceJobReview
          key={state.jobReview.id}
          review={state.jobReview}
          onChange={(rows) => {
            void emitTo(owner, VOICE_OVERLAY_JOB_EVENT, {
              id: state.jobReview!.id,
              action: "change",
              rows,
            }).catch(() => undefined);
          }}
          onStart={(rows) => {
            void emitTo(owner, VOICE_OVERLAY_JOB_EVENT, {
              id: state.jobReview!.id,
              action: "start",
              rows,
            }).catch(() => undefined);
          }}
          onCancel={() => {
            void emitTo(owner, VOICE_OVERLAY_JOB_EVENT, {
              id: state.jobReview!.id,
              action: "cancel",
            }).catch(() => undefined);
          }}
        />
      ) : null}
    </>
  );

  const handle = (
    <Button
      iconOnly
      variant="ghost"
      label={moveLabel}
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
        small="icon"
      />
    </Button>
  );

  return (
    <div ref={root} className={styles.window} data-side={compact ? undefined : beside}>
      <Text
        as="main"
        size="caption"
        tone="neutral"
        leading="inherit"
        {...surfaceAttributes(
          {
            variant: state?.error ? "danger" : "plain",
            frame: state?.error ? "danger" : "neutral",
            radius: compact ? "pill" : "panel",
          },
          styles.panel,
        )}
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
        {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- Native title bar supports dragging and arrow-key movement; nested buttons retain their own actions. */}
        <header
          className={styles.header}
          tabIndex={compact ? undefined : 0}
          aria-label={compact ? undefined : moveLabel}
          onKeyDown={(event) => {
            if (!compact && event.target === event.currentTarget) onHandleKey(event);
          }}
          onPointerDown={(event) => {
            if (
              compact ||
              event.button !== 0 ||
              event.detail > 1 ||
              (event.target as Element).closest("button")
            )
              return;
            void getCurrentWebviewWindow()
              .startDragging()
              .catch(() => undefined);
          }}
          onDoubleClick={(event) => {
            if (!compact && !(event.target as Element).closest("button")) setCompact(true);
          }}
        >
          {compact && handle}
          {/* Popovers are clipped by this small window, so the mark expands it to the message. */}
          {state?.error && (
            <Button
              iconOnly
              variant="ghost"
              tone="danger"
              data-voice-error=""
              label={voiceErrorTitle(state.error)}
              onClick={() => setCompact(false)}
            >
              <TriangleAlert className="icon-sm" />
            </Button>
          )}
          <Text as="div" size="inherit" tone="inherit" leading="snug" className={styles.heading}>
            <OverflowTooltip label={state?.title}>
              <Heading size="caption" level={1} truncate>
                {state?.title ?? t("Voice companion")}
              </Heading>
            </OverflowTooltip>
            {compact && (
              <OverflowTooltip label={summary}>
                <Text size="micro" tone="secondary" leading="inherit" truncate aria-hidden="true">
                  {summary}
                </Text>
              </OverflowTooltip>
            )}
          </Text>
          {compact && status === "live" && (
            <VoiceTurnControl
              compact
              menuSurface="native"
              onMenuError={menuFailed}
              manual={state?.manualTurnEnd === true}
              muted={muted}
              onManualChange={changeTurnMode}
              onFinish={() => send("finishTurn")}
            />
          )}
          {compact && status !== "idle" && (
            <Button iconOnly label={t("Disconnect voice")} onClick={() => send("disconnect")}>
              <Square className="icon-sm" />
            </Button>
          )}
          {compact && speakerButton}
          {compact && (
            <Button
              iconOnly
              variant={canTalk || (status === "live" && !muted) ? "primary" : "secondary"}
              tone={muted ? "danger" : undefined}
              label={micLabel}
              loading={status === "connecting" || status === "reconnecting"}
              disabled={!state || (canTalk ? !state.canStart : status !== "live")}
              selected={status === "live" && muted}
              aria-pressed={canTalk ? undefined : muted}
              onClick={() => send(canTalk ? "start" : "toggleMute")}
            >
              {muted || status === "ready" || status === "sleeping" ? (
                <MicOff className="icon-sm" />
              ) : (
                <Mic className="icon-sm" />
              )}
            </Button>
          )}
          {!compact && (
            <VoiceToolActivityPanel
              entries={state?.activity ?? []}
              onStopWaiting={(id) => {
                void emitTo(owner, VOICE_OVERLAY_ACTIVITY_EVENT, id).catch(() =>
                  setMenuError(t("Voice window could not connect. Return to the app and retry.")),
                );
              }}
            />
          )}
          <Button
            iconOnly
            label={sizeLabel}
            aria-expanded={!compact}
            onClick={() => setCompact(!compact)}
          >
            {compact ? <Maximize2 className="icon-sm" /> : <Minimize2 className="icon-sm" />}
          </Button>
          <Button iconOnly label={backLabel} onClick={returnToApp}>
            <X className="icon-sm" />
          </Button>
        </header>
        <LiveText
          {...surfaceAttributes({ frame: "none" }, "sr-only")}
          size="secondary"
          weight="medium"
          leading="normal"
          text={`${compact && state?.error ? t("Voice needs attention") : statusText}${state?.working ? ` | ${state.workingStatus || t("Session working")}` : ""}`}
        />
        {!compact && (
          <>
            <div className={styles.body}>
              <div className={parts.status}>
                <VoiceCore
                  state={state?.visualState ?? "connecting"}
                  level={level}
                  name={state?.name ?? ""}
                  avatar={state?.avatar}
                />
                <div className={parts.statusText}>
                  <Text size="secondary" weight="medium" leading="snug">
                    {statusText}
                  </Text>
                  {state?.working && (
                    <Text size="caption" tone="secondary" leading="snug">
                      {state.workingStatus || t("Session working")}
                    </Text>
                  )}
                </div>
              </div>
              {menuError && (
                <InlineError
                  className={styles.feedback}
                  text={{ size: "caption", tone: "secondary", leading: "inherit" }}
                  action={<Button onClick={() => setMenuError("")}>{t("Dismiss")}</Button>}
                >
                  {menuError}
                </InlineError>
              )}
              {side === "inline" ? questions : null}
              <VoiceChatTranscript
                turns={
                  state?.chatTurns ?? [
                    ...(state?.transcript
                      ? [{ id: 0, role: "owner" as const, text: state.transcript }]
                      : []),
                    ...(state?.message
                      ? [{ id: 1, role: "assistant" as const, text: state.message }]
                      : []),
                  ]
                }
              />
              {/* Always mounted so each reply is announced when it arrives. */}
              <LiveText
                className="sr-only"
                text={state?.message ? `${t("Reply")}: ${state.message}` : ""}
              />
              {state?.error && (
                <>
                  <InlineError
                    className={styles.caption}
                    text={{ size: "caption", tone: "secondary", leading: "snug" }}
                    action={<Button onClick={() => send("dismissError")}>{t("Dismiss")}</Button>}
                  >
                    {voiceErrorTitle(state.error)}
                  </InlineError>
                  {!isActionableVoiceError(state.error) && (
                    <div className={styles.feedback}>
                      <Text as="p" size="inherit" tone="secondary" leading="normal">
                        {state.error}
                      </Text>
                    </div>
                  )}
                </>
              )}
              <LiveText
                size="caption"
                tone="secondary"
                leading="snug"
                className={styles.caption}
                text={state?.notice ?? ""}
              />
            </div>
            <div {...surfaceAttributes({ frame: "neutral", edge: "block-start" }, styles.actions)}>
              {status === "live" && (
                <VoiceTurnControl
                  menuSurface="native"
                  onMenuError={menuFailed}
                  manual={state?.manualTurnEnd === true}
                  muted={muted}
                  onManualChange={changeTurnMode}
                  onFinish={() => send("finishTurn")}
                />
              )}
              {canTalk ? (
                <>
                  <Button
                    variant="primary"
                    disabled={!state?.canStart}
                    onClick={() => send("start")}
                    startIcon={<Mic className="icon-sm" />}
                  >
                    {t(status === "idle" ? "Start voice" : "Talk")}
                  </Button>
                  {status !== "idle" && (
                    <Button
                      iconOnly
                      label={t("Disconnect voice")}
                      onClick={() => send("disconnect")}
                    >
                      <Square className="icon-sm" />
                    </Button>
                  )}
                </>
              ) : status === "connecting" || status === "reconnecting" ? (
                <Button
                  label={t("Cancel")}
                  startIcon={<X className="icon-sm" />}
                  onClick={() => send("disconnect")}
                >
                  {t("Cancel")}
                </Button>
              ) : (
                <>
                  <Button
                    iconOnly
                    label={t(muted ? "Resume" : "Pause mic")}
                    variant={muted ? "secondary" : "primary"}
                    tone={muted ? "danger" : undefined}
                    selected={muted}
                    aria-pressed={muted}
                    onClick={() => send("toggleMute")}
                  >
                    {muted ? <MicOff className="icon-sm" /> : <Mic className="icon-sm" />}
                  </Button>
                  <Button iconOnly label={t("Silence")} onClick={() => send("silence")}>
                    <Pause className="icon-sm" />
                  </Button>
                  {speakerButton}
                  <Button iconOnly label={t("Disconnect voice")} onClick={() => send("disconnect")}>
                    <Square className="icon-sm" />
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </Text>
      {beside && !compact ? (
        <Text
          as="aside"
          size="inherit"
          tone="neutral"
          ref={sideScroller}
          aria-label={t("Question")}
          {...surfaceAttributes(
            { frame: "neutral", edge: "all", radius: "panel", variant: "plain" },
            styles.side,
          )}
        >
          {questions}
        </Text>
      ) : null}
    </div>
  );
}
