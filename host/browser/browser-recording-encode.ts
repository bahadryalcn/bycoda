import { spawn } from "node:child_process";
import { once } from "node:events";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";

export const RECORDING_ENCODE_DEADLINE_MS = 120_000;
/** Used only when Playwright ships no ffmpeg for this platform and no ffmpeg is on PATH. */
export const FFMPEG_UNAVAILABLE =
  "Browser recording cannot run on this computer: Playwright has no ffmpeg build for this platform and no ffmpeg is on PATH. Install ffmpeg, add it to PATH, then record again.";

/** Encodes JPEG frames, in order, from an async source. Injected by tests. */
export type FfmpegEncode = (
  ffmpeg: string,
  args: string[],
  frames: AsyncIterable<Buffer>,
) => Promise<void>;

/** The fallback when the pinned runtime has no ffmpeg build: an ffmpeg already on PATH. */
export async function findFfmpegOnPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  const names = platform === "win32" ? ["ffmpeg.exe"] : ["ffmpeg"];
  const directories = (env.PATH ?? env.Path ?? "")
    .split(delimiter)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
  for (const directory of directories)
    for (const name of names) {
      const candidate = join(directory, name);
      const runnable = platform === "win32" ? constants.F_OK : constants.X_OK;
      const found = await stat(candidate)
        .then(
          async (info) =>
            info.isFile() &&
            (await access(candidate, runnable).then(
              () => true,
              () => false,
            )),
        )
        .catch(() => false);
      if (found) return candidate;
    }
  return undefined;
}

/** Names the real cause of a failed ffmpeg download in words the user can act on. */
export function ffmpegDownloadReason(message: string) {
  if (/still running/.test(message)) return "the download is still running";
  if (/ENOSPC|no space left/i.test(message)) return "the disk is full";
  if (/EACCES|EPERM|EROFS/i.test(message)) return "the browser cache folder is not writable";
  if (/ENOTFOUND|EAI_AGAIN|ECONN|ETIMEDOUT|socket hang up|network|timed out/i.test(message))
    return "the network connection failed";
  return "the download did not finish";
}

/**
 * Arguments for JPEG frames piped on stdin at a fixed rate. Playwright's bundled build has no
 * concat or image2 demuxer, so frames arrive as image2pipe (Playwright's screencast frames are
 * JPEG too). The VP9 settings mirror Playwright's own FfmpegVideoRecorder in videoRecorder.ts
 * (playwright-core 1.64): libvpx-vp9 is present in every Playwright ffmpeg build. Frames are
 * scaled and padded to the first viewport so a mid-recording resize cannot break the encoder.
 */
export function frameEncodeArgs(input: {
  fps: number;
  width: number;
  height: number;
  output: string;
}) {
  const width = Math.max(2, input.width - (input.width % 2));
  const height = Math.max(2, input.height - (input.height % 2));
  const filter = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
  ].join(",");
  // Playwright's pixel-rate scaling, copied: bitrate in kbit/s, threads and tile columns.
  const pixelRateScale = Math.max(1, (width * height * input.fps) / (800 * 450 * 25));
  const threads = Math.min(8, Math.ceil(pixelRateScale / 4));
  const tileColumns = Math.ceil(Math.log2(threads));
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "image2pipe",
    "-c:v",
    "mjpeg",
    "-framerate",
    String(input.fps),
    "-i",
    "pipe:0",
    "-an",
    "-r",
    String(input.fps),
    "-vf",
    filter,
    "-c:v",
    "libvpx-vp9",
    "-qmin",
    "0",
    "-qmax",
    "50",
    "-crf",
    "8",
    "-deadline",
    "realtime",
    "-cpu-used",
    "8",
    "-lag-in-frames",
    "0",
    "-b:v",
    `${Math.round(pixelRateScale * 1000)}k`,
    "-threads",
    String(threads),
    "-tile-columns",
    String(tileColumns),
    "-row-mt",
    "1",
    "-pix_fmt",
    "yuv420p",
    input.output,
  ];
}

/**
 * Runs ffmpeg with a deadline and streams frames into its stdin one at a time, honouring
 * backpressure. stderr is decoded per line so one invalid byte never stops the reader.
 */
export async function encodeFrameSequence(
  ffmpeg: string,
  args: string[],
  frames: AsyncIterable<Buffer>,
): Promise<void> {
  const child = spawn(ffmpeg, args, {
    windowsHide: true,
    stdio: ["pipe", "ignore", "pipe"],
    signal: AbortSignal.timeout(RECORDING_ENCODE_DEADLINE_MS),
  });
  const tail: string[] = [];
  let pending = Buffer.alloc(0);
  const keep = (line: string) => {
    tail.push(line);
    if (tail.length > 20) tail.shift();
  };
  child.stderr.on("data", (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    let newline = pending.indexOf(10);
    while (newline >= 0) {
      keep(pending.subarray(0, newline).toString("utf8").trimEnd());
      pending = pending.subarray(newline + 1);
      newline = pending.indexOf(10);
    }
    if (pending.byteLength > 64 * 1024) pending = Buffer.alloc(0);
  });
  child.stdin.on("error", () => undefined); // EPIPE after ffmpeg exits; its exit status reports it
  const closed = new Promise<void>((resolve, reject) => {
    child.once("error", (error: Error) =>
      reject(
        error.name === "AbortError"
          ? new Error("Browser recording encode timed out. Record a shorter clip.")
          : error,
      ),
    );
    child.once("close", (code) => {
      if (pending.byteLength) keep(pending.toString("utf8").trimEnd());
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `Browser recording encode failed (exit ${code ?? "signal"}): ${tail.filter(Boolean).at(-1) ?? "no ffmpeg output"}`,
          ),
        );
    });
  });
  closed.catch(() => undefined);
  let feedError: unknown;
  const feeding = (async () => {
    for await (const frame of frames) {
      if (!child.stdin.write(frame)) await Promise.race([once(child.stdin, "drain"), closed]);
    }
    child.stdin.end();
  })().catch((error: unknown) => {
    feedError = error;
    child.kill();
  });
  let exitError: unknown;
  try {
    await closed;
  } catch (error) {
    exitError = error;
  }
  await feeding;
  if (feedError) throw feedError;
  if (exitError) throw exitError;
}
