const LOOKAHEAD = 0.1;

export class Davul {
  private context?: AudioContext;
  private volume?: GainNode;
  private noise?: AudioBuffer;
  private nextBeat = 0;
  private step = 0;

  async resume(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
      this.volume = this.context.createGain();
      this.volume.gain.value = 0.66;
      this.volume.connect(this.context.destination);
      this.noise = this.context.createBuffer(
        1,
        Math.round(this.context.sampleRate * 0.14),
        this.context.sampleRate,
      );
      const samples = this.noise.getChannelData(0);
      for (let index = 0; index < samples.length; index++) samples[index] = 2 * Math.random() - 1;
    }
    await this.context.resume();
  }

  get running(): boolean {
    return this.context?.state === "running";
  }

  setMuted(muted: boolean): void {
    if (this.context && this.volume) {
      this.volume.gain.setTargetAtTime(muted ? 0 : 0.66, this.context.currentTime, 0.015);
    }
  }

  schedule(tempo: number): void {
    if (!this.context || !this.running) return;
    const time = this.context.currentTime;
    this.nextBeat = Math.max(time + 0.015, this.nextBeat);
    while (this.nextBeat < time + LOOKAHEAD) {
      this.hit(this.nextBeat, this.step % 4 === 0 || this.step % 4 === 3);
      this.nextBeat += 60 / (96 * tempo * 2);
      this.step++;
    }
  }

  accent(): void {
    if (this.context && this.running) this.hit(this.context.currentTime, true);
  }

  private hit(time: number, bass: boolean): void {
    const context = this.context;
    const volume = this.volume;
    if (!context || !volume || !this.noise) return;

    const tone = context.createOscillator();
    const envelope = context.createGain();
    const duration = bass ? 0.19 : 0.08;
    tone.type = bass ? "sine" : "triangle";
    tone.frequency.setValueAtTime(bass ? 133 : 253, time);
    tone.frequency.exponentialRampToValueAtTime(bass ? 46 : 110, time + duration);
    envelope.gain.setValueAtTime(bass ? 0.45 : 0.09, time);
    envelope.gain.exponentialRampToValueAtTime(0.001, time + duration);
    tone.connect(envelope).connect(volume);
    tone.start(time);
    tone.stop(time + duration);

    const noise = context.createBufferSource();
    noise.buffer = this.noise;
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = bass ? 450 : 1600;
    const attack = context.createGain();
    attack.gain.setValueAtTime(bass ? 0.18 : 0.24, time);
    attack.gain.exponentialRampToValueAtTime(0.001, time + 0.075);
    noise.connect(filter).connect(attack).connect(volume);
    noise.start(time);
    noise.stop(time + 0.075);
  }
}
