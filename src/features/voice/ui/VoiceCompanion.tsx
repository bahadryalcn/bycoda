import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Session } from "../../sessions/model/session";
import { sessionsRef as liveSessions, useSession } from "../../sessions/model/sessionsStore";
import { Button } from "../../../shared/ui/Button";
import { hasActiveOverlay, useOverlay } from "../../../shared/ui/overlay";
import {
  GripVertical,
  MessageSquare,
  Pause,
  Pin,
  PinOff,
  Play,
  Square,
  X,
} from "../../../shared/ui/icons";
import { t, useLocale } from "../../../shared/i18n";
import { LocalVoice, type SpeechBinding } from "../model/localVoice";
import { converseWithSession } from "../model/voiceConversation";
import { clampVoicePosition, voiceContext, voiceTarget } from "../model/voiceSession";
import styles from "./VoiceCompanion.module.css";
import { loadVoiceSettings, voiceRuntimeSettings } from "../model/voiceSettings";

export type VoiceCompanionProps = {
  activeId?: string;
  sessions: Session[];
  onSubmit: (sessionId: string, text: string) => boolean | Promise<boolean>;
  onStop: (sessionId: string) => void;
};

export function VoiceCompanion(props: VoiceCompanionProps) {
  const locale = useLocale();
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
  const returnFocus = useRef(false);
  const client = useRef<LocalVoice | null>(null);
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
    setStatus("idle");
    setMuted(false);
    setMessage("");
    setTranscript("");
    setPhase("listening");
  }
  function dismiss() {
    close();
    returnFocus.current = true;
    setOpen(false);
  }
  useOverlay(panel, false, undefined, open, undefined, false, true);
  useLayoutEffect(() => {
    if (open) panel.current?.querySelector<HTMLButtonElement>("[data-voice-start]")?.focus();
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

  function reply(text: string, session?: Session) {
    const spoken =
      session && currentTarget()?.id !== session.id ? `${session.title}: ${text}` : text;
    setMessage(spoken);
    if (!client.current?.speak(spoken))
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
      const decision = await converseWithSession(session, text, exchanges, controller.signal);
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
        reply(decision.reply, session);
      }
    } catch (cause) {
      if (!controller.signal.aborted && generation.current === epoch)
        setError(cause instanceof Error ? cause.message : t("The voice request failed."));
    } finally {
      if (sideRequest.current === controller) {
        sideRequest.current = null;
        if (generation.current === epoch) setPhase("listening");
      }
    }
  }

  async function start() {
    if (client.current || status === "connecting" || !currentTarget()) return;
    const epoch = ++generation.current;
    setStatus("connecting");
    setError("");
    // Prime native voice enumeration before the first response.
    globalThis.speechSynthesis?.getVoices();
    const voice = new LocalVoice(
      {
        start: () => {
          sequence.current++;
          sideRequest.current?.abort();
          sideRequest.current = null;
          setMessage("");
          return { sessionId: currentTarget()?.id, sequence: sequence.current };
        },
        transcript: (result, binding) => {
          void onSpeech(result.text, binding, epoch);
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
    );
    client.current = voice;
    try {
      await voice.connect();
      if (generation.current === epoch) setStatus("live");
    } catch (cause) {
      if (generation.current !== epoch) return;
      close();
      setError(cause instanceof Error ? cause.message : t("Local voice could not start."));
    }
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
          <GripVertical size={14} />
        </Button>
        <h2 className={styles.title}>{t("Voice companion")}</h2>
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
      </header>
      <div className={styles.body}>
        <div className={styles.session}>
          <span className={styles.caption}>{t(pinned ? "Pinned session" : "Active session")}</span>
          <span className={styles.sessionName}>{target?.title || t("Select a session")}</span>
        </div>
        <div role="status" className={styles.status}>
          {t(
            status === "live"
              ? muted
                ? "Microphone paused"
                : phase === "transcribing"
                  ? "Transcribing locally..."
                  : phase === "replying"
                    ? "Preparing a reply..."
                    : phase === "speaking"
                      ? "Receiving speech..."
                      : "Listening"
              : status === "connecting"
                ? "Preparing local voice..."
                : "Ready to connect",
          )}
        </div>
        {target?.busy ? <p className={styles.work}>{t("Agent working")}</p> : null}
        {status === "idle" && (
          <p>
            {t(
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
              startIcon={<Play size={14} />}
            >
              {t("Start voice")}
            </Button>
          ) : status === "connecting" ? (
            <>
              <Button loading disabled>
                {t("Preparing local voice...")}
              </Button>
              <Button onClick={close}>{t("Cancel")}</Button>
            </>
          ) : (
            <>
              <Button
                disabled={status !== "live"}
                selected={muted}
                aria-pressed={muted}
                onClick={() => {
                  client.current?.mute(!muted);
                  setMuted(!muted);
                }}
                startIcon={muted ? <Play size={14} /> : <Pause size={14} />}
              >
                {t(muted ? "Resume" : "Pause mic")}
              </Button>
              <Button onClick={() => client.current?.silence()}>{t("Silence")}</Button>
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
