/** Approved local sound set, loaded only when a cue is requested. */
export type SoundName = "settle" | "knock" | "thread" | "welcome" | "touch" | "stamp";
const FILES: Record<SoundName, string> = {
  settle: "complete",
  knock: "inbox",
  thread: "activity",
  welcome: "update",
  touch: "toggle",
  stamp: "copy",
};
const MAX_VOICES = 6;
let enabled = true;
let volume = 0.55;
let muteRevision = 0;
const voices = new Set<HTMLAudioElement>();

function release(voice: HTMLAudioElement) {
  voices.delete(voice);
  voice.onended = null;
  voice.onerror = null;
  voice.pause();
  voice.removeAttribute("src");
  voice.load();
}

export function setEnabled(value: boolean) {
  if (enabled && !value) muteRevision++;
  enabled = value;
  if (enabled) return;
  for (const voice of voices) release(voice);
}

export function setVolume(value: number) {
  volume = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  for (const voice of voices) voice.volume = volume;
}

/** Locked audio or missing assets must never interrupt the user's work. */
export async function play(cue: SoundName): Promise<void> {
  if (!enabled || volume === 0 || voices.size >= MAX_VOICES) return;
  let voice: HTMLAudioElement | undefined;
  try {
    if (!globalThis.Audio) return;
    const file = FILES[cue];
    if (!file) return;
    const revision = muteRevision;
    // Native media uses the existing media-src policy; no fetch/CSP expansion.
    voice = new Audio(`${import.meta.env.BASE_URL}sounds/bycoda-v2/${file}.wav`);
    voice.volume = volume;
    const current = voice;
    voice.onended = () => release(current);
    voice.onerror = () => release(current);
    voices.add(voice);
    await voice.play();
    if (!enabled || revision !== muteRevision || !voices.has(voice)) release(voice);
  } catch {
    if (voice) release(voice);
    // No permission prompt or unhandled rejection for a decorative cue.
  }
}
