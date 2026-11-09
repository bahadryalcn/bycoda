import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BROWSER_RECORDING_DIRECTORY,
  BrowserRecordingService,
  type BrowserRecordingBrowser,
} from "./browser-recording";
import { FFMPEG_UNAVAILABLE } from "./browser-recording-encode";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

const scope = { projectId: "project-1", sessionId: "session-1" };
const credential = "conversation-token";

type FakeState = {
  open: boolean;
  controlling: boolean;
  leaseId: string;
  frames: number;
  /** Simulated time each capture takes, advanced on the fake clock. */
  frameCostMs: number;
  frameError?: Error;
  onFrame?: (count: number) => void;
  onStatus?: (clock: number) => void;
};

type HarnessOptions = Partial<FakeState> & {
  ffmpeg?: string | undefined;
  ensureFfmpeg?: () => Promise<void>;
  ffmpegWaitMs?: number;
};

async function harness(overrides: HarnessOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), "bycoda-browser-recording-"));
  directories.push(root);
  const clock = { t: 0 };
  const { ffmpeg, ensureFfmpeg, ffmpegWaitMs, ...fake } = overrides;
  const state: FakeState = {
    open: true,
    controlling: true,
    leaseId: "lease-1",
    frames: 0,
    frameCostMs: 0,
    ...fake,
  };
  const browser: BrowserRecordingBrowser = {
    async dispatchForSession(method, params, token) {
      if (token !== credential || JSON.stringify(params) !== JSON.stringify(scope))
        throw new Error("scope mismatch");
      if (method === "browser.status") {
        state.onStatus?.(clock.t);
        return {
          open: state.open,
          controlling: state.controlling,
          leaseId: state.controlling ? state.leaseId : undefined,
        };
      }
      if (method === "browser.frame") {
        if (state.frameError) throw state.frameError;
        state.frames += 1;
        const count = state.frames;
        clock.t += state.frameCostMs;
        state.onFrame?.(count);
        return {
          data: Buffer.from(`jpeg-${count}`).toString("base64"),
          width: 800,
          height: 600,
        };
      }
      throw new Error(`unexpected ${method}`);
    },
  };
  const ffmpegCalls: { args: string[]; frames: string[] }[] = [];
  let ffmpegPath = "ffmpeg" in overrides ? ffmpeg : "C:/fake/ffmpeg-win64.exe";
  const service = new BrowserRecordingService({
    browser,
    dataDir: root,
    now: () => clock.t,
    sleep: async (ms) => {
      clock.t += ms;
    },
    findFfmpeg: async () => ffmpegPath,
    ensureFfmpeg: ensureFfmpeg ?? (async () => undefined),
    ffmpegWaitMs,
    encode: async (_ffmpeg, args, frames) => {
      const delivered: string[] = [];
      for await (const frame of frames) delivered.push(frame.toString());
      ffmpegCalls.push({ args, frames: delivered });
      await writeFile(args.at(-1)!, "webm-bytes");
    },
  });
  const setFfmpeg = (value: string | undefined) => {
    ffmpegPath = value;
  };
  return { root, clock, state, browser, service, ffmpegCalls, setFfmpeg };
}

/**
 * Lets the fake-clock loop run until the condition holds. Frames are written to the real disk, so the
 * bound is wall-clock time: a fixed turn count finished before a slow runner's writes did.
 */
async function waitFor(condition: () => boolean) {
  const deadline = Date.now() + 30_000;
  while (!condition() && Date.now() < deadline)
    await new Promise((resolve) => setImmediate(resolve));
  expect(condition()).toBe(true);
}

const started = (service: BrowserRecordingService, params: Record<string, unknown> = {}) =>
  service.start({ leaseId: "lease-1", ...params }, scope, credential);

type Snapshot = { state: string; frames: number; stopReason?: string; result?: unknown };
const snapshot = (service: BrowserRecordingService, recordingId: string) =>
  service.status({ recordingId }, scope) as Snapshot;
const finished = (service: BrowserRecordingService, recordingId: string) =>
  ["done", "failed"].includes(snapshot(service, recordingId).state);

describe("browser recording lifecycle", () => {
  it("requires the caller's current browser control lease", async () => {
    const { service, state } = await harness();
    state.controlling = false;
    await expect(started(service)).rejects.toThrow("Claim browser control before recording it.");
    state.controlling = true;
    await expect(service.start({ leaseId: "stale-lease" }, scope, credential)).rejects.toThrow(
      "Claim browser control before recording it.",
    );
  });

  it("validates fps and maxSeconds bounds", async () => {
    const { service } = await harness();
    await expect(started(service, { fps: 11 })).rejects.toThrow(
      "fps must be an integer from 1 to 10",
    );
    await expect(started(service, { fps: 2.5 })).rejects.toThrow("fps must be an integer");
    await expect(started(service, { maxSeconds: 4 })).rejects.toThrow(
      "maxSeconds must be an integer from 5 to 300",
    );
  });

  it("allows only one active recording per browser", async () => {
    const { service } = await harness();
    const first = await started(service, { maxSeconds: 60 });
    await waitFor(() => snapshot(service, first.recordingId).frames >= 1);
    await expect(started(service)).rejects.toThrow("already active");
    await service.stop({ recordingId: first.recordingId }, scope);
    const second = await started(service, { maxSeconds: 5 });
    expect(second).toMatchObject({ fps: 4 });
    await service.stop({ recordingId: second.recordingId }, scope).catch(() => undefined);
  });

  it("paces frames at the requested fps and stops at maxSeconds", async () => {
    const { service, ffmpegCalls, clock } = await harness();
    const { recordingId } = await started(service, { fps: 4, maxSeconds: 5 });
    await waitFor(() => finished(service, recordingId));
    const result = await service.stop({ recordingId }, scope);
    expect(result.frames).toBe(20);
    expect(result.durationMs).toBe(5000);
    expect(result.mimeType).toBe("video/webm");
    expect(clock.t).toBeGreaterThanOrEqual(5000);
    expect(await service.status({ recordingId }, scope)).toMatchObject({
      state: "done",
      stopReason: "max-duration",
    });
    // One JPEG per 250 ms slot, in capture order.
    expect(ffmpegCalls[0]!.frames).toHaveLength(20);
    expect(ffmpegCalls[0]!.frames[0]).toBe("jpeg-1");
    expect(ffmpegCalls[0]!.args).toContain("image2pipe");
    expect(ffmpegCalls[0]!.args).toContain("libvpx-vp9");
  });

  it("drops slots when capture is slower than the interval instead of queuing frames", async () => {
    const { service, state, ffmpegCalls } = await harness({ frameCostMs: 600 });
    const { recordingId } = await started(service, { fps: 4, maxSeconds: 5 });
    await waitFor(() => finished(service, recordingId));
    const result = await service.stop({ recordingId }, scope);
    // Captures start at 0, 600, ... 4800; no catch-up bursts once behind.
    expect(result.frames).toBe(9);
    expect(state.frames).toBe(9);
    // Slots hold the previous frame while a capture is in flight, so the video keeps real length.
    expect(result.durationMs).toBe(5000);
    expect(ffmpegCalls[0]!.frames).toHaveLength(20);
    expect(new Set(ffmpegCalls[0]!.frames).size).toBe(9);
  });

  it("keeps recording after the control lease expires, until stop", async () => {
    const { service, state, ffmpegCalls } = await harness();
    state.onStatus = (clock) => {
      if (clock >= 1000) state.controlling = false;
    };
    const { recordingId } = await started(service, { fps: 4, maxSeconds: 60 });
    await waitFor(() => (snapshot(service, recordingId).frames ?? 0) >= 8);
    expect(snapshot(service, recordingId)).toMatchObject({ state: "recording" });
    expect(service.status({ recordingId }, scope)).toMatchObject({ controlling: false });
    const result = await service.stop({ recordingId }, scope);
    expect(result.frames).toBeGreaterThanOrEqual(8);
    expect(ffmpegCalls).toHaveLength(1);
    expect(await service.status({ recordingId }, scope)).toMatchObject({
      state: "done",
      stopReason: "stopped",
      controlling: false,
    });
  });

  it("keeps recording when another controller takes the browser", async () => {
    const { service, state } = await harness();
    state.onStatus = (clock) => {
      if (clock >= 1000) state.leaseId = "other-lease";
    };
    const { recordingId } = await started(service, { fps: 4, maxSeconds: 5 });
    await waitFor(() => finished(service, recordingId));
    expect(await service.status({ recordingId }, scope)).toMatchObject({
      state: "done",
      stopReason: "max-duration",
      controlling: false,
    });
    expect((await service.stop({ recordingId }, scope)).frames).toBe(20);
  });

  it("stops when the browser closes and keeps the frames", async () => {
    const { service, state } = await harness();
    state.onFrame = (count) => {
      if (count === 2) state.open = false;
    };
    const { recordingId } = await started(service, { fps: 4, maxSeconds: 60 });
    await waitFor(() => finished(service, recordingId));
    const result = await service.stop({ recordingId }, scope);
    expect(result.frames).toBe(2);
    expect(await service.status({ recordingId }, scope)).toMatchObject({
      stopReason: "browser-closed",
    });
  });

  it("stops early on request, encodes, and deletes the frame folder", async () => {
    const { root, service, state, ffmpegCalls } = await harness();
    const { recordingId } = await started(service, { fps: 4, maxSeconds: 60 });
    let stopping: Promise<unknown> | undefined;
    state.onFrame = (count) => {
      if (count === 3) stopping = service.stop({ recordingId }, scope);
    };
    await waitFor(() => stopping !== undefined);
    const result = (await stopping) as { path: string };
    expect(result).toEqual({
      path: join(root, BROWSER_RECORDING_DIRECTORY, `${recordingId}.webm`),
      durationMs: 750,
      frames: 3,
      bytes: "webm-bytes".length,
      mimeType: "video/webm",
    });
    expect(ffmpegCalls[0]!.frames).toEqual(["jpeg-1", "jpeg-2", "jpeg-3"]);
    expect(await readFile(result.path, "utf8")).toBe("webm-bytes");
    expect(await readdir(join(root, BROWSER_RECORDING_DIRECTORY))).toEqual([`${recordingId}.webm`]);
    // A second stop returns the same finished result without encoding again.
    await expect(service.stop({ recordingId }, scope)).resolves.toEqual(result);
    expect(ffmpegCalls).toHaveLength(1);
  });

  it("reports the final cannot-run error and keeps nothing when no ffmpeg exists anywhere", async () => {
    const { root, service, state, ffmpegCalls } = await harness({ ffmpeg: undefined });
    const { recordingId } = await started(service, { fps: 4, maxSeconds: 60 });
    await waitFor(() => state.frames >= 2);
    await expect(service.stop({ recordingId }, scope)).rejects.toThrow(FFMPEG_UNAVAILABLE);
    expect(ffmpegCalls).toHaveLength(0);
    expect(await readdir(join(root, BROWSER_RECORDING_DIRECTORY))).toEqual([]);
    expect(await service.status({ recordingId }, scope)).toMatchObject({ state: "failed" });
    expect(await service.status({ recordingId }, scope)).not.toHaveProperty("retryable");
  });

  it("keeps frames when the ffmpeg download fails, and stop encodes them once it works", async () => {
    let online = false;
    const { root, service, state, ffmpegCalls, setFfmpeg } = await harness({
      ffmpeg: undefined,
      ensureFfmpeg: async () => {
        if (!online) throw new Error("getaddrinfo ENOTFOUND cdn.playwright.dev");
      },
    });
    const { recordingId } = await started(service, { fps: 4, maxSeconds: 60 });
    await waitFor(() => state.frames >= 2);
    await expect(service.stop({ recordingId }, scope)).rejects.toThrow(
      "because the network connection failed",
    );
    expect(await service.status({ recordingId }, scope)).toMatchObject({
      state: "failed",
      retryable: true,
    });
    expect(await readdir(join(root, BROWSER_RECORDING_DIRECTORY))).toEqual([recordingId]);
    online = true;
    setFfmpeg("C:/fake/ffmpeg-win64.exe");
    await expect(service.stop({ recordingId }, scope)).resolves.toMatchObject({
      frames: 2,
      mimeType: "video/webm",
    });
    expect(ffmpegCalls).toHaveLength(1);
    expect(await readdir(join(root, BROWSER_RECORDING_DIRECTORY))).toEqual([`${recordingId}.webm`]);
    expect(await service.status({ recordingId }, scope)).toMatchObject({ state: "done" });
    expect(await service.status({ recordingId }, scope)).not.toHaveProperty("retryable");
  });

  it("stop waits for an in-flight ffmpeg download before encoding", async () => {
    let finish!: () => void;
    const download = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const { service, state, ffmpegCalls, setFfmpeg } = await harness({
      ffmpeg: undefined,
      ensureFfmpeg: () => download,
    });
    const { recordingId } = await started(service, { fps: 4, maxSeconds: 60 });
    await waitFor(() => state.frames >= 2);
    const stopping = service.stop({ recordingId }, scope);
    await new Promise((resolve) => setImmediate(resolve));
    expect(ffmpegCalls).toHaveLength(0);
    setFfmpeg("C:/fake/ffmpeg-win64.exe");
    finish();
    await expect(stopping).resolves.toMatchObject({ frames: 2 });
    expect(ffmpegCalls).toHaveLength(1);
  });

  it("bounds the stop wait for a download that is still running, and keeps the frames", async () => {
    const { service, state, setFfmpeg } = await harness({
      ffmpeg: undefined,
      ensureFfmpeg: () => new Promise<void>(() => undefined),
      ffmpegWaitMs: 20,
    });
    const { recordingId } = await started(service, { fps: 4, maxSeconds: 60 });
    await waitFor(() => state.frames >= 2);
    await expect(service.stop({ recordingId }, scope)).rejects.toThrow("still running");
    expect(await service.status({ recordingId }, scope)).toMatchObject({ retryable: true });
    setFfmpeg("C:/fake/ffmpeg-win64.exe");
    await expect(service.stop({ recordingId }, scope)).resolves.toMatchObject({ frames: 2 });
  });

  it("fails without frames after repeated capture errors, and stop reports it", async () => {
    const { service, state, ffmpegCalls } = await harness({
      frameError: new Error("screenshot exploded"),
    });
    const { recordingId } = await started(service, { fps: 4, maxSeconds: 60 });
    await waitFor(() => snapshot(service, recordingId).state === "failed");
    await expect(service.stop({ recordingId }, scope)).rejects.toThrow("captured no frames");
    expect(state.frames).toBe(0);
    expect(ffmpegCalls).toHaveLength(0);
    expect(snapshot(service, recordingId)).toMatchObject({
      state: "failed",
      stopReason: "capture-failed",
    });
  });

  it("drops busy frames without counting them as failures", async () => {
    const { service, state } = await harness();
    state.onFrame = (count) => {
      if (count === 1)
        state.frameError = new Error("Shared browser is busy; retry after the current request");
    };
    const { recordingId } = await started(service, { fps: 4, maxSeconds: 5 });
    await waitFor(() => ["done", "failed"].includes(snapshot(service, recordingId).state));
    // Busy slots never reach the three-failure stop; the recording runs to maxSeconds.
    expect(snapshot(service, recordingId)).toMatchObject({
      state: "done",
      frames: 1,
      stopReason: "max-duration",
    });
  });

  it("reports status for the latest recording and rejects other conversations", async () => {
    const { service, state } = await harness();
    expect(await service.status({}, scope)).toEqual({ recording: null });
    const { recordingId } = await started(service, { fps: 4, maxSeconds: 60 });
    await waitFor(() => (service.status({}, scope) as { frames: number }).frames >= 2);
    expect(await service.status({}, scope)).toMatchObject({
      recordingId,
      state: "recording",
    });
    await service.stop({ recordingId }, scope);
    expect(await service.status({}, scope)).toMatchObject({
      recordingId,
      state: "done",
      result: { mimeType: "video/webm" },
    });
    expect(state.frames).toBeGreaterThanOrEqual(2);
    expect(() =>
      service.status({ recordingId }, { projectId: "project-2", sessionId: "session-1" }),
    ).toThrow("Unknown browser recording");
    expect(() => service.status({ recordingId: "missing" }, scope)).toThrow(
      "Unknown browser recording",
    );
  });

  it("rejects calls without a validated conversation scope", async () => {
    const { service } = await harness();
    await expect(
      service.call("browser.recording.status", { projectId: "p" }, credential),
    ).rejects.toThrow("A validated project and conversation are required");
  });

  it("removes recordings older than 24 hours at startup and keeps fresh ones", async () => {
    const { root, service } = await harness();
    const recordings = join(root, BROWSER_RECORDING_DIRECTORY);
    await mkdir(join(recordings, "old-folder"), { recursive: true });
    await writeFile(join(recordings, "old.webm"), "old");
    await writeFile(join(recordings, "fresh.webm"), "fresh");
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await utimes(join(recordings, "old.webm"), old, old);
    await utimes(join(recordings, "old-folder"), old, old);
    expect(await service.pruneStale()).toBe(2);
    expect(await readdir(recordings)).toEqual(["fresh.webm"]);
    expect((await stat(join(recordings, "fresh.webm"))).size).toBe(5);
  });
});
