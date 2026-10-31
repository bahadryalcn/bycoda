import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Session } from "../../sessions/model/session";
import { sessionsRef as liveSessions, useSession } from "../../sessions/model/sessionsStore";
import { Button } from "../../../shared/ui/Button";
import { hasActiveOverlay, useOverlay } from "../../../shared/ui/overlay";
import {
  GripVertical,
  Minimize2,
  Maximize2,
  MessageSquare,
  Mic,
  MicOff,
  Pin,
  PinOff,
  Square,
  VolumeX,
  X,
} from "../../../shared/ui/icons";
import { t, useLocale } from "../../../shared/i18n";
import { errorText } from "../../../shared/lib/errors";
import { LocalVoice, type SpeechBinding } from "../model/localVoice";
import { RealtimeVoice } from "../model/realtimeVoice";
import { realtimeSecret, type RealtimeProvider } from "../model/realtimeVoiceClient";
import { converseWithSession, warmVoiceReply } from "../model/voiceConversation";
import { clampVoicePosition, voiceContext, voiceTarget } from "../model/voiceSession";
import styles from "./VoiceCompanion.module.css";
import {
  loadVoiceSettings,
  saveVoiceSettings,
  useVoiceSettings,
  voiceRuntimeSettings,
} from "../model/voiceSettings";
import { VoiceVisualizer } from "./VoiceVisualizer";
import { VoicePanelChoices } from "./VoicePanelChoices";
import { voiceVisualState } from "../model/voiceVisualState";

/** Cloud speech-to-speech providers, signed in through Grok Build or Codex. */
const REALTIME: Record<"grok" | "openai", { provider: RealtimeProvider; name: string }> = {
  grok: { provider: "xai", name: "Grok Voice" },
  openai: { provider: "openai", name: "OpenAI Realtime" },
};

/** Host RPC rejections arrive as strings; keep their reason instead of a generic fallback. */
function voiceError(cause: unknown, fallback: string): string {
  const message = cause == null ? "" : errorText(cause).trim();
  return t(message && message !== "[object Object]" ? message : fallback);
}
export type VoiceCompanionProps = {
  activeId?: string;
  sessions: Session[];
  onSubmit: (sessionId: string, text: string) => boolean | Promise<boolean>;
  onStop: (sessionId: string) => void;
};
export function VoiceCompanion(props: VoiceCompanionProps) {
  const locale = useLocale();
  const settings = useVoiceSettings();
  const compact = settings.compact;
  const [playback, setPlayback] = useState(false);
  // The visualizer reads this ref; audio frames never schedule React renders.
  const audioLevel = useRef(0);
  const latest = useRef(props);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "connecting" | "live">("idle");
  const [phase, setPhase] = useState<"listening" | "speaking" | "transcribing" | "replying">(
    "listening",
  );
  const [pinned, setPinned] = useState<string | null>(null);
  const pinnedRef = useRef(pinned);
  useLayoutEffect(() => {
    latest.current = props;
    pinnedRef.current = pinned;
  }, [props, pinned]);
  const [muted, setMuted] = useState(false);
  const [message, setMessage] = useState("");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const panel = useRef<HTMLElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const compactToggle = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (open && panel.current?.contains(document.activeElement)) compactToggle.current?.focus();
  }, [compact]);
  const returnFocus = useRef(false);
  const client = useRef<LocalVoice | RealtimeVoice | null>(null);
  const realtime = settings.mode === "local" ? undefined : REALTIME[settings.mode];
  const generation = useRef(0);
  const sequence = useRef(0);
  const consumedSequence = useRef(0);
  const sideRequest = useRef<AbortController | null>(null);
  const history = useRef(new Map<string, { role: string; text: string }[]>());
  const jobs = useRef(new Map<string, { sawBusy: boolean; assistantId?: string }>());
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const shellTarget = voiceTarget(props.activeId, pinned, props.sessions);
  const target = useSession(open ? shellTarget?.id : undefined) ?? shellTarget;
  const findSession = (id: string | undefined) =>
    liveSessions.current.find((item) => item.id === id) ??
    latest.current.sessions.find((item) => item.id === id);
  const currentTarget = () => findSession(pinnedRef.current ?? latest.current.activeId);
  function close() {
    generation.current++;
    sequence.current++;
    sideRequest.current?.abort();
    sideRequest.current = null;
    client.current?.close();
    client.current = null;
    jobs.current.clear();
    history.current.clear();
    setPlayback(false);
    setStatus("idle");
    setMuted(false);
    setMessage("");
    setTranscript("");
    setPhase("listening");
  }
  // Choosing another conversation or voice ends a live connection; the panel stays
  // open and Start voice connects with the new choice.
  const connection = JSON.stringify({
    ...voiceRuntimeSettings(settings),
    mode: settings.mode,
    speaker: settings.mode === "local" ? undefined : settings.speakers[settings.mode],
  });
  const connected = useRef(connection);
  useEffect(() => {
    if (connected.current === connection) return;
    connected.current = connection;
    if (client.current) close();
  }, [connection]);
  function dismiss() {
    close();
    returnFocus.current = true;
    setOpen(false);
  }
  useOverlay(panel, false, undefined, open, undefined, false, true);
  useLayoutEffect(() => {
    if (open)
      (compact
        ? compactToggle.current
        : panel.current?.querySelector<HTMLButtonElement>("[data-voice-start]")
      )?.focus();
    else if (returnFocus.current) {
      launcher.current?.focus();
      returnFocus.current = false;
    }
  }, [open]);
  useEffect(
    () => () => {
      generation.current++;
      sideRequest.current?.abort();
      client.current?.close();
    },
    [],
  );
  /** `append` continues a streamed reply after the sentences already shown and queued. */
  function reply(text: string, session?: Session, append = false) {
    const spoken =
      !append && session && currentTarget()?.id !== session.id ? `${session.title}: ${text}` : text;
    setMessage((current) => (append && current ? `${current} ${spoken}` : spoken));
    if (!client.current?.speak(spoken, append) && !append)
      setError(t("No local voice is available for this language. The reply is shown here."));
  }
  useEffect(() => {
    for (const [id, job] of jobs.current) {
      const session = findSession(id);
      if (!session) {
        jobs.current.delete(id);
        continue;
      }
      if (session.busy) job.sawBusy = true;
      const assistant = session.blocks.filter((block) => block.role === "assistant").slice(-1)[0];
      if (
        job.sawBusy &&
        !session.busy &&
        !session.historyLoading &&
        assistant &&
        assistant.id !== job.assistantId &&
        !assistant.streaming
      ) {
        const context = voiceContext(session);
        const last = context.messages
          .filter((block) => block.role === "assistant")
          .slice(-1)[0]?.text;
        // Do not interrupt the user's newer question; results remain in their original session.
        if (phase === "listening" && !sideRequest.current) {
          jobs.current.delete(id);
          reply(`${context.title}: ${t("Agent turn ended.")} ${last?.slice(0, 400) ?? ""}`);
        }
      }
    }
  }, [props.sessions, target, phase]);
  useEffect(() => {
    if (!open) return;
    const clamp = () => {
      const rect = panel.current?.getBoundingClientRect();
      if (rect)
        setPosition(
          clampVoicePosition(
            rect.x,
            rect.y,
            rect.width,
            rect.height,
            window.innerWidth,
            window.innerHeight,
          ),
        );
    };
    const frame = requestAnimationFrame(clamp);
    window.addEventListener("resize", clamp);
    const observer = new ResizeObserver(clamp);
    if (panel.current) observer.observe(panel.current);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", clamp);
    };
  }, [open]);
  async function onSpeech(text: string, binding: SpeechBinding, epoch: number) {
    if (
      generation.current !== epoch ||
      binding.sequence !== sequence.current ||
      binding.sequence <= consumedSequence.current
    )
      return;
    consumedSequence.current = binding.sequence;
    const session = findSession(binding.sessionId);
    if (!session) {
      setError(t("Select a session and speak again."));
      return;
    }
    setTranscript(text);
    setError("");
    setPhase("replying");
    const controller = new AbortController();
    sideRequest.current?.abort();
    sideRequest.current = controller;
    try {
      const exchanges = history.current.get(session.id) ?? [];
      let streamed = false;
      const decision = await converseWithSession(
        session,
        text,
        exchanges,
        controller.signal,
        (sentence) => {
          // Speak from the first finished sentence; a newer utterance aborts the rest.
          if (generation.current !== epoch || binding.sequence !== sequence.current) return;
          reply(sentence, session, streamed);
          streamed = true;
        },
      );
      if (
        controller.signal.aborted ||
        generation.current !== epoch ||
        binding.sequence !== sequence.current
      )
        return;
      if (decision.action === "silence") {
        client.current?.silence();
        return;
      }
      if (decision.action === "stop") {
        latest.current.onStop(session.id);
        reply(decision.reply, session);
        return;
      }
      if (decision.action === "submit") {
        const fresh = findSession(session.id);
        if (!fresh || fresh.historyLoading || fresh.historyLoadError || fresh.worktreeRemoved)
          throw new Error(t("The session is not ready for work."));
        const accepted = await latest.current.onSubmit(session.id, text);
        if (generation.current !== epoch) return;
        if (accepted)
          jobs.current.set(session.id, {
            sawBusy: Boolean(session.busy),
            assistantId: session.blocks.filter((block) => block.role === "assistant").slice(-1)[0]
              ?.id,
          });
        if (binding.sequence === sequence.current)
          reply(
            t(
              accepted
                ? "Accepted. You can keep talking while the agent works."
                : "The request was not accepted. Check the session.",
            ),
            session,
          );
      } else {
        history.current.set(
          session.id,
          [...exchanges, { role: "user", text }, { role: "assistant", text: decision.reply }].slice(
            -6,
          ),
        );
        // A streamed reply is already shown and queued for speech.
        if (!streamed) reply(decision.reply, session);
      }
    } catch (cause) {
      if (!controller.signal.aborted && generation.current === epoch)
        setError(voiceError(cause, "The voice request failed."));
    } finally {
      if (sideRequest.current === controller) {
        sideRequest.current = null;
        if (generation.current === epoch) setPhase("listening");
      }
      // A reply consumes the warm provider process; prepare the next one now.
      if (generation.current === epoch) void warmVoiceReply(session);
    }
  }
  /** Tools of the cloud companion, with the same readiness checks as local voice. */
  async function realtimeTool(name: string, args: Record<string, unknown>, epoch: number) {
    const session = currentTarget();
    if (!session) return { error: "No session is selected." };
    if (name === "session_context") return voiceContext(session);
    if (name === "stop_work") {
      latest.current.onStop(session.id);
      return { stopped: true };
    }
    if (name !== "submit_work") return { error: "Unknown tool." };
    const text = typeof args.text === "string" ? args.text.trim().slice(0, 16000) : "";
    if (!text) return { accepted: false, error: "The request was empty." };
    const fresh = findSession(session.id);
    if (!fresh || fresh.historyLoading || fresh.historyLoadError || fresh.worktreeRemoved)
      return { accepted: false, error: "The session is not ready for work." };
    const accepted = await latest.current.onSubmit(session.id, text);
    if (generation.current !== epoch) return { accepted: false };
    if (accepted)
      jobs.current.set(session.id, {
        sawBusy: Boolean(session.busy),
        assistantId: session.blocks.filter((block) => block.role === "assistant").slice(-1)[0]?.id,
      });
    return { accepted };
  }
  async function startRealtime(epoch: number, provider: RealtimeProvider) {
    const voice = new RealtimeVoice(
      provider,
      {
        state: (value) => {
          if (generation.current !== epoch) return;
          if (value === "speaking") setMessage("");
          setPhase(value);
        },
        reply: (text, append) => {
          if (generation.current === epoch)
            setMessage((current) => (append ? current + text : text));
        },
        transcript: (text) => {
          if (generation.current === epoch) setTranscript(text);
        },
        playback: (active) => {
          if (generation.current === epoch) setPlayback(active);
        },
        tool: (name, args) => realtimeTool(name, args, epoch),
        error: (value, fatal) => {
          if (generation.current !== epoch) return;
          if (fatal) close();
          setError(t(value));
        },
      },
      locale.split("-")[0],
      audioLevel,
      settings.speakers[settings.mode === "grok" ? "grok" : "openai"],
    );
    client.current = voice;
    try {
      const secret = await realtimeSecret(provider);
      if (generation.current !== epoch) return;
      await voice.connect(secret);
      if (generation.current === epoch) setStatus("live");
    } catch (cause) {
      if (generation.current !== epoch) return;
      close();
      setError(voiceError(cause, "Voice could not connect."));
    }
  }
  async function start() {
    if (client.current || status === "connecting" || !currentTarget()) return;
    const epoch = ++generation.current;
    setStatus("connecting");
    setError("");
    const mode = loadVoiceSettings().mode;
    // Cloud modes replace local recognition, the reply provider and local speech.
    if (mode !== "local") return startRealtime(epoch, REALTIME[mode].provider);
    // Prime native voice enumeration before the first response.
    globalThis.speechSynthesis?.getVoices();
    // The reply provider starts in parallel with the local models.
    void warmVoiceReply(currentTarget()!);
    const voice = new LocalVoice(
      {
        start: () => {
          sequence.current++;
          sideRequest.current?.abort();
          sideRequest.current = null;
          setMessage("");
          const session = currentTarget();
          // No-op when already warm; otherwise the provider starts while the user talks.
          if (session) void warmVoiceReply(session);
          return { sessionId: session?.id, sequence: sequence.current };
        },
        transcript: (result, binding) => {
          void onSpeech(result.text, binding, epoch);
        },
        playback: (active) => {
          if (generation.current === epoch) setPlayback(active);
        },
        state: (value) => {
          if (generation.current === epoch && !sideRequest.current) setPhase(value);
        },
        error: (value, fatal) => {
          if (generation.current === epoch) {
            if (fatal) close();
            setError(t(value));
          }
        },
      },
      locale.split("-")[0],
      voiceRuntimeSettings(loadVoiceSettings()),
      audioLevel,
    );
    client.current = voice;
    try {
      await voice.connect();
      if (generation.current === epoch) setStatus("live");
    } catch (cause) {
      if (generation.current !== epoch) return;
      close();
      setError(voiceError(cause, "Local voice could not start."));
    }
  }
  const visualState = voiceVisualState({ status, phase, muted, playback, error });
  const statusText = t(
    status === "live"
      ? muted
        ? "Microphone paused"
        : playback
          ? "Assistant speaking"
          : phase === "transcribing"
            ? "Transcribing locally..."
            : phase === "replying"
              ? "Preparing a reply..."
              : phase === "speaking"
                ? "Receiving speech..."
                : "Listening"
      : status === "connecting"
        ? realtime
          ? "Connecting voice..."
          : "Preparing local voice..."
        : "Ready to connect",
  );
  function setCompact(value: boolean) {
    saveVoiceSettings({ ...loadVoiceSettings(), compact: value });
  }
  if (!open)
    return (
      <div className={styles.launcher}>
        <Button
          ref={launcher}
          iconOnly
          label={t("Voice companion")}
          tooltip={t("Voice companion")}
          onClick={() => {
            try {
              const saved = JSON.parse(localStorage.getItem("bycoda:voice-position") ?? "null") as {
                x?: unknown;
                y?: unknown;
              } | null;
              if (
                typeof saved?.x === "number" &&
                Number.isFinite(saved.x) &&
                typeof saved.y === "number" &&
                Number.isFinite(saved.y)
              )
                setPosition({ x: saved.x, y: saved.y });
            } catch {
              /* Position storage is optional. */
            }
            setOpen(true);
          }}
        >
          <MessageSquare size={16} />
        </Button>
      </div>
    );
  return (
    <section
      ref={panel}
      aria-label={t("Voice companion")}
      className={styles.panel}
      data-compact={compact || undefined}
      data-voice-state={visualState}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented && !hasActiveOverlay()) {
          event.preventDefault();
          event.stopPropagation();
          dismiss();
        }
      }}
      style={
        position ? { left: position.x, top: position.y, right: "auto", bottom: "auto" } : undefined
      }
    >
      <header className={styles.header}>
        <Button
          iconOnly
          label={t("Move voice window. Use arrow keys to reposition.")}
          tooltip={t("Move voice window. Use arrow keys to reposition.")}
          className={styles.drag}
          onDoubleClick={() => {
            if (compact) setCompact(false);
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            const rect = panel.current!.getBoundingClientRect();
            drag.current = {
              pointerId: event.pointerId,
              x: event.clientX - rect.x,
              y: event.clientY - rect.y,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!drag.current || drag.current.pointerId !== event.pointerId) return;
            const rect = panel.current!.getBoundingClientRect();
            setPosition(
              clampVoicePosition(
                event.clientX - drag.current.x,
                event.clientY - drag.current.y,
                rect.width,
                rect.height,
                window.innerWidth,
                window.innerHeight,
              ),
            );
          }}
          onPointerUp={() => {
            drag.current = null;
            if (position)
              try {
                localStorage.setItem("bycoda:voice-position", JSON.stringify(position));
              } catch {
                /* Optional. */
              }
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onKeyDown={(event) => {
            const moves: Record<string, [number, number]> = {
              ArrowLeft: [-16, 0],
              ArrowRight: [16, 0],
              ArrowUp: [0, -16],
              ArrowDown: [0, 16],
            };
            const move = moves[event.key];
            if (!move) return;
            event.preventDefault();
            const rect = panel.current!.getBoundingClientRect();
            const next = clampVoicePosition(
              rect.x + move[0],
              rect.y + move[1],
              rect.width,
              rect.height,
              window.innerWidth,
              window.innerHeight,
            );
            setPosition(next);
            try {
              localStorage.setItem("bycoda:voice-position", JSON.stringify(next));
            } catch {
              /* Optional. */
            }
          }}
        >
          {compact ? (
            <VoiceVisualizer
              visual={settings.visual}
              state={visualState}
              working={Boolean(target?.busy)}
              level={audioLevel}
              small
            />
          ) : (
            <GripVertical size={14} />
          )}
        </Button>
        <h2 className={styles.title} title={target?.title}>
          {compact ? target?.title || t("Select a session") : t("Voice companion")}
        </h2>
        {compact && (
          <Button
            iconOnly
            label={t(muted ? "Resume" : "Pause mic")}
            tooltip={t(muted ? "Resume" : "Pause mic")}
            disabled={status !== "live"}
            selected={muted}
            aria-pressed={muted}
            onClick={() => {
              client.current?.mute(!muted);
              setMuted(!muted);
            }}
          >
            {muted ? <MicOff size={14} /> : <Mic size={14} />}
          </Button>
        )}
        <Button
          ref={compactToggle}
          iconOnly
          label={t(compact ? "Expand voice companion" : "Compact voice companion")}
          tooltip={t(compact ? "Expand voice companion" : "Compact voice companion")}
          aria-expanded={!compact}
          onClick={() => setCompact(!compact)}
        >
          {compact ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
        </Button>
        {!compact && (
          <>
            <Button
              iconOnly
              label={t(pinned ? "Follow active session" : "Pin to this session")}
              tooltip={t(pinned ? "Follow active session" : "Pin to this session")}
              selected={Boolean(pinned)}
              aria-pressed={Boolean(pinned)}
              disabled={!target && !pinned}
              onClick={() => setPinned(pinned ? null : (target?.id ?? null))}
            >
              {pinned ? <Pin size={14} /> : <PinOff size={14} />}
            </Button>
            <Button
              iconOnly
              label={t("Close voice companion")}
              tooltip={t("Close voice companion")}
              onClick={dismiss}
            >
              <X size={14} />
            </Button>
          </>
        )}
      </header>
      {compact && (
        <div role="status" className={styles.srOnly}>
          {error || statusText}
          {target?.busy ? ` | ${t("Agent working")}` : ""}
        </div>
      )}
      <div className={styles.body} hidden={compact}>
        {!compact && (
          <div className={styles.visual}>
            <VoiceVisualizer
              visual={settings.visual}
              state={visualState}
              working={Boolean(target?.busy)}
              level={audioLevel}
            />
          </div>
        )}
        <VoicePanelChoices
          sessions={props.sessions}
          activeId={props.activeId}
          pinned={pinned}
          onPin={setPinned}
        />
        <div role="status" className={styles.status}>
          {statusText}
        </div>
        {target?.busy ? <p className={styles.work}>{t("Agent working")}</p> : null}
        {status === "idle" && (
          <p>
            {realtime
              ? t("Voice runs on {p1}. Audio is sent to the provider while voice is on.", {
                  p1: realtime.name,
                })
              : t(
                  "Audio is processed on this computer. Replies use the session’s signed-in provider. No API key required.",
                )}
          </p>
        )}
        {transcript && (
          <div className={styles.turn}>
            <span className={styles.caption}>{t("You")}</span>
            <p className={styles.message}>{transcript}</p>
          </div>
        )}
        {message && (
          <div className={styles.turn} aria-live="polite">
            <span className={styles.caption}>{t("Reply")}</span>
            <p className={styles.message}>{message}</p>
          </div>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <div className={styles.actions}>
          {status === "idle" ? (
            <Button
              variant="primary"
              data-voice-start
              disabled={!target}
              onClick={() => void start()}
              startIcon={<Mic size={14} />}
            >
              {t("Start voice")}
            </Button>
          ) : status === "connecting" ? (
            <>
              <Button loading disabled>
                {t(realtime ? "Connecting voice..." : "Preparing local voice...")}
              </Button>
              <Button iconOnly label={t("Cancel")} tooltip={t("Cancel")} onClick={close}>
                <X size={14} />
              </Button>
            </>
          ) : (
            <>
              {/* Icon actions; names stay in labels and tooltips. */}
              <Button
                iconOnly
                label={t(muted ? "Resume" : "Pause mic")}
                tooltip={t(muted ? "Resume" : "Pause mic")}
                disabled={status !== "live"}
                selected={muted}
                aria-pressed={muted}
                onClick={() => {
                  client.current?.mute(!muted);
                  setMuted(!muted);
                }}
              >
                {muted ? <MicOff size={14} /> : <Mic size={14} />}
              </Button>
              <Button
                iconOnly
                label={t("Silence")}
                tooltip={t("Silence")}
                onClick={() => client.current?.silence()}
              >
                <VolumeX size={14} />
              </Button>
              <Button
                iconOnly
                label={t("Disconnect voice")}
                tooltip={t("Disconnect voice")}
                onClick={close}
              >
                <Square size={14} />
              </Button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
