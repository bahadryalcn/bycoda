import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { t } from "../../../shared/i18n";
import type { AssistantSnapshot } from "../../../shared/model/host-contracts/assistant";
import { loadVoiceSettings } from "../model/voiceSettings";
import { mayDeliverVoiceBriefing } from "../model/voiceBriefing";
import { previewBriefing } from "../model/voiceBriefingPlayback";

type Snapshot = AssistantSnapshot | null;
type Delivery = "playing" | "delivered" | "interrupted" | "unknown";
const JOURNAL = "bycoda.voice.briefing-attempts";
function recordAttempt(identity: string, requestId: string, state: Delivery) {
  try {
    const journal = JSON.parse(localStorage.getItem(JOURNAL) ?? "{}") as Record<
      string,
      Record<string, Delivery>
    >;
    journal[identity] = { ...journal[identity], [requestId]: state };
    localStorage.setItem(JOURNAL, JSON.stringify(journal));
  } catch {
    /* Memory still fences this mounted session. */
  }
}
function hasAttempt(identity: string): boolean {
  try {
    return Boolean(JSON.parse(localStorage.getItem(JOURNAL) ?? "{}")[identity]);
  } catch {
    return false;
  }
}
type Options = {
  snapshot: Snapshot;
  owner: string;
  session?: string;
  presence: string;
  status: string;
  phase: string;
  muted: boolean;
  speakerMuted: boolean;
  hold: boolean;
  playback: RefObject<boolean>;
  pendingChoice: RefObject<unknown>;
  pendingJobs: RefObject<unknown>;
  abort: RefObject<AbortController | null>;
  generation: RefObject<number>;
  setPlayback: Dispatch<SetStateAction<boolean>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
  formatError: (cause: unknown) => string;
};

/** Exact source content participates in identity, without persisting private briefing text. */
export function briefingIdentity(id: string, createdAt: number, text: string): string {
  let a = 2166136261,
    b = 2246822519;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b ^ text.charCodeAt(i), 3266489917);
  }
  return JSON.stringify([id, createdAt, text.length, a >>> 0, b >>> 0]);
}

export function useVoiceBriefing(options: Options) {
  const {
    snapshot,
    owner,
    session,
    presence,
    status,
    phase,
    muted,
    speakerMuted,
    hold,
    playback,
    pendingChoice,
    pendingJobs,
    abort,
    generation,
    setPlayback,
    setMessage,
    setError,
    formatError,
  } = options;
  const briefing = snapshot?.briefing;
  const identity = briefing ? briefingIdentity(briefing.id, briefing.createdAt, briefing.text) : "";
  const binding = JSON.stringify([identity, owner, session, generation.current]);
  const current = useRef(binding);
  current.current = binding;
  const attempts = useRef(new Map<string, Delivery>());
  const retirement = useRef<Promise<void>>(Promise.resolve());
  const usedRequest = useRef("");
  const [retryable, setRetryable] = useState("");
  const [requested, setRequested] = useState<{ binding: string; requestId: string } | null>(null);
  const retry = () => {
    if (!identity || current.current !== binding || retryable !== binding) return;
    if (
      status !== "ready" ||
      presence !== "active" ||
      phase !== "listening" ||
      muted ||
      speakerMuted ||
      hold ||
      playback.current ||
      pendingChoice.current ||
      pendingJobs.current
    )
      return;
    abort.current?.abort();
    setRequested({ binding, requestId: crypto.randomUUID() });
  };
  useEffect(() => {
    const profile = snapshot?.profile,
      receipt = briefing?.voiceReceipt;
    if (!profile || !briefing || !receipt) return;
    const manual = requested?.binding === binding && requested.requestId !== usedRequest.current;
    if (manual) usedRequest.current = requested.requestId;
    const state = attempts.current.get(identity) ?? "pending";
    if (!manual && state !== "pending") return;
    if (
      !mayDeliverVoiceBriefing({
        profile,
        presence,
        status,
        hold: hold || muted || speakerMuted,
        hour: new Date().getHours(),
        now: manual ? briefing.createdAt : Date.now(),
        briefing,
        reason: receipt.reason,
        returnAt: receipt.returnAt,
        returnBriefingId: briefing.id,
        meaningful: receipt.meaningful,
        important: receipt.important,
        conversationBusy:
          playback.current ||
          phase !== "listening" ||
          !!pendingChoice.current ||
          !!pendingJobs.current,
        delivery: "pending",
      })
    )
      return;
    if (
      snapshot.memory.some(
        (entry) =>
          entry.active &&
          entry.kind === "rule" &&
          entry.forbiddenTerms.some((term) =>
            briefing.text.toLocaleLowerCase().includes(term.toLocaleLowerCase()),
          ),
      )
    )
      return;
    const deliveredKey = "bycoda.voice.last-briefing",
      attemptKey = "bycoda.voice.last-briefing-attempt";
    try {
      const delivered = localStorage.getItem(deliveredKey),
        attempted = localStorage.getItem(attemptKey);
      if (delivered === briefing.id) {
        localStorage.setItem(deliveredKey, identity);
        return;
      }
      if (attempted === briefing.id) localStorage.setItem(attemptKey, identity);
      if (delivered === identity) return;
      if (
        !manual &&
        (hasAttempt(identity) || attempted === identity || attempted === briefing.id)
      ) {
        setRetryable(binding);
        return;
      }
      if (!manual) localStorage.setItem(attemptKey, identity);
    } catch {
      /* Mounted attempt tracking remains authoritative. */
    }
    const controller = new AbortController();
    const requestId = manual ? requested.requestId : crypto.randomUUID();
    recordAttempt(identity, requestId, "playing");
    if (state !== "pending") attempts.current.set(`${identity}:${requestId}:prior`, state);
    attempts.current.set(identity, "playing");
    abort.current = controller;
    setRetryable("");
    const previous = retirement.current;
    const epoch = generation.current;
    const isCurrent = () =>
      !controller.signal.aborted && current.current === binding && generation.current === epoch;
    const invitation = t("Press Talk when you want to answer.");
    const work = (async () => {
      await previous;
      if (!isCurrent()) return;
      await previewBriefing(
        loadVoiceSettings(),
        profile.language,
        profile.name,
        controller.signal,
        () => {
          if (isCurrent()) setMessage(`${briefing.text}\n${invitation}`);
        },
        `${briefing.text}\n${invitation}`,
        (active) => {
          if (isCurrent()) setPlayback(active);
        },
        { complete: true, languageHint: snapshot.lastSpokenLanguage ?? undefined },
      );
      if (!isCurrent()) return;
      attempts.current.set(identity, "delivered");
      recordAttempt(identity, requestId, "delivered");
      try {
        localStorage.setItem(deliveredKey, identity);
      } catch {
        /* Mounted dedupe remains. */
      }
    })().catch((cause) => {
      if (isCurrent()) {
        attempts.current.set(identity, "unknown");
        recordAttempt(identity, requestId, "unknown");
        playback.current = false;
        setPlayback(false);
        setRetryable(binding);
        setError(formatError(cause));
      }
    });
    retirement.current = work;
    return () => {
      if (attempts.current.get(identity) === "playing") {
        attempts.current.set(identity, "interrupted");
        recordAttempt(identity, requestId, "interrupted");
        setRetryable(binding);
      }
      controller.abort();
      if (abort.current === controller) abort.current = null;
      playback.current = false;
      setPlayback(false);
    };
  }, [
    binding,
    requested,
    presence,
    status,
    phase,
    muted,
    speakerMuted,
    hold,
    snapshot?.lastSpokenLanguage,
  ]);
  return {
    retry,
    /** True while this briefing is being spoken. */
    delivering: () => attempts.current.get(identity) === "playing",
    retryable: retryable === binding,
    canRetry:
      status === "ready" &&
      presence === "active" &&
      phase === "listening" &&
      !muted &&
      !speakerMuted &&
      !hold &&
      !playback.current &&
      !pendingChoice.current &&
      !pendingJobs.current,
  };
}
