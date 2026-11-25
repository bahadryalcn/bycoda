import { t } from "../../../shared/i18n";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import { elapsedSince } from "../../../shared/lib/time/timestamps";
import type { VoiceWorkEntry } from "./voiceWorkLedger";

/**
 * The one gate for unprompted speech (Host narration, delegated-work updates): a live
 * conversation that is listening, a present owner, microphone and speaker on, announcements not
 * held and nothing playing.
 */
export function voiceAnnouncementsOpen(state: {
  status: string;
  presence: string;
  muted: boolean;
  speakerMuted: boolean;
  holdAnnouncements?: boolean;
  phase: string;
  /** Omit when the caller checks playback itself at delivery time. */
  playback?: boolean;
}) {
  return (
    state.status === "live" &&
    state.presence === "active" &&
    !state.muted &&
    !state.speakerMuted &&
    state.holdAnnouncements !== true &&
    state.phase === "listening" &&
    state.playback !== true
  );
}

const workName = (entry: VoiceWorkEntry) =>
  truncateGraphemes((entry.title ?? entry.action ?? entry.tool).replace(/\s+/gu, " ").trim(), 80);

/** Quoted data for a realtime model to relay in one sentence; never an instruction to act. */
export function voiceWorkEndedUpdate(entry: VoiceWorkEntry) {
  const data = {
    work: workName(entry),
    result: entry.progress === "failed" ? "failed" : "finished",
    ...(entry.sessionIds.length ? { sessionIds: entry.sessionIds.slice(0, 3) } : {}),
    ...(entry.jobIds.length ? { jobIds: entry.jobIds.slice(0, 3) } : {}),
  };
  return `Work this voice assistant started has ended. Tell the owner in one short sentence: ${JSON.stringify(data)}`;
}

/** The same update as plain speech for local voice, which reads text aloud as written. */
export function voiceWorkEndedSpeech(entry: VoiceWorkEntry) {
  return entry.progress === "failed"
    ? t("Failed: {p0}", { p0: workName(entry) })
    : t("Finished: {p0}", { p0: workName(entry) });
}

/** One unprompted update: `data` for a realtime model to relay, `speech` for local voice to read. */
export type VoiceUpdate = { id: string; data: string; speech: string };

export function voiceWorkEnded(entry: VoiceWorkEntry): VoiceUpdate {
  return {
    id: `${entry.id}:${entry.progress ?? entry.status}`,
    data: voiceWorkEndedUpdate(entry),
    speech: voiceWorkEndedSpeech(entry),
  };
}

export const VOICE_WORK_UPDATE_MAX_AGE_MS = 10 * 60 * 1000;
const MAX_PENDING = 4;

/**
 * Updates waiting for the announcement gate. The queue belongs to the companion, not to a
 * provider client, so a held update survives reconnects and is delivered on the live client.
 */
export class VoiceWorkUpdates {
  private items: { update: VoiceUpdate; at: number }[] = [];
  constructor(private readonly now: () => number = Date.now) {}

  get size() {
    return this.items.length;
  }

  /** Queue updates; a repeated id replaces the older copy. Returns the queue size. */
  add(updates: readonly VoiceUpdate[]) {
    for (const update of updates) {
      const index = this.items.findIndex((item) => item.update.id === update.id);
      if (index >= 0) this.items.splice(index, 1);
      this.items.push({ update, at: this.now() });
    }
    this.items = this.items.slice(-MAX_PENDING);
    return this.items.length;
  }

  /** Take every update that is still recent; stale news is dropped, not spoken late. */
  take(): VoiceUpdate[] {
    const now = this.now();
    const due = this.items
      .filter((item) => elapsedSince(item.at, now) <= VOICE_WORK_UPDATE_MAX_AGE_MS)
      .map((item) => item.update);
    this.items = [];
    return due;
  }

  /** Put back updates no client could accept, ahead of newer ones. */
  restore(updates: readonly VoiceUpdate[]) {
    const now = this.now();
    this.items = [...updates.map((update) => ({ update, at: now })), ...this.items].slice(
      -MAX_PENDING,
    );
  }
}
