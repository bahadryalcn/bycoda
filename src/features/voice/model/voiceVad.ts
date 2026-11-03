/** Per-frame speech evidence: loudness and voicing (pitch periodicity). */
export type FrameFeatures = { rms: number; periodicity: number };

/**
 * Onset tuning, chosen on FLEURS speech (en/tr/de/fr/es) against synthetic
 * breaths, fan/hum backgrounds and typing (temp/local/voice-vad/README.md).
 */
export const VAD_TUNING = {
  /** Below this, a frame is never speech, whatever the room noise. */
  minRms: 0.012,
  /** Speech must be this many times louder than the tracked background. */
  floorRatio: 2.5,
  /** Normalized autocorrelation peak (70–400 Hz pitch) of a voiced frame: 97% of
   * loud speech frames reach it; breath and hiss stay near 0.1–0.15. */
  minPeriodicity: 0.35,
  /** Normal onset: this much voiced speech within the window (seconds). */
  onsetVoiced: 0.13,
  onsetWindow: 0.26,
  /** A short word that already passed sustained onset must survive the end gate.
   * Two 64 ms voiced frames are enough for e.g. a brief yes/no. */
  minUtteranceVoiced: 0.12,
  /** Within a turn, loud unvoiced audio (consonants) counts as speech only this
   * long after the last voiced frame, so steady fan/hum noise cannot keep a
   * finished turn open until the 20 s cap. */
  unvoicedCarry: 0.5,
  /** While the assistant speaks: longer speech and a louder margin. */
  strictVoiced: 0.26,
  strictWindow: 0.39,
  strictFactor: 1.25,
};

/**
 * Loudness and pitch periodicity of one capture frame. The periodicity is the
 * highest normalized autocorrelation over pitch lags 70–400 Hz, computed on a
 * 2× decimated signal so a 64 ms frame costs well under a millisecond.
 */
export function frameFeatures(samples: Int16Array, rate: number): FrameFeatures {
  let energy = 0;
  for (const sample of samples) energy += (sample / 32768) ** 2;
  const rms = samples.length ? Math.sqrt(energy / samples.length) : 0;
  const half = rate / 2;
  const n = samples.length >> 1;
  const x = new Float32Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) {
    x[i] = (samples[2 * i] + samples[2 * i + 1]) / 65536;
    mean += x[i];
  }
  mean /= n || 1;
  for (let i = 0; i < n; i++) x[i] -= mean;
  // Prefix sums of squares give each lag's window energy in O(1).
  const squares = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) squares[i + 1] = squares[i] + x[i] * x[i];
  const minLag = Math.max(1, Math.floor(half / 400));
  const maxLag = Math.min(n - 32, Math.ceil(half / 70));
  let periodicity = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let dot = 0;
    for (let i = 0; i + lag < n; i++) dot += x[i] * x[i + lag];
    const norm = Math.sqrt(squares[n - lag] * (squares[n] - squares[lag]));
    if (norm > 0 && dot / norm > periodicity) periodicity = dot / norm;
  }
  return { rms, periodicity };
}

/**
 * PCM speech segmentation. Owns utterance boundaries, not application actions.
 *
 * A turn starts only after sustained voiced speech (about 0.13 s within 0.26 s;
 * 0.26 s within 0.39 s and 25% louder while the assistant is speaking), so breaths, clicks and room noise
 * neither start a turn nor interrupt a reply. Loudness is judged against an
 * adaptive background floor. Audio from before the onset is kept (pre-roll).
 */
export class VoiceVad {
  private chunks: Int16Array[] = [];
  private preRoll: Int16Array[] = [];
  /** Recent frames: whether each was voiced speech (pitch + loudness). */
  private recent: boolean[] = [];
  private count = 0;
  private voiced = 0;
  private quiet = 0;
  /** Samples since the last voiced (pitched and loud) frame in this turn. */
  private sinceVoiced = 0;
  private talking = false;
  /** Background loudness, tracked while nobody speaks. */
  private floor = 0.003;
  /** While the assistant speaks, barge-in needs longer and louder speech. */
  private strict = false;
  /** Changes whenever speech starts or resumes, so a stale pause cannot end the turn. */
  private pauseId = 0;
  private paused = false;
  private full = false;
  constructor(
    private rate: number,
    private start: () => void,
    private end: (audio: Int16Array) => void,
    private discard?: () => void,
    /** With `pause`, a short silence (0.2 s) asks the owner whether the sentence is
     * finished (`commit`); `endSilence` is then only the fallback. */
    private options: {
      pause?: (audio: Int16Array, pauseId: number) => void;
      endSilence?: number;
      manualTurnEnd?: boolean;
      limit?: () => void;
    } = {},
  ) {}
  /** Stricter onset while the assistant is speaking (echo residue, breaths). */
  setStrict(strict: boolean) {
    this.strict = strict;
  }
  setEndSilence(seconds?: number, pause?: (audio: Int16Array, pauseId: number) => void) {
    this.options.endSilence = seconds;
    this.options.pause = pause;
  }
  setManualTurnEnd(manual: boolean) {
    if (this.options.manualTurnEnd !== manual) this.full = false;
    this.options.manualTurnEnd = manual;
    this.paused = false;
    this.pauseId++;
  }
  private threshold() {
    const base = Math.max(VAD_TUNING.minRms, VAD_TUNING.floorRatio * this.floor);
    return this.strict ? base * VAD_TUNING.strictFactor : base;
  }
  push(samples: Int16Array) {
    if (this.full) return;
    const { rms, periodicity } = frameFeatures(samples, this.rate);
    const loud = rms > this.threshold();
    if (!this.talking) {
      const speech = loud && periodicity >= VAD_TUNING.minPeriodicity;
      // Background adapts quickly downwards and slowly upwards, never from speech.
      if (!speech) this.floor += (rms - this.floor) * (rms < this.floor ? 0.3 : 0.03);
      this.preRoll.push(samples);
      this.recent.push(speech);
      const frame = samples.length / this.rate;
      const window = Math.max(
        2,
        Math.round((this.strict ? VAD_TUNING.strictWindow : VAD_TUNING.onsetWindow) / frame),
      );
      const needed = Math.max(
        2,
        Math.round((this.strict ? VAD_TUNING.strictVoiced : VAD_TUNING.onsetVoiced) / frame),
      );
      const keep = Math.max(window, Math.round(0.5 / frame));
      if (this.recent.length > window) this.recent.shift();
      if (this.preRoll.length > keep) this.preRoll.shift();
      const voicedFrames = this.recent.filter(Boolean).length;
      if (voicedFrames < needed) return;
      this.talking = true;
      this.chunks = this.preRoll;
      this.preRoll = [];
      this.recent = [];
      this.count = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      this.voiced = voicedFrames * samples.length;
      this.quiet = 0;
      this.sinceVoiced = 0;
      this.start();
      return;
    }
    // Within a turn, consonants and soft endings count by loudness alone, as long
    // as they are close to pitched speech.
    this.sinceVoiced =
      loud && periodicity >= VAD_TUNING.minPeriodicity ? 0 : this.sinceVoiced + samples.length;
    const voice = loud && this.sinceVoiced <= this.rate * VAD_TUNING.unvoicedCarry;
    this.quiet = voice ? 0 : this.quiet + samples.length;
    // Long thinking pauses do not grow a manual recording without bound.
    if (!this.options.manualTurnEnd || voice || this.quiet <= this.rate * 1.2) {
      this.chunks.push(samples);
      this.count += samples.length;
    }
    if (voice) {
      this.voiced += samples.length;
      if (this.paused) this.pauseId++;
      this.paused = false;
    }
    const end = this.options.endSilence ?? 0.6;
    if (this.options.manualTurnEnd) {
      if (this.count >= this.rate * 120) {
        this.full = true;
        this.options.limit?.();
      }
      return; // Only the owner's Finish turn control commits this audio.
    }
    if (this.quiet >= this.rate * end || this.count >= this.rate * 20) return this.flush();
    if (
      this.options.pause &&
      !this.paused &&
      this.quiet >= this.rate * 0.2 &&
      this.voiced >= this.rate * VAD_TUNING.minUtteranceVoiced
    ) {
      this.paused = true;
      this.options.pause(this.audio(), this.pauseId);
    }
  }
  /** Ends the turn at the pause `pauseId` if the speaker has not continued since. */
  commit(pauseId: number): boolean {
    if (this.options.manualTurnEnd) return false;
    if (!this.talking || !this.paused || pauseId !== this.pauseId) return false;
    this.reset();
    return true;
  }
  private audio() {
    const result = new Int16Array(this.count);
    let offset = 0;
    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }
  /** Ends the current utterance now, e.g. when dictation stops mid-sentence. */
  flush() {
    if (!this.talking) return this.reset();
    const result =
      this.voiced >= this.rate * VAD_TUNING.minUtteranceVoiced ? this.audio() : undefined;
    this.reset();
    if (result) this.end(result);
    else this.discard?.();
  }
  /** Ends the current turn; the background floor and strictness are kept. */
  reset() {
    this.chunks = [];
    this.preRoll = [];
    this.recent = [];
    this.count = 0;
    this.voiced = 0;
    this.quiet = 0;
    this.sinceVoiced = 0;
    this.talking = false;
    this.paused = false;
    this.full = false;
    this.pauseId++;
  }
}

export function resamplePcm(input: Int16Array, rate: number): Int16Array {
  if (rate === 16000) return input;
  const result = new Int16Array(Math.floor((input.length * 16000) / rate));
  for (let i = 0; i < result.length; i++) {
    const position = (i * rate) / 16000;
    const low = Math.floor(position),
      high = Math.min(low + 1, input.length - 1);
    result[i] = input[low] + (input[high] - input[low]) * (position - low);
  }
  return result;
}

export function pcmBase64(input: Int16Array) {
  const bytes = new Uint8Array(input.length * 2);
  const view = new DataView(bytes.buffer);
  input.forEach((sample, index) => view.setInt16(index * 2, sample, true));
  let raw = "";
  for (let i = 0; i < bytes.length; i += 8192)
    raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(raw);
}
