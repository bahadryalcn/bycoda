/* global AudioWorkletProcessor, registerProcessor */
class VoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Int16Array(1024);
    this.offset = 0;
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel)
      for (const sample of channel) {
        const value = Math.max(-1, Math.min(1, sample));
        this.samples[this.offset++] = value * (value < 0 ? 32768 : 32767);
        if (this.offset === this.samples.length) {
          this.port.postMessage(this.samples.buffer, [this.samples.buffer]);
          this.samples = new Int16Array(1024);
          this.offset = 0;
        }
      }
    return true;
  }
}
registerProcessor("bycoda-voice-capture", VoiceCapture);
