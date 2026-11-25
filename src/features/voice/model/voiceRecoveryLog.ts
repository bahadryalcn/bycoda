import { recordUiLog } from "../../diagnostics/public/uiLog";
import { elapsedSince, monotonicNow } from "../../../shared/lib/time/timestamps";
import type { VoiceDiagnostic } from "./realtimeVoice";
import { voiceReconnectDelay } from "./voiceReconnectScheduler";

type Log = typeof recordUiLog;

// Only warnings and errors reach the persisted app log (bycoda.log); these per-session events are
// few, so they are written as warnings. Metadata only: provider messages, transcripts and tool
// arguments may contain private text and never enter these lines.

/** Persist one realtime connection diagnostic. */
export function logVoiceDiagnostic(
  provider: string,
  event: VoiceDiagnostic,
  log: Log = recordUiLog,
) {
  log("warn", "voice.connection", event.kind, { provider, ...event });
}

/**
 * Recovery metadata for the app log: attempt number and delay (mirroring `VoiceReconnectScheduler`,
 * which resets at the same points), the time from the first drop to live again, and how many
 * ledger entries the new session was seeded with.
 */
export class VoiceRecoveryLog {
  private attempt = 0;
  private scheduleStartedAt: number | undefined;
  private outageStartedAt: number | undefined;
  constructor(
    private readonly now: () => number = monotonicNow,
    private readonly log: Log = recordUiLog,
  ) {}

  /** A drop or rotation. `scheduled` is false when recovery ends in sleep instead of a retry. */
  recovering(
    info: {
      provider: string;
      rotation: boolean;
      code: string;
      speechLost: boolean;
      unansweredTurn: boolean;
    },
    scheduled = true,
  ) {
    const now = this.now();
    this.outageStartedAt ??= now;
    let delayMs: number | undefined = 0;
    if (scheduled && !info.rotation) {
      this.scheduleStartedAt ??= now;
      delayMs = voiceReconnectDelay(this.attempt, elapsedSince(this.scheduleStartedAt, now));
      if (delayMs !== undefined) this.attempt++;
    }
    this.log("warn", "voice.recovery", "realtime recovering", {
      ...info,
      scheduled,
      attempt: this.attempt,
      delayMs: scheduled ? delayMs : undefined,
      budgetSpent: scheduled && delayMs === undefined,
    });
  }

  /** The connection is live; after a drop this records the recovery duration. */
  live(info: { provider: string; reconnecting: boolean; seededWork: number }) {
    const recoveryMs =
      this.outageStartedAt === undefined
        ? undefined
        : elapsedSince(this.outageStartedAt, this.now());
    this.outageStartedAt = undefined;
    this.log("warn", "voice.recovery", info.reconnecting ? "realtime recovered" : "realtime live", {
      ...info,
      attempt: this.attempt,
      recoveryMs,
    });
  }

  /** Mirrors `VoiceReconnectScheduler.reset`: a stable connection, Stop or a new owner start. */
  reset() {
    this.attempt = 0;
    this.scheduleStartedAt = undefined;
    this.outageStartedAt = undefined;
  }
}

/** Number of ledger entries in a `VoiceWorkLedger.seed()` block (one line each after the header). */
export function voiceSeededWorkCount(seed: string) {
  return seed ? Math.max(0, seed.split("\n").length - 1) : 0;
}
