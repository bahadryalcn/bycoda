/** PCM speech segmentation. Owns utterance boundaries, not application actions. */
export class VoiceVad {
  private chunks: Int16Array[] = [];
  private preRoll: Int16Array[] = [];
  private count = 0;
  private voiced = 0;
  private quiet = 0;
  private talking = false;
  /** Changes whenever speech starts or resumes, so a stale pause cannot end the turn. */
  private pauseId = 0;
  private paused = false;
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
    } = {},
  ) {}
  push(samples: Int16Array) {
    let energy = 0;
    for (const sample of samples) energy += (sample / 32768) ** 2;
    const voice = Math.sqrt(energy / samples.length) > 0.012;
    if (!this.talking) {
      this.preRoll.push(samples);
      if (this.preRoll.length > 4) this.preRoll.shift();
      if (!voice) return;
      this.talking = true;
      this.chunks = this.preRoll;
      this.preRoll = [];
      this.count = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      this.voiced = samples.length;
      this.quiet = 0;
      this.start();
      return;
    }
    this.chunks.push(samples);
    this.count += samples.length;
    this.quiet = voice ? 0 : this.quiet + samples.length;
    if (voice) {
      this.voiced += samples.length;
      if (this.paused) this.pauseId++;
      this.paused = false;
    }
    const end = this.options.endSilence ?? 0.6;
    if (this.quiet >= this.rate * end || this.count >= this.rate * 20) return this.flush();
    if (
      this.options.pause &&
      !this.paused &&
      this.quiet >= this.rate * 0.2 &&
      this.voiced >= this.rate * 0.2
    ) {
      this.paused = true;
      this.options.pause(this.audio(), this.pauseId);
    }
  }
  /** Ends the turn at the pause `pauseId` if the speaker has not continued since. */
  commit(pauseId: number): boolean {
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
    const result = this.voiced >= this.rate * 0.2 ? this.audio() : undefined;
    this.reset();
    if (result) this.end(result);
    else this.discard?.();
  }
  reset() {
    this.chunks = [];
    this.preRoll = [];
    this.count = 0;
    this.voiced = 0;
    this.quiet = 0;
    this.talking = false;
    this.paused = false;
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
