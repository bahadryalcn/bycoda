import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  encodeFrameSequence,
  ffmpegDownloadReason,
  findFfmpegOnPath,
  frameEncodeArgs,
} from "./browser-recording-encode";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function tempDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-recording-encode-"));
  directories.push(directory);
  return directory;
}

async function* frames(...buffers: string[]) {
  for (const value of buffers) yield Buffer.from(value);
}

function optionValue(args: string[], name: string) {
  return args[args.indexOf(name) + 1];
}

describe("browser recording ffmpeg helpers", () => {
  it("pipes JPEG frames at the fps rate and encodes VP9 WebM with even, padded dimensions", () => {
    const args = frameEncodeArgs({ fps: 4, width: 801, height: 601, output: "C:/out/a.webm" });
    expect(args.slice(args.indexOf("-f"), args.indexOf("-f") + 2)).toEqual(["-f", "image2pipe"]);
    expect(args[args.indexOf("-framerate") + 1]).toBe("4");
    expect(args[args.indexOf("-i") + 1]).toBe("pipe:0");
    expect(args).toContain("libvpx-vp9");
    expect(args.at(-1)).toBe("C:/out/a.webm");
    expect(args[args.indexOf("-vf") + 1]).toBe(
      "scale=800:600:force_original_aspect_ratio=decrease,pad=800:600:(ow-iw)/2:(oh-ih)/2:black",
    );
  });

  it("mirrors Playwright's own VP9 recorder settings, including its pixel-rate scaling", () => {
    const small = frameEncodeArgs({ fps: 4, width: 800, height: 600, output: "a.webm" });
    for (const [name, value] of [
      ["-qmin", "0"],
      ["-qmax", "50"],
      ["-crf", "8"],
      ["-deadline", "realtime"],
      ["-cpu-used", "8"],
      ["-lag-in-frames", "0"],
      ["-b:v", "1000k"],
      ["-threads", "1"],
      ["-tile-columns", "0"],
      ["-row-mt", "1"],
    ])
      expect(optionValue(small, name!)).toBe(value);
    // 3840x2160 at 10 fps: pixel-rate scale 9.216 gives 9216k, 3 threads and 2 tile columns.
    const large = frameEncodeArgs({ fps: 10, width: 3840, height: 2160, output: "b.webm" });
    expect(optionValue(large, "-b:v")).toBe("9216k");
    expect(optionValue(large, "-threads")).toBe("3");
    expect(optionValue(large, "-tile-columns")).toBe("2");
  });

  it("finds ffmpeg on PATH as the fallback, requiring a regular file", async () => {
    const bin = await tempDirectory();
    const exe = platformExecutable();
    await writeFile(join(bin, exe), "");
    await chmod(join(bin, exe), 0o755);
    const env = { PATH: [join(bin, "missing"), `"${bin}"`].join(delimiter) };
    expect(await findFfmpegOnPath(env, process.platform)).toBe(join(bin, exe));
    expect(await findFfmpegOnPath({ PATH: join(bin, "missing") }, process.platform)).toBe(
      undefined,
    );
    const dirWithDirectoryNamedLikeTool = await tempDirectory();
    await mkdir(join(dirWithDirectoryNamedLikeTool, exe));
    expect(
      await findFfmpegOnPath({ PATH: dirWithDirectoryNamedLikeTool }, process.platform),
    ).toBeUndefined();
  });

  it("names the real cause of a failed ffmpeg download", () => {
    expect(ffmpegDownloadReason("getaddrinfo EAI_AGAIN cdn.playwright.dev")).toBe(
      "the network connection failed",
    );
    expect(ffmpegDownloadReason("write ENOSPC: no space left on device")).toBe("the disk is full");
    expect(ffmpegDownloadReason("EACCES: permission denied")).toBe(
      "the browser cache folder is not writable",
    );
    expect(ffmpegDownloadReason("the download is still running")).toBe(
      "the download is still running",
    );
    expect(ffmpegDownloadReason("unexpected")).toBe("the download did not finish");
  });

  it("streams frames into ffmpeg stdin and resolves when it exits cleanly", async () => {
    const directory = await tempDirectory();
    const output = join(directory, "out.bin");
    const script =
      "const fs = require('fs'); let bytes = 0; process.stdin.on('data', (chunk) => { bytes += chunk.length; }).on('end', () => fs.writeFileSync(process.argv[1], String(bytes)));";
    await encodeFrameSequence(process.execPath, ["-e", script, output], frames("abc", "defgh"));
    expect(await readFile(output, "utf8")).toBe("8");
  });

  it("surfaces a failing ffmpeg with its last decoded stderr line, lossy on invalid bytes", async () => {
    const script =
      "process.stderr.write(Buffer.from([0x62,0x61,0x64,0xff,0x0a])); console.error('final failure'); process.exit(3);";
    await expect(
      encodeFrameSequence(process.execPath, ["-e", script], frames("frame")),
    ).rejects.toThrow("exit 3): final failure");
  });

  it("kills ffmpeg and rethrows when the frame source fails, instead of hanging", async () => {
    async function* broken() {
      yield Buffer.from("first");
      throw new Error("frame source broke");
    }
    const script = "process.stdin.resume(); setInterval(() => {}, 1000);";
    await expect(encodeFrameSequence(process.execPath, ["-e", script], broken())).rejects.toThrow(
      "frame source broke",
    );
  });
});

function platformExecutable() {
  return process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
}
