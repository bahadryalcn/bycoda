import type { AssistantProfile } from "../../../shared/model/host-contracts/assistant";
import { voiceQuietHours } from "./voiceBriefing";

export const VOICE_RETURN_CALL_DEFAULT_SECONDS = 20;

/** The listening window in milliseconds, clamped to the 5 to 120 second setting range. */
export function voiceReturnCallWindowMs(seconds: number | undefined): number {
  const value = Number.isFinite(seconds) ? Math.round(seconds as number) : 20;
  return Math.min(120, Math.max(5, value)) * 1_000;
}

export type VoiceReturnCallState = {
  enabled: boolean;
  /** Voice is on, configured and has a conversation target. */
  available: boolean;
  profile: Pick<
    AssistantProfile,
    "quietStart" | "quietEnd" | "setupComplete" | "voiceSetupComplete"
  > | null;
  presence: string;
  /** The assistant's manual presence: away and do-not-disturb never receive a call. */
  manualPresence?: string;
  status: string;
  muted: boolean;
  speakerMuted: boolean;
  hour: number;
};

/** The owner opted in; every other condition is a reason to stay silent. */
export function mayCallOnReturn(state: VoiceReturnCallState): boolean {
  const { profile } = state;
  return (
    state.enabled &&
    state.available &&
    !!profile?.setupComplete &&
    !!profile.voiceSetupComplete &&
    state.presence === "active" &&
    state.manualPresence !== "away" &&
    state.manualPresence !== "dnd" &&
    state.status === "ready" &&
    !state.muted &&
    !state.speakerMuted &&
    !voiceQuietHours(profile as AssistantProfile, state.hour)
  );
}

export type VoiceReturnCallPorts = {
  /** Re-read at every step; false ends the call without a notice. */
  eligible(): boolean;
  /** Speak the greeting, or wait for the pending return briefing that replaces it. */
  greet(signal: AbortSignal): Promise<void>;
  /** Open capture. True once the microphone is live. */
  open(signal: AbortSignal): Promise<boolean>;
  /** Close capture back to Ready. */
  close(): void;
  /** Show the on-screen notice and send the assistant notification. */
  missed(): void;
};

/**
 * One return call: greet, open capture for a bounded window, and report a missed call when no
 * accepted owner speech arrives. Starting another call or `cancel` fences every earlier step, so
 * a stale timer can never open or close capture.
 */
export class VoiceReturnCall {
  private run = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private abort: AbortController | undefined;
  private listening = false;
  constructor(
    private ports: VoiceReturnCallPorts,
    private windowMs: () => number,
  ) {}

  get busy() {
    return !!this.abort;
  }

  async begin(): Promise<void> {
    if (this.abort || !this.ports.eligible()) return;
    const id = ++this.run;
    const controller = (this.abort = new AbortController());
    const current = () => this.run === id && !controller.signal.aborted;
    try {
      await this.ports.greet(controller.signal);
      if (!current() || !this.ports.eligible()) return this.finish(id);
      if (!(await this.ports.open(controller.signal)) || !current()) return this.finish(id);
      this.listening = true;
      this.timer = setTimeout(() => {
        if (!current()) return;
        this.finish(id);
        this.ports.close();
        this.ports.missed();
      }, this.windowMs());
    } catch {
      this.finish(id);
    }
  }

  /** Accepted owner speech: the normal conversation continues and no call is missed. */
  answered() {
    if (this.listening) this.finish(this.run);
  }

  cancel() {
    this.run++;
    this.abort?.abort();
    this.finish(this.run);
  }

  private finish(id: number) {
    if (this.run !== id) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.listening = false;
    this.abort = undefined;
  }
}
