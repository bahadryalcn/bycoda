import { OverflowTooltip, Tooltip } from "../../../shared/ui/Tooltip";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Session } from "../../sessions/model/session";
import { sessionsRef as liveSessions, useSession } from "../../sessions/model/sessionsStore";
import { Button } from "../../../shared/ui/Button";
import { hasActiveOverlay, useOverlay } from "../../../shared/ui/overlay";
import {
  AppWindow,
  Globe,
  GripVertical,
  Minimize2,
  Maximize2,
  MessageSquare,
  MessageMultiple,
  Mic,
  MicOff,
  Square,
  VolumeX,
  X,
} from "../../../shared/ui/icons";
import { t, useLocale } from "../../../shared/i18n";
import { errorText } from "../../../shared/lib/errors";
import { LocalVoice, type SpeechBinding } from "../model/localVoice";
import { RealtimeVoice } from "../model/realtimeVoice";
import { realtimeSecret, type RealtimeProvider } from "../model/realtimeVoiceClient";
import {
  converseWithSession,
  warmVoiceReply,
  immediateVoiceDecision,
} from "../model/voiceConversation";
import { clampVoicePosition, voiceContext, voiceTarget } from "../model/voiceSession";
import styles from "./VoiceCompanion.module.css";
import {
  loadVoiceSettings,
  saveVoiceSettings,
  useVoiceSettings,
  voiceRuntimeSettings,
} from "../model/voiceSettings";
import { VoiceVisualizer } from "./VoiceVisualizer";
import { VoiceOptionsMenu, VoiceSessionPicker } from "./VoicePanelChoices";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { createVoiceController } from "../model/voiceController";
import { converseWithAssistant } from "../model/voiceAssistant";
import { voiceTools } from "../model/realtimeVoice";
import type { VoiceWorkspaceProject } from "../model/voiceWorkspaceActions";
import type { useVoiceWorkspaceActions } from "../../../app/workspace/bridges/useVoiceWorkspaceActions";
import { voiceVisualState } from "../model/voiceVisualState";
import { voiceWorkText } from "../model/voiceWork";
import {
  closeVoiceOverlay,
  hasNativeWindows,
  openVoiceOverlay,
  pointerOutsideWindow,
  voiceSummaryLine,
  VOICE_OVERLAY_COMPACT_SIZE,
  VOICE_OVERLAY_EXPANDED_WIDTH,
  type VoiceOverlayCommand,
  type VoiceOverlayPlacement,
} from "../model/voiceOverlay";
import { useVoiceOverlayHost } from "./useVoiceOverlayHost";
import { loadVoicePersona } from "../model/voicePersona";
import { voiceOwnerInstructions } from "../model/voiceOwner";
import { forgetVoiceNote, rememberVoiceNote } from "../model/voiceMemory";
import { VoicePersonaDialog } from "./VoicePersonaDialog";

/** Cloud speech-to-speech providers, signed in through Grok Build or Codex. */
const REALTIME: Record<"grok" | "openai", { provider: RealtimeProvider; name: string }> = {
  grok: { provider: "xai", name: "Grok Voice" },
  openai: { provider: "openai", name: "OpenAI Realtime" },
};

type SpeechTarget = { sessionId?: string; projectPath: string };
// LocalVoice copies bindings while recognition is pending; carry the immutable
// onset target with that copy without changing the accepted-turn owner yet.
const speechTarget = Symbol("voiceSpeechTarget");
type CapturedSpeechBinding = SpeechBinding & { [speechTarget]: SpeechTarget };

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
  workspace?: ReturnType<typeof useVoiceWorkspaceActions>;
  projects?: readonly VoiceWorkspaceProject[];
  projectPath?: string;
  ensureToolSession?: (projectPath: string) => Promise<string>;
  assistantSession?: Session;
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
  // First launch offers persona setup until the owner saves or skips it.
  const [welcome, setWelcome] = useState(false);
  const [status, setStatus] = useState<"idle" | "connecting" | "live">("idle");
  const [phase, setPhase] = useState<"listening" | "speaking" | "transcribing" | "replying">(
    "listening",
  );
  const [pinned, setPinned] = useState<string | null>(null);
  const [globalScope, setGlobalScope] = useState(true);
  const scopeRef = useRef(globalScope);
  scopeRef.current = globalScope;
  const turnSessionId = useRef<string | undefined>(undefined);
  const turnProjectPath = useRef("");
  const turnCaptured = useRef(false);
  const turnRevision = useRef(0);
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
  // The session stays here; `detached` only moves its controls to a native
  // always-on-top window that can float over other applications.
  const [detached, setDetached] = useState(false);
  const [detaching, setDetaching] = useState(false);
  const canDetach = hasNativeWindows();
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
  const workAttempt = useRef<{
    sessionId: string;
    text: string;
    result: Promise<{ accepted: boolean }>;
  } | null>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const shellTarget = voiceTarget(props.activeId, pinned, props.sessions);
  const target = useSession(open ? shellTarget?.id : undefined) ?? shellTarget;
  const findSession = (id: string | undefined) =>
    liveSessions.current.find((item) => item.id === id) ??
    latest.current.sessions.find((item) => item.id === id);
  const currentTarget = () => findSession(pinnedRef.current ?? latest.current.activeId);
  const controller = useRef<ReturnType<typeof createVoiceController> | null>(null);
  if (!controller.current)
    controller.current = createVoiceController(() => ({
      getScope: () => (scopeRef.current ? "global" : "session"),
      getProjects: () =>
        (latest.current.projects ?? []).filter(
          (project) =>
            scopeRef.current ||
            project.path ===
              findSession(turnCaptured.current ? turnSessionId.current : currentTarget()?.id)?.cwd,
        ),
      getSessions: () => [
        ...latest.current.sessions.filter(
          (item) => !liveSessions.current.some((live) => live.id === item.id),
        ),
        ...liveSessions.current,
      ],
      getProjectPath: () =>
        turnCaptured.current
          ? turnProjectPath.current
          : (latest.current.projectPath ?? currentTarget()?.cwd ?? ""),
      getTargetId: () => (turnCaptured.current ? turnSessionId.current : currentTarget()?.id),
      workspace: latest.current.workspace ?? {
        tools: [],
        execute: async () => {
          throw new Error("Workspace actions are unavailable.");
        },
      },
      ensureToolSession: latest.current.ensureToolSession,
      image: (dataUrl) =>
        client.current instanceof RealtimeVoice
          ? client.current.addImage(dataUrl)
          : { accepted: false, error: "This voice provider cannot inspect images." },
    }));
  function currentSpeechTarget(): SpeechTarget {
    const session = currentTarget();
    return {
      sessionId: session?.id,
      projectPath: session?.cwd ?? latest.current.projectPath ?? "",
    };
  }
  function captureTurn(snapshot: SpeechTarget) {
    turnRevision.current++;
    workAttempt.current = null;
    turnCaptured.current = true;
    turnSessionId.current = snapshot.sessionId;
    turnProjectPath.current = snapshot.projectPath;
    if (latest.current.workspace) controller.current!.captureTurn();
  }
  function submitWork(session: Session, text: string, epoch: number, active: () => boolean) {
    const previous = workAttempt.current;
    if (previous) {
      if (previous.sessionId === session.id && previous.text === text) return previous.result;
      return Promise.resolve({
        accepted: false,
        error:
          "Work was already attempted for this spoken turn. Check the session before retrying.",
      });
    }
    // Store before invoking the callback, including ambiguous failures. Rephrasing
    // or retrying a tool call is not a second user authorization.
    const result = Promise.resolve().then(async () => {
      if (generation.current !== epoch || !active()) return { accepted: false };
      const accepted = await latest.current.onSubmit(session.id, text);
      if (generation.current === epoch && accepted)
        jobs.current.set(session.id, {
          sawBusy: Boolean(session.busy),
          assistantId: session.blocks.filter((block) => block.role === "assistant").slice(-1)[0]
            ?.id,
        });
      return { accepted };
    });
    workAttempt.current = { sessionId: session.id, text, result };
    return result;
  }
  function close() {
    generation.current++;
    turnCaptured.current = false;
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
  useOverlay(panel, false, undefined, open && !detached, undefined, false, true);
  useLayoutEffect(() => {
    // The first-run persona dialog owns focus while it is open.
    if (open && welcome) return;
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
  useEffect(() => {
    // A reloaded page lost the session a floating window was mirroring.
    if (canDetach) void closeVoiceOverlay().catch(() => undefined);
  }, []);
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
  }, [open, detached]);
  async function onSpeech(text: string, binding: SpeechBinding, epoch: number) {
    if (
      generation.current !== epoch ||
      binding.sequence !== sequence.current ||
      binding.sequence <= consumedSequence.current
    )
      return;
    consumedSequence.current = binding.sequence;
    const session =
      findSession(binding.sessionId) ??
      (latest.current.workspace ? latest.current.assistantSession : undefined);
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
    const historyKey = latest.current.workspace ? "global" : session.id;
    const exchanges = history.current.get(historyKey) ?? [];
    // Accepted speech is context even if a correction supersedes its pending
    // model reply. Keep the current utterance out of its own previous exchanges.
    history.current.set(historyKey, [...exchanges, { role: "user", text }].slice(-12));
    const recordResponse = (entry: { role: string; text: string }) => {
      history.current.set(
        historyKey,
        [...(history.current.get(historyKey) ?? []), entry].slice(-12),
      );
    };
    try {
      if (latest.current.workspace) {
        const immediate = immediateVoiceDecision(text, session);
        if (immediate?.action === "silence") {
          client.current?.silence();
          return;
        }
        if (immediate?.action === "stop" && binding.sessionId) {
          latest.current.onStop(binding.sessionId);
          reply(immediate.reply, session);
          return;
        }
        const decision = await converseWithAssistant({
          session,
          transcript: text,
          context: thisController().context(),
          history: exchanges,
          signal: controller.signal,
          tools: voiceTools,
          persona: voiceOwnerInstructions(),
          execute: async (name, args) => {
            if (
              controller.signal.aborted ||
              generation.current !== epoch ||
              binding.sequence !== sequence.current
            )
              throw new Error("The spoken request is no longer active.");
            return realtimeTool(
              name,
              args,
              epoch,
              () => !controller.signal.aborted && binding.sequence === sequence.current,
            );
          },
        });
        if (
          controller.signal.aborted ||
          generation.current !== epoch ||
          binding.sequence !== sequence.current
        )
          return;
        recordResponse({ role: "assistant", text: decision.reply });
        reply(decision.reply);
        return;
      }
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
        voiceOwnerInstructions(),
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
      if (decision.action === "remember" || decision.action === "forget") {
        // Confirm only what actually changed on this device.
        const result =
          decision.action === "remember"
            ? rememberVoiceNote(decision.text)
            : forgetVoiceNote(decision.id);
        const done = "saved" in result ? result.saved : result.forgotten;
        const spoken = done
          ? decision.reply ||
            t(decision.action === "remember" ? "I'll remember that." : "Forgotten.")
          : t(("error" in result && result.error) || "Memory could not be changed.");
        recordResponse({ role: "assistant", text: spoken });
        reply(spoken, session);
        return;
      }
      if (decision.action === "submit") {
        const fresh = findSession(session.id);
        if (!fresh || fresh.historyLoading || fresh.historyLoadError || fresh.worktreeRemoved)
          throw new Error(t("The session is not ready for work."));
        const brief = voiceWorkText(decision.text ?? text);
        const receipt = {
          role: "assistant",
          text: JSON.stringify({ handoff: brief, status: "submitting" }),
        };
        recordResponse(receipt);
        const recordReceipt = (outcome: object) => {
          if (generation.current !== epoch) return;
          // Update only this receipt. A newer discussion/correction owns its
          // own history, even when the original submission resolves later.
          history.current.set(
            session.id,
            (history.current.get(session.id) ?? []).map((entry) =>
              entry === receipt
                ? { role: "assistant", text: JSON.stringify({ handoff: brief, ...outcome }) }
                : entry,
            ),
          );
        };
        let accepted: boolean;
        try {
          ({ accepted } = await submitWork(
            session,
            brief,
            epoch,
            () => !controller.signal.aborted && binding.sequence === sequence.current,
          ));
          recordReceipt({ accepted });
        } catch (cause) {
          recordReceipt({ status: "uncertain" });
          throw cause;
        }
        if (generation.current !== epoch) return;
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
        recordResponse({ role: "assistant", text: decision.reply });
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
  function thisController() {
    return controller.current!;
  }
  /** Tools of the cloud companion, with the same readiness checks as local voice. */
  async function realtimeTool(
    name: string,
    args: Record<string, unknown>,
    epoch: number,
    active: () => boolean = () => true,
  ) {
    const revision = turnRevision.current;
    const isActive = () => active() && turnRevision.current === revision;
    if (generation.current !== epoch || !isActive())
      return { error: "The voice connection is no longer active." };
    // Memory belongs to this device, not to a session or project.
    if (name === "memory_save") return rememberVoiceNote(args.text);
    if (name === "memory_forget") return forgetVoiceNote(args.id);
    if (
      latest.current.workspace &&
      [
        "app_context",
        "app_tools_list",
        "app_tool_call",
        "composer_context",
        "composer_attachment",
      ].includes(name)
    )
      return thisController().execute(name, args, () => generation.current === epoch && isActive());
    const session = findSession(turnCaptured.current ? turnSessionId.current : currentTarget()?.id);
    if (!session) return { error: "No session is selected." };
    if (name === "session_context")
      return {
        ...voiceContext(session),
        ...(latest.current.workspace ? { app: thisController().context() } : {}),
      };
    if (name === "stop_work") {
      latest.current.onStop(session.id);
      return { accepted: true, status: "stop_requested" };
    }
    if (name !== "submit_work") return { error: "Unknown tool." };
    let text: string;
    try {
      if (Object.keys(args).some((key) => key !== "text"))
        throw new Error("Unexpected work brief fields.");
      text = voiceWorkText(args.text);
    } catch (cause) {
      return { accepted: false, error: voiceError(cause, "The voice work brief is invalid.") };
    }
    const fresh = findSession(session.id);
    if (!fresh || fresh.historyLoading || fresh.historyLoadError || fresh.worktreeRemoved)
      return { accepted: false, error: "The session is not ready for work." };
    const result = await submitWork(session, text, epoch, isActive);
    // Once dispatch began, cancellation cannot undo acceptance. The realtime
    // response owner suppresses stale speech; retain the actual delivery receipt.
    return result;
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
        captureTurn: () => {
          const snapshot = currentSpeechTarget();
          return () => captureTurn(snapshot);
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
      voiceOwnerInstructions(),
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
    if (
      client.current ||
      status === "connecting" ||
      (!currentTarget() && (!latest.current.workspace || !scopeRef.current))
    )
      return;
    const epoch = ++generation.current;
    setStatus("connecting");
    setError("");
    const mode = loadVoiceSettings().mode;
    // Cloud modes replace local recognition, the reply provider and local speech.
    if (mode !== "local") return startRealtime(epoch, REALTIME[mode].provider);
    // Prime native voice enumeration before the first response.
    globalThis.speechSynthesis?.getVoices();
    // The reply provider starts in parallel with the local models.
    const warmTarget = currentTarget() ?? latest.current.assistantSession;
    if (warmTarget) void warmVoiceReply(warmTarget);
    const voice = new LocalVoice(
      {
        start: () => {
          const session = currentTarget();
          // No-op when already warm; otherwise the provider starts while the user talks.
          if (session) void warmVoiceReply(session);
          return {
            sessionId: session?.id,
            sequence: sequence.current,
            [speechTarget]: currentSpeechTarget(),
          } satisfies CapturedSpeechBinding;
        },
        accept: (binding) => {
          if (generation.current !== epoch || binding.sequence !== sequence.current) return;
          sequence.current++;
          sideRequest.current?.abort();
          sideRequest.current = null;
          setMessage("");
          captureTurn((binding as CapturedSpeechBinding)[speechTarget]);
          return { ...binding, sequence: sequence.current };
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
  function toggleMute() {
    client.current?.mute(!muted);
    setMuted(!muted);
  }
  // Compact mode's single control: start when idle, otherwise mute or resume.
  const micLabel = t(status === "idle" ? "Start voice" : muted ? "Resume" : "Pause mic");
  const micButton = (
    <Button
      iconOnly
      variant={status === "idle" || (status === "live" && !muted) ? "primary" : "secondary"}
      tone={muted ? "danger" : undefined}
      label={micLabel}
      tooltip={micLabel}
      loading={status === "connecting"}
      disabled={
        status === "idle" ? !target && (!props.workspace || !globalScope) : status !== "live"
      }
      selected={status === "live" && muted}
      aria-pressed={status === "idle" ? undefined : muted}
      onClick={() => (status === "idle" ? void start() : toggleMute())}
    >
      {muted ? <MicOff size={14} /> : <Mic size={14} />}
    </Button>
  );
  function setCompact(value: boolean) {
    saveVoiceSettings({ ...loadVoiceSettings(), compact: value });
  }
  async function popOut(placement: Omit<VoiceOverlayPlacement, "width" | "height">) {
    if (!canDetach) return;
    try {
      // The floating window measures and fits its own content after loading.
      await openVoiceOverlay({
        ...placement,
        width: compact ? VOICE_OVERLAY_COMPACT_SIZE.width : VOICE_OVERLAY_EXPANDED_WIDTH,
        height: compact
          ? VOICE_OVERLAY_COMPACT_SIZE.height
          : Math.max(VOICE_OVERLAY_COMPACT_SIZE.height, panel.current?.offsetHeight ?? 0),
      });
      setDetached(true);
    } catch (cause) {
      setError(voiceError(cause, "The floating voice window could not open."));
    }
  }
  function dock() {
    setDetached(false);
    void closeVoiceOverlay().catch(() => undefined);
  }
  function onOverlayCommand(command: VoiceOverlayCommand) {
    if (command === "start") void start();
    else if (command === "toggleMute") {
      if (status === "live") toggleMute();
    } else if (command === "silence") client.current?.silence();
    else if (command === "disconnect") close();
    else if (command === "dock") dock();
    else if (command === "close") {
      dock();
      dismiss();
    }
  }
  const scopeTitle =
    props.workspace && globalScope ? t("Global") : target?.title || t("Select a session");
  useVoiceOverlayHost({
    detached: open && detached,
    level: audioLevel,
    state: {
      status,
      visualState,
      statusText,
      title: scopeTitle,
      muted,
      working: Boolean(target?.busy),
      canStart: Boolean(target) || Boolean(props.workspace && globalScope),
      transcript,
      message,
      error,
      privacy: realtime
        ? t("Voice runs on {p1}. Audio is sent to the provider while voice is on.", {
            p1: realtime.name,
          })
        : t(
            "Audio is processed on this computer. Replies use the session’s signed-in provider. No API key required.",
          ),
    },
    onCommand: onOverlayCommand,
    // Closed natively, or its owner reloaded: bring the controls home.
    onClosed: () => setDetached(false),
  });
  const summary = voiceSummaryLine({ message, transcript, error, statusText });
  const moveLabel = t(
    canDetach
      ? "Move voice window. Drag outside the app to float it. Use arrow keys to reposition."
      : "Move voice window. Use arrow keys to reposition.",
  );
  if (open && detached)
    return (
      <div className={styles.launcher}>
        <Button
          ref={launcher}
          iconOnly
          selected
          label={t("Return voice companion to this window")}
          tooltip={t("Return voice companion to this window")}
          onClick={dock}
        >
          <AppWindow size={16} />
        </Button>
      </div>
    );
  if (!open)
    return (
      <div className={styles.launcher}>
        <Button
          ref={launcher}
          iconOnly
          label={t("Voice companion")}
          tooltip={t("Voice companion")}
          onClick={() => {
            if (loadVoicePersona().status === "unset") setWelcome(true);
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
      data-detaching={detaching || undefined}
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
          variant="ghost"
          label={moveLabel}
          tooltip={moveLabel}
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
            setDetaching(
              canDetach &&
                pointerOutsideWindow(
                  event.clientX,
                  event.clientY,
                  window.innerWidth,
                  window.innerHeight,
                ),
            );
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
          onPointerUp={(event) => {
            const grab = drag.current;
            drag.current = null;
            setDetaching(false);
            // Released beyond the app: continue as a native floating window
            // under the pointer, keeping the same grab point.
            if (
              grab &&
              canDetach &&
              pointerOutsideWindow(
                event.clientX,
                event.clientY,
                window.innerWidth,
                window.innerHeight,
              )
            ) {
              void popOut({ fromCursor: true, x: grab.x, y: grab.y });
              return;
            }
            if (position)
              try {
                localStorage.setItem("bycoda:voice-position", JSON.stringify(position));
              } catch {
                /* Optional. */
              }
          }}
          onPointerCancel={() => {
            drag.current = null;
            setDetaching(false);
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
        {compact ? (
          <div className={styles.heading}>
            <Tooltip
              asChild
              label={target?.title}
              when={target?.title && target.title !== scopeTitle ? "always" : "overflow"}
            >
              <h2 className={styles.title}>{scopeTitle}</h2>
            </Tooltip>
            {/* The live line; the status region below stays authoritative for readers. */}
            <OverflowTooltip label={summary}>
              <span className={styles.summary} aria-hidden="true">
                {summary}
              </span>
            </OverflowTooltip>
          </div>
        ) : props.workspace ? (
          // Scope first: Global manages the whole app; Session picks its target below.
          <div className={styles.session}>
            <SegmentedControl
              label={t("Voice scope")}
              value={globalScope ? "global" : "session"}
              onValueChange={(value) => {
                setGlobalScope(value === "global");
              }}
              options={[
                { value: "global", label: t("Global"), icon: <Globe size={13} /> },
                { value: "session", label: t("Session"), icon: <MessageMultiple size={13} /> },
              ]}
            />
          </div>
        ) : (
          <div className={styles.session}>
            <VoiceSessionPicker
              sessions={props.sessions}
              activeId={props.activeId}
              pinned={pinned}
              onPin={setPinned}
            />
          </div>
        )}
        {compact ? (
          micButton
        ) : (
          // Floating is rare (dragging outside the app also floats), so it lives in the menu.
          <VoiceOptionsMenu
            onFloat={
              canDetach
                ? () => {
                    const rect = panel.current?.getBoundingClientRect();
                    void popOut({ fromCursor: false, x: rect?.x ?? 0, y: rect?.y ?? 0 });
                  }
                : undefined
            }
          />
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
          <Button
            iconOnly
            label={t("Close voice companion")}
            tooltip={t("Close voice companion")}
            onClick={dismiss}
          >
            <X size={14} />
          </Button>
        )}
      </header>
      {compact && (
        <div role="status" className={styles.srOnly}>
          {error || statusText}
          {target?.busy ? ` | ${t("Agent working")}` : ""}
        </div>
      )}
      <div className={styles.body} hidden={compact}>
        {props.workspace && !globalScope && (
          <div className={styles.target}>
            <VoiceSessionPicker
              sessions={props.sessions}
              activeId={props.activeId}
              pinned={pinned}
              onPin={setPinned}
            />
          </div>
        )}
        <div className={styles.state}>
          <VoiceVisualizer
            visual={settings.visual}
            state={visualState}
            working={Boolean(target?.busy)}
            level={audioLevel}
            small
          />
          <div className={styles.stateText}>
            <div role="status" className={styles.status}>
              {statusText}
            </div>
            {target?.busy ? <span className={styles.caption}>{t("Agent working")}</span> : null}
          </div>
          {status === "idle" && (
            <InfoPopover label={t("About voice")} width={260}>
              {realtime
                ? t("Voice runs on {p1}. Audio is sent to the provider while voice is on.", {
                    p1: realtime.name,
                  })
                : t(
                    "Audio is processed on this computer. Replies use the session’s signed-in provider. No API key required.",
                  )}
            </InfoPopover>
          )}
        </div>
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
              disabled={!target && (!props.workspace || !globalScope)}
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
              {/* The mic toggle is the main live action; the rest stay icons. */}
              <Button
                variant={muted ? "secondary" : "primary"}
                tone={muted ? "danger" : undefined}
                disabled={status !== "live"}
                selected={muted}
                aria-pressed={muted}
                startIcon={muted ? <MicOff size={14} /> : <Mic size={14} />}
                onClick={toggleMute}
              >
                {t(muted ? "Resume" : "Pause mic")}
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
      {welcome ? <VoicePersonaDialog purpose="welcome" onClose={() => setWelcome(false)} /> : null}
    </section>
  );
}
