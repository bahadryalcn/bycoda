import type { VoiceVisualState } from "./voiceVisualState";
import type { VoiceChoice } from "./voiceChoices";
import type { VoiceJobReviewState } from "./voiceJobs";
import type { VoiceToolActivityEntry } from "./voiceToolActivity";

/**
 * Floating voice window protocol.
 *
 * The workspace window keeps the whole voice session (microphone, recognition,
 * playback, tools). The always-on-top window only renders this snapshot and
 * sends commands back, so closing or hiding either side never moves audio
 * ownership between webviews.
 */
export type VoiceOverlayState = {
  status: "idle" | "connecting" | "live" | "reconnecting" | "sleeping" | "ready";
  visualState: VoiceVisualState;
  statusText: string;
  title: string;
  name?: string;
  avatar?: string;
  chatTurns?: readonly { id: number; role: "owner" | "assistant"; text: string }[];
  muted: boolean;
  speakerMuted?: boolean;
  working: boolean;
  workingStatus?: string;
  activity?: readonly VoiceToolActivityEntry[];
  canStart: boolean;
  transcript: string;
  message: string;
  error: string;
  notice?: string;
  manualTurnEnd?: boolean;
  choice?: VoiceChoice | null;
  jobReview?: VoiceJobReviewState | null;
};

export const VOICE_OVERLAY_COMMANDS = [
  "sync",
  "start",
  "toggleMute",
  "toggleSpeaker",
  "beginPushToTalk",
  "endPushToTalk",
  "cancelPushToTalk",
  "finishTurn",
  "manualTurnEnd",
  "automaticTurnEnd",
  "silence",
  "dismissError",
  "disconnect",
  "dock",
  "close",
] as const;
export type VoiceOverlayCommand = (typeof VOICE_OVERLAY_COMMANDS)[number];

export const VOICE_OVERLAY_STATE_EVENT = "voice_overlay_state";
export const VOICE_OVERLAY_LEVEL_EVENT = "voice_overlay_level";
export const VOICE_OVERLAY_COMMAND_EVENT = "voice_overlay_command";
export const VOICE_OVERLAY_CHOICE_EVENT = "voice_overlay_choice";
export const VOICE_OVERLAY_JOB_EVENT = "voice_overlay_job_review";
export const VOICE_OVERLAY_ACTIVITY_EVENT = "voice_overlay_activity_stop_waiting";
/** Emitted by the native side when the overlay window is gone for any reason. */
export const VOICE_OVERLAY_CLOSED_EVENT = "voice_overlay_closed";
export const VOICE_OVERLAY_PREFIX = "voice-overlay-";

export const VOICE_OVERLAY_COMPACT_SIZE = { width: 380, height: 56 } as const;
export const VOICE_OVERLAY_EXPANDED_WIDTH = 380;

export function isVoiceOverlayCommand(value: unknown): value is VoiceOverlayCommand {
  return VOICE_OVERLAY_COMMANDS.some((command) => command === value);
}

export function voiceOverlayLabel(owner: string) {
  return `${VOICE_OVERLAY_PREFIX}${owner}`;
}

/** The overlay learns its owner from the URL Rust built; reject anything else. */
export function readVoiceOverlayOwner(
  search = typeof window === "undefined" ? "" : window.location.search,
): string | null {
  const owner = new URLSearchParams(search).get("owner");
  return owner && /^[A-Za-z0-9_-]+$/.test(owner) ? owner : null;
}

/** True while a pointer drag has left the workspace window's client area. */
export function pointerOutsideWindow(x: number, y: number, width: number, height: number): boolean {
  return x < 0 || y < 0 || x >= width || y >= height;
}

/** Latest spoken line for one-line summaries: reply first, then the user's words. */
export function voiceSummaryLine(
  state: Pick<VoiceOverlayState, "message" | "transcript" | "error" | "statusText" | "notice">,
) {
  return (state.error || state.notice || state.message || state.transcript || state.statusText)
    .replace(/\s+/g, " ")
    .trim();
}

export function hasNativeWindows() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export type VoiceOverlayPlacement = {
  /** Drag release outside the window: x/y are the grab offset under the pointer. */
  fromCursor: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
};

export async function openVoiceOverlay(placement: VoiceOverlayPlacement): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("voice_overlay_open", { placement });
}

export async function closeVoiceOverlay(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("voice_overlay_close");
}
