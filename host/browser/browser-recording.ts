import { randomUUID } from "node:crypto";
// oxlint-disable-next-line no-restricted-imports -- scratch JPEG frames are deleted after encoding; the Host never reads them at startup
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { elapsedSince, isoTimestamp, monotonicNow } from "../../src/shared/lib/time/timestamps";
import {
  encodeFrameSequence,
  FFMPEG_UNAVAILABLE,
  ffmpegDownloadReason,
  findFfmpegOnPath,
  frameEncodeArgs,
  type FfmpegEncode,
} from "./browser-recording-encode";

export const BROWSER_RECORDING_DIRECTORY = "browser-recordings";
export const RECORDING_FPS_OPTIONS = [4, 8, 10, 15, 30, 60] as const;
const DEFAULT_FPS = 4;
/** One long poll of the live screencast; short so a stop request is honoured quickly. */
const LIVE_WAIT_MS = 250;
/** A live poll that returns nothing this fast is paced so a stopped cast cannot spin the loop. */
const LIVE_MIN_POLL_MS = 50;
/** A static page may send no picture; after this long without one, a screenshot seeds the video. */
const FIRST_FRAME_GRACE_MS = 1500;
const DEFAULT_MAX_SECONDS = 120;
/** A stop waits this long for the background ffmpeg download before reporting it still running. */
const FFMPEG_WAIT_MS = 5 * 60 * 1000;
const RETAIN_MS = 24 * 60 * 60 * 1000;
const MAX_CONSECUTIVE_FAILURES = 3;
const TRANSIENT_CAPTURE = /Shared browser is busy|Browser document changed during capture/;
const BROWSER_GONE = /Open a shared browser first|Open a browser for this session/;

export type BrowserRecordingScope = { projectId: string; sessionId: string };
export type BrowserRecordingResult = {
  path: string;
  durationMs: number;
  frames: number;
  bytes: number;
  mimeType: "video/webm";
};
export type BrowserRecordingBrowser = {
  dispatchForSession(
    method: string,
    params: Record<string, unknown>,
    credential: string,
  ): Promise<unknown>;
};
export type BrowserRecordingOptions = {
  browser: BrowserRecordingBrowser;
  dataDir: string;
  /** Monotonic milliseconds; injected by tests. */
  now?: () => number;
  wallNow?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Playwright's ffmpeg when on disk, else the ffmpeg on PATH. */
  findFfmpeg?: () => Promise<string | undefined>;
  /** Starts or awaits the Playwright ffmpeg download; rejections are retryable. */
  ensureFfmpeg?: () => Promise<void>;
  ffmpegWaitMs?: number;
  defaultFps?: () => Promise<number>;
  encode?: FfmpegEncode;
};

type RecordingState = "recording" | "encoding" | "done" | "failed";
type Recording = {
  id: string;
  scopeKey: string;
  leaseId: string;
  fps: number;
  maxFrames: number;
  maxMs: number;
  startedAt: string;
  startedMono: number;
  frameDir: string;
  frameNames: string[];
  frameTimes: number[];
  /** Monotonic time capture stopped; the last frame is held until then. */
  endedMono?: number;
  width?: number;
  height?: number;
  state: RecordingState;
  stopRequested: boolean;
  /** Whether this conversation still holds browser control; recording continues either way. */
  controlling: boolean;
  /** Frames are kept after a failed ffmpeg acquisition so stop can encode them again. */
  retryable: boolean;
  stopReason?: string;
  lastError?: string;
  error?: string;
  result?: BrowserRecordingResult;
  finishedMono?: number;
  done: Promise<void>;
};
type StatusFrame = { controlling?: boolean; leaseId?: string; open?: boolean };

function scopeKeyOf(scope: BrowserRecordingScope) {
  return JSON.stringify([scope.projectId, scope.sessionId]);
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Browser recording failed.";
}
/** Rejects with a bounded message when the download outlives the wait; the download keeps running. */
function withinWait<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("the download is still running")), ms);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}
function fpsParam(value: unknown, fallback: number) {
  if (value === undefined) return fallback;
  if (!RECORDING_FPS_OPTIONS.some((option) => option === value))
    throw new Error(`fps must be one of ${RECORDING_FPS_OPTIONS.join(", ")}`);
  return value as number;
}
function integerParam(value: unknown, fallback: number, min: number, max: number, name: string) {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return value;
}

/** Grid slots on the fps clock; the last captured frame is held for one interval or until capture ended. */
function slotCount(times: number[], interval: number, endedAt = 0) {
  return Math.round(
    (Math.max(times[times.length - 1]! + interval, endedAt) - times[0]!) / interval,
  );
}

/**
 * Sample-and-hold: each slot shows the newest frame captured at or before it (within half an
 * interval). Dropped captures therefore hold the previous frame instead of shortening the video.
 * Frames are read one at a time, so memory stays at one JPEG however long the recording.
 */
async function* heldFrames(
  recording: Pick<Recording, "frameDir" | "frameNames" | "frameTimes">,
  slots: number,
  interval: number,
): AsyncGenerator<Buffer> {
  const { frameNames: names, frameTimes: times } = recording;
  let index = 0;
  for (let slot = 0; slot < slots; slot += 1) {
    const at = times[0]! + slot * interval;
    while (index + 1 < times.length && times[index + 1]! <= at + interval / 2) index += 1;
    yield await readFile(join(recording.frameDir, names[index]!));
  }
}

/**
 * Records the project browser through the live screencast behind `browser.frame` (long polls
 * with a cursor, every picture acknowledged), which follows the display at 30 to 60 fps. A
 * browser without a screencast falls back to sampling screenshots, which cannot reach those
 * rates. Frames go to disk as they arrive, at most one per fps slot (the newest wins), and
 * the video holds each frame until the next one, so a still page costs almost nothing.
 */
export class BrowserRecordingService {
  private readonly recordings = new Map<string, Recording>();
  private readonly now: () => number;
  private readonly wallNow: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly findFfmpeg: () => Promise<string | undefined>;
  private readonly ensureFfmpeg: () => Promise<void>;
  private readonly ffmpegWaitMs: number;
  private readonly encodeFrames: FfmpegEncode;

  constructor(private readonly options: BrowserRecordingOptions) {
    this.now = options.now ?? monotonicNow;
    this.wallNow = options.wallNow ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.findFfmpeg = options.findFfmpeg ?? (() => findFfmpegOnPath());
    this.ensureFfmpeg = options.ensureFfmpeg ?? (() => Promise.resolve());
    this.ffmpegWaitMs = options.ffmpegWaitMs ?? FFMPEG_WAIT_MS;
    this.encodeFrames = options.encode ?? encodeFrameSequence;
  }

  private get root() {
    return join(this.options.dataDir, BROWSER_RECORDING_DIRECTORY);
  }

  /** Routes recording actions here and every other shared-browser action to the registry. */
  dispatchForSession(method: string, params: Record<string, unknown>, credential: string) {
    if (method.startsWith("browser.recording.")) return this.call(method, params, credential);
    return this.options.browser.dispatchForSession(method, params, credential);
  }

  async call(action: string, params: Record<string, unknown>, credential: string) {
    if (
      typeof params.projectId !== "string" ||
      !params.projectId ||
      typeof params.sessionId !== "string" ||
      !params.sessionId
    )
      throw new Error("A validated project and conversation are required for browser recording.");
    const scope = { projectId: params.projectId, sessionId: params.sessionId };
    if (action === "browser.recording.start") return this.start(params, scope, credential);
    if (action === "browser.recording.stop") return this.stop(params, scope);
    if (action === "browser.recording.status") return this.status(params, scope);
    throw new Error("Unknown browser recording action.");
  }

  async start(params: Record<string, unknown>, scope: BrowserRecordingScope, credential: string) {
    if (typeof params.leaseId !== "string" || !params.leaseId)
      throw new Error("Claim browser control before recording it.");
    const fallback = params.fps === undefined ? await this.options.defaultFps?.() : undefined;
    const fps = fpsParam(params.fps, fallback ?? DEFAULT_FPS);
    const maxSeconds = integerParam(params.maxSeconds, DEFAULT_MAX_SECONDS, 5, 300, "maxSeconds");
    const scopeKey = scopeKeyOf(scope);
    this.pruneFinished();
    for (const recording of this.recordings.values())
      if (
        recording.scopeKey === scopeKey &&
        (recording.state === "recording" || recording.state === "encoding")
      )
        throw new Error("A browser recording is already active. Stop it before starting another.");
    const status = (await this.options.browser.dispatchForSession(
      "browser.status",
      { ...scope },
      credential,
    )) as StatusFrame;
    if (!status.controlling || status.leaseId !== params.leaseId)
      throw new Error("Claim browser control before recording it.");
    if (!status.open) throw new Error("Open a shared browser first");
    const id = randomUUID();
    const frameDir = join(this.root, id);
    await mkdir(frameDir, { recursive: true, mode: 0o700 });
    const recording: Recording = {
      id,
      scopeKey,
      leaseId: params.leaseId,
      fps,
      maxFrames: fps * maxSeconds,
      maxMs: maxSeconds * 1000,
      startedAt: isoTimestamp(this.wallNow()) ?? "",
      startedMono: this.now(),
      frameDir,
      frameNames: [],
      frameTimes: [],
      state: "recording",
      stopRequested: false,
      controlling: true,
      retryable: false,
      done: Promise.resolve(),
    };
    recording.done = this.run(recording, scope, credential).catch((error: unknown) => {
      recording.state = "failed";
      recording.error = errorMessage(error);
      recording.finishedMono = this.now();
    });
    this.recordings.set(id, recording);
    // Playwright's ffmpeg downloads while frames are captured; a failure here is handled by stop.
    void this.ensureFfmpeg().catch(() => undefined);
    return { recordingId: id, startedAt: recording.startedAt, fps, maxSeconds };
  }

  async stop(params: Record<string, unknown>, scope: BrowserRecordingScope) {
    const recording = this.lookup(params.recordingId, scope);
    if (recording.state === "recording") {
      recording.stopRequested = true;
      recording.stopReason ??= "stopped";
    } else if (recording.state === "failed" && recording.retryable) {
      // Frames were kept because ffmpeg was not ready; encode them now and clean up on success.
      recording.state = "encoding";
      recording.error = undefined;
      recording.done = this.encode(recording);
    }
    await recording.done;
    if (recording.state === "failed") throw new Error(recording.error);
    return recording.result!;
  }

  status(params: Record<string, unknown>, scope: BrowserRecordingScope) {
    let recording: Recording | undefined;
    if (params.recordingId !== undefined) recording = this.lookup(params.recordingId, scope);
    else {
      const scopeKey = scopeKeyOf(scope);
      for (const candidate of this.recordings.values())
        if (candidate.scopeKey === scopeKey) recording = candidate;
    }
    if (!recording) return { recording: null };
    const elapsedMs = Math.round(
      recording.finishedMono !== undefined
        ? recording.finishedMono - recording.startedMono
        : elapsedSince(recording.startedMono, this.now()),
    );
    return {
      recordingId: recording.id,
      state: recording.state,
      startedAt: recording.startedAt,
      elapsedMs,
      frames: recording.frameNames.length,
      controlling: recording.controlling,
      ...(recording.retryable ? { retryable: true } : {}),
      ...(recording.stopReason ? { stopReason: recording.stopReason } : {}),
      ...(recording.lastError && recording.state === "recording"
        ? { lastError: recording.lastError }
        : {}),
      ...(recording.state === "failed" ? { error: recording.error } : {}),
      ...(recording.result ? { result: recording.result } : {}),
    };
  }

  /** Removes recordings and frame folders older than 24 hours; call once at Host start. */
  async pruneStale() {
    let entries: string[];
    try {
      entries = await readdir(this.root);
    } catch {
      return 0;
    }
    let removed = 0;
    for (const name of entries) {
      const path = join(this.root, name);
      const info = await stat(path).catch(() => undefined);
      if (!info || this.wallNow() - info.mtimeMs <= RETAIN_MS) continue;
      await rm(path, { recursive: true, force: true });
      removed += 1;
    }
    return removed;
  }

  private lookup(value: unknown, scope: BrowserRecordingScope) {
    const recording = typeof value === "string" ? this.recordings.get(value) : undefined;
    if (!recording || recording.scopeKey !== scopeKeyOf(scope))
      throw new Error("Unknown browser recording for this conversation.");
    return recording;
  }

  private pruneFinished() {
    for (const [id, recording] of this.recordings)
      if (
        recording.finishedMono !== undefined &&
        !recording.retryable &&
        elapsedSince(recording.finishedMono, this.now()) > RETAIN_MS
      )
        this.recordings.delete(id);
  }

  private async run(recording: Recording, scope: BrowserRecordingScope, credential: string) {
    recording.stopReason = await this.capture(recording, scope, credential);
    recording.endedMono = Math.min(this.now(), recording.startedMono + recording.maxMs);
    recording.state = "encoding";
    await this.encode(recording);
  }

  /**
   * Capture loop. Returns why capture ended; captured frames are kept either way. Live mode
   * long-polls the screencast with a cursor and never sleeps; screenshot mode sleeps to the grid.
   */
  private async capture(recording: Recording, scope: BrowserRecordingScope, credential: string) {
    const interval = 1000 / recording.fps;
    let due = this.now();
    let live = true;
    let cursor = 0;
    let failures = 0;
    for (;;) {
      const wait = due - this.now();
      if (!live && wait > 0) await this.sleep(wait);
      if (recording.stopRequested) return recording.stopReason ?? "stopped";
      if (
        elapsedSince(recording.startedMono, this.now()) >= recording.maxMs ||
        recording.frameNames.length >= recording.maxFrames
      )
        return "max-duration";
      let outcome: string | undefined;
      const polled = this.now();
      try {
        // Seed with a screenshot when a static page has sent no picture yet.
        const seeding =
          live &&
          !recording.frameNames.length &&
          elapsedSince(recording.startedMono, polled) >= FIRST_FRAME_GRACE_MS;
        const frame = (await this.options.browser.dispatchForSession(
          "browser.frame",
          live && !seeding
            ? { ...scope, after: cursor, waitMs: LIVE_WAIT_MS, fast: true }
            : { ...scope },
          credential,
        )) as {
          open?: boolean;
          controlling?: boolean;
          leaseId?: string;
          data?: string;
          width: number;
          height: number;
          frameSequence?: number;
        };
        // A screenshot shows the page as of the request; a screencast picture as of its arrival.
        let at = polled;
        if (typeof frame.frameSequence === "number") {
          cursor = frame.frameSequence;
          at = this.now();
        } else if (live && !seeding) live = false; // no screencast on this browser
        if (frame.open !== undefined) {
          recording.controlling = !!frame.controlling && frame.leaseId === recording.leaseId;
          if (!frame.open) outcome = "browser-closed";
        }
        // Reading a frame needs no control lease, so a lapsed or moved lease never ends recording.
        if (!outcome && typeof frame.data === "string")
          await this.appendFrame(recording, frame, at);
        else if (!outcome && live && elapsedSince(polled, this.now()) < LIVE_MIN_POLL_MS)
          await this.sleep(LIVE_MIN_POLL_MS);
        failures = 0;
      } catch (error) {
        const message = errorMessage(error);
        if (BROWSER_GONE.test(message)) outcome = "browser-closed";
        else if (!TRANSIENT_CAPTURE.test(message)) {
          // Busy or navigating frames are simply dropped; anything else counts toward a stop.
          failures += 1;
          recording.lastError = message;
          if (failures >= MAX_CONSECUTIVE_FAILURES) outcome = "capture-failed";
        }
        if (live && !outcome) await this.sleep(LIVE_MIN_POLL_MS);
      }
      if (outcome) return outcome;
      due += interval;
      if (due < this.now()) due = this.now();
    }
  }

  private async appendFrame(
    recording: Recording,
    frame: { data?: string; width: number; height: number },
    at: number,
  ) {
    const interval = 1000 / recording.fps;
    const last = recording.frameTimes.length - 1;
    // Screencast pictures can outpace the grid: a second picture in the same slot replaces the
    // first, so disk use and the frame cap follow the slot count, not the display rate.
    const replace =
      last >= 0 &&
      Math.round((at - recording.frameTimes[0]!) / interval) ===
        Math.round((recording.frameTimes[last]! - recording.frameTimes[0]!) / interval);
    const name = replace
      ? recording.frameNames[last]!
      : `frame-${String(recording.frameNames.length + 1).padStart(6, "0")}.jpg`;
    await writeFile(join(recording.frameDir, name), Buffer.from(frame.data!, "base64"));
    if (replace) recording.frameTimes[last] = at;
    else {
      recording.frameNames.push(name);
      recording.frameTimes.push(at);
    }
    recording.width ??= frame.width;
    recording.height ??= frame.height;
  }

  /**
   * Waits (bounded) for the ffmpeg download, then picks the ffmpeg to run. A download that failed
   * or is still running keeps the frames and is retryable; no ffmpeg anywhere is final.
   */
  private async acquireFfmpeg(recording: Recording): Promise<string> {
    const failure = await withinWait(this.ensureFfmpeg(), this.ffmpegWaitMs).then(
      () => undefined,
      (error: unknown) => errorMessage(error),
    );
    const ffmpeg = await this.findFfmpeg();
    if (ffmpeg) return ffmpeg;
    if (failure === undefined) throw new Error(FFMPEG_UNAVAILABLE);
    recording.retryable = true;
    throw new Error(
      `Could not get Playwright's ffmpeg because ${ffmpegDownloadReason(failure)}. The captured frames are kept; call browser.recording.stop again to encode them.`,
    );
  }

  private async encode(recording: Recording) {
    const output = join(this.root, `${recording.id}.webm`);
    recording.retryable = false;
    try {
      if (!recording.frameNames.length)
        throw new Error(
          "Browser recording captured no frames. Read browser.frame before recording.",
        );
      const ffmpeg = await this.acquireFfmpeg(recording);
      const interval = 1000 / recording.fps;
      const slots = slotCount(recording.frameTimes, interval, recording.endedMono);
      await this.encodeFrames(
        ffmpeg,
        frameEncodeArgs({
          fps: recording.fps,
          width: recording.width ?? 2,
          height: recording.height ?? 2,
          output,
        }),
        heldFrames(recording, slots, interval),
      );
      const bytes = (await stat(output)).size;
      recording.result = {
        path: output,
        durationMs: Math.round(slots * interval),
        frames: recording.frameNames.length,
        bytes,
        mimeType: "video/webm",
      };
      recording.state = "done";
    } catch (error) {
      recording.state = "failed";
      recording.error = errorMessage(error);
      // Nothing large stays behind after a failed encode.
      await rm(output, { force: true }).catch(() => undefined);
    } finally {
      recording.finishedMono = this.now();
      // Frames are scratch unless a retry can still use them; a failed delete is retried by the
      // startup prune.
      if (!recording.retryable)
        await rm(recording.frameDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
