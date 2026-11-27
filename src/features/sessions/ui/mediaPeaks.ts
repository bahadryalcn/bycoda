/** Bars drawn for one waveform. */
export const PEAK_BARS = 72;
/** Audio above this size is not decoded; its waveform is the neutral strip. */
export const PEAK_MAX_BYTES = 24 * 1024 * 1024;
const CACHE_LIMIT = 48;
/** Samples read per bar, so a long file costs a bounded amount of main-thread work. */
const SAMPLES_PER_BAR = 256;
const MIN_PEAK = 0.12;

export type PeakDecoder = (data: ArrayBuffer) => Promise<Float32Array>;

const cache = new Map<string, Promise<number[] | null>>();

/** Reduces mono samples to `bars` heights in 0.12..1 by strided max-abs sampling. */
export function peaksFromSamples(samples: Float32Array, bars = PEAK_BARS): number[] | null {
  if (samples.length === 0) return null;
  const peaks: number[] = [];
  const per = samples.length / bars;
  const stride = Math.max(1, Math.floor(per / SAMPLES_PER_BAR));
  for (let bar = 0; bar < bars; bar += 1) {
    const from = Math.floor(bar * per);
    const to = Math.max(from + 1, Math.min(samples.length, Math.floor((bar + 1) * per)));
    let peak = 0;
    for (let i = from; i < to; i += stride) peak = Math.max(peak, Math.abs(samples[i] ?? 0));
    peaks.push(peak);
  }
  const top = Math.max(...peaks);
  if (!(top > 0)) return null;
  return peaks.map((peak) => Math.max(MIN_PEAK, peak / top));
}

async function decodeWithWebAudio(data: ArrayBuffer): Promise<Float32Array> {
  // OfflineAudioContext decodes off the main thread without opening an output device.
  const context = new OfflineAudioContext(1, 1, 44_100);
  const buffer = await context.decodeAudioData(data);
  return buffer.getChannelData(0);
}

async function compute(
  url: string,
  decode: PeakDecoder,
  maxBytes: number,
  bars: number,
): Promise<number[] | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > maxBytes) return null;
    const data = await response.arrayBuffer();
    if (data.byteLength > maxBytes) return null;
    return peaksFromSamples(await decode(data), bars);
  } catch {
    return null;
  }
}

/**
 * Waveform heights for one source, computed once and cached by `key` (the file path, not the
 * short-lived URL). Resolves null when the file is over the size cap or cannot be decoded; the
 * caller then draws a neutral strip. Concurrent callers share the same run.
 */
export function loadPeaks(
  key: string,
  url: string,
  options: { decode?: PeakDecoder; maxBytes?: number; bars?: number } = {},
): Promise<number[] | null> {
  const cached = cache.get(key);
  if (cached) return cached;
  const run = compute(
    url,
    options.decode ?? decodeWithWebAudio,
    options.maxBytes ?? PEAK_MAX_BYTES,
    options.bars ?? PEAK_BARS,
  );
  cache.set(key, run);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return run;
}

export function clearPeaksForTests(): void {
  cache.clear();
}
