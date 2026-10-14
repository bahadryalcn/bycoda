/** bycoda's quiet, acoustic-inspired cue family. No assets or startup playback. */
export type SoundName = "settle" | "knock" | "thread" | "welcome" | "touch" | "stamp";
type Note = readonly [frequency: number, offset: number, duration: number];
const SCORES: Record<SoundName, readonly Note[]> = {
  settle: [
    [330, 0, 0.18],
    [440, 0.085, 0.22],
    [550, 0.16, 0.24],
  ],
  knock: [
    [392, 0, 0.12],
    [392, 0.11, 0.17],
  ],
  thread: [
    [349, 0, 0.18],
    [523, 0.095, 0.21],
  ],
  welcome: [
    [294, 0, 0.19],
    [392, 0.1, 0.2],
    [494, 0.19, 0.23],
  ],
  touch: [[440, 0, 0.085]],
  stamp: [
    [523, 0, 0.09],
    [392, 0.055, 0.12],
  ],
};
const MAX_VOICES = 6;
let enabled = true;
let volume = 0.55;
let context: AudioContext | undefined;
const voices = new Set<OscillatorNode>();

export function setEnabled(value: boolean) {
  enabled = value;
  if (enabled) return;
  for (const voice of voices) {
    try {
      voice.stop();
    } catch {
      /* already ended */
    }
  }
  voices.clear();
}

export function setVolume(value: number) {
  volume = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** Unavailable or locked audio must never interrupt the user's work. */
export async function play(cue: SoundName): Promise<void> {
  if (!enabled || volume === 0) return;
  try {
    const Constructor = globalThis.AudioContext;
    if (!Constructor) return;
    if (!context || context.state === "closed") context = new Constructor();
    const audio = context;
    if (audio.state === "suspended") await audio.resume();
    if (!enabled || volume === 0 || audio.state !== "running") return;
    const score = SCORES[cue];
    if (!score || voices.size + score.length > MAX_VOICES) return;
    for (const [frequency, offset, duration] of score) {
      const oscillator = audio.createOscillator();
      const envelope = audio.createGain();
      const start = audio.currentTime + offset;
      oscillator.type = cue === "touch" || cue === "stamp" ? "sine" : "triangle";
      oscillator.frequency.setValueAtTime(frequency, start);
      envelope.gain.setValueAtTime(0, start);
      envelope.gain.linearRampToValueAtTime(volume * 0.075, start + 0.009);
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(envelope);
      envelope.connect(audio.destination);
      voices.add(oscillator);
      oscillator.onended = () => {
        voices.delete(oscillator);
        oscillator.disconnect();
        envelope.disconnect();
      };
      oscillator.start(start);
      oscillator.stop(start + duration + 0.01);
    }
  } catch {
    // No permission prompt or unhandled rejection for a decorative cue.
  }
}
