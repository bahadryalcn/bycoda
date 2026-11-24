import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearPeaksForTests, loadPeaks, peaksFromSamples } from "./mediaPeaks";

const response = (bytes: number, headers: Record<string, string> = {}) => ({
  ok: true,
  headers: new Headers(headers),
  arrayBuffer: async () => new ArrayBuffer(bytes),
});

beforeEach(clearPeaksForTests);
afterEach(() => vi.unstubAllGlobals());

it("reduces samples to normalized bar heights", () => {
  const samples = new Float32Array(400).map((_, i) => (i < 200 ? 0.1 : 0.5));
  const peaks = peaksFromSamples(samples, 4)!;
  expect(peaks).toHaveLength(4);
  expect(peaks[3]).toBe(1);
  expect(peaks[0]).toBeCloseTo(0.2);
  expect(peaksFromSamples(new Float32Array(10), 4)).toBeNull();
});

it("decodes a source once and serves every later request from the cache", async () => {
  const fetchMock = vi.fn(async () => response(100));
  vi.stubGlobal("fetch", fetchMock);
  const decode = vi.fn(async () => new Float32Array([0.2, 0.4, 0.8, 0.1]));
  const [a, b] = await Promise.all([
    loadPeaks("/a.mp3", "asset:/a.mp3", { decode, bars: 2 }),
    loadPeaks("/a.mp3", "asset:/a.mp3", { decode, bars: 2 }),
  ]);
  await loadPeaks("/a.mp3", "asset:/a.mp3", { decode, bars: 2 });
  expect(a).toEqual(b);
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(decode).toHaveBeenCalledOnce();
});

it("skips decoding above the size cap and falls back on failure", async () => {
  const decode = vi.fn(async () => new Float32Array([1]));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response(10, { "content-length": "5000" })),
  );
  expect(await loadPeaks("/big.wav", "asset:/big.wav", { decode, maxBytes: 1000 })).toBeNull();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response(5000)),
  );
  expect(await loadPeaks("/big2.wav", "asset:/big2.wav", { decode, maxBytes: 1000 })).toBeNull();
  expect(decode).not.toHaveBeenCalled();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response(10)),
  );
  const failing = async () => {
    throw new Error("bad data");
  };
  expect(await loadPeaks("/bad.mp3", "asset:/bad.mp3", { decode: failing })).toBeNull();
});
