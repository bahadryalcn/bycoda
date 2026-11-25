import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
import {
  LiveStreamRelay,
  LiveStreamRelayError,
  buildRelayArgs,
  destinationUrl,
  escapeTee,
  parseRelayFailure,
  redactRelayText,
} from "./relay";

const youtube = {
  accountId: "youtube",
  server: "rtmps://a.rtmps.youtube.com/live2/",
  key: "yt-secret-key",
};
const facebook = {
  accountId: "facebook",
  server: "rtmps://live-api-s.facebook.com:443/rtmp",
  key: "FB-1?s_bl=1&s_psm=1&s_sc=abc",
};

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => {
    queueMicrotask(() => child.emit("close", 0));
    return true;
  });
  return child;
}

async function startRelay(destinations = [youtube, facebook]) {
  const child = fakeChild();
  const spawn = vi.fn(() => child as unknown as ChildProcess);
  const relay = await LiveStreamRelay.start({
    destinations,
    ffmpeg: "ffmpeg",
    spawn,
    port: 19350,
    token: "tok",
    isListening: async () => true,
  });
  return { child, relay, spawn };
}

it("joins server and key with exactly one slash", () => {
  expect(destinationUrl("rtmps://host/app/", "key")).toBe("rtmps://host/app/key");
  expect(destinationUrl("rtmps://host/app", "/key")).toBe("rtmps://host/app/key");
});

it("escapes the characters the tee muxer treats as separators", () => {
  expect(escapeTee("rtmp://h/a|b'c\\d")).toBe("rtmp://h/a\\|b\\'c\\\\d");
  expect(escapeTee("rtmps://h/app/key?x=1&y=2")).toBe("rtmps://h/app/key?x=1&y=2");
});

it("builds a loopback listener that copies to every destination and ignores failures", () => {
  const args = buildRelayArgs({
    port: 19350,
    token: "tok",
    destinations: [youtube, { ...facebook, key: "a|b" }],
  });
  expect(args).toEqual([
    "-hide_banner",
    "-loglevel",
    "warning",
    "-nostdin",
    "-analyzeduration",
    "2000000",
    "-probesize",
    "2000000",
    "-listen",
    "1",
    "-i",
    "rtmp://127.0.0.1:19350/live/tok",
    "-map",
    "0",
    "-c",
    "copy",
    "-f",
    "tee",
    "[f=flv:onfail=ignore]rtmps://a.rtmps.youtube.com/live2/yt-secret-key|" +
      "[f=flv:onfail=ignore]rtmps://live-api-s.facebook.com:443/rtmp/a\\|b",
  ]);
});

it("redacts destination URLs, keys and any other RTMP address", () => {
  const destinations = [youtube, facebook];
  const lines = [
    `[tee @ 0000] Slave '[f=flv:onfail=ignore]${destinationUrl(youtube.server, youtube.key)}': error opening: Input/output error`,
    `Failed to update header with correct duration for ${facebook.key}`,
    "Cannot open connection tcp://203.0.113.7:443?tcp_nodelay=0",
    "Unexpected rtmps://other.example/live/leaked-key reply",
  ];
  const redacted = lines.map((line) => redactRelayText(line, destinations)).join("\n");
  for (const secret of [
    youtube.key,
    "FB-1",
    "s_bl=1",
    "203.0.113.7",
    "other.example",
    "leaked-key",
    "youtube.com",
  ])
    expect(redacted).not.toContain(secret);
  expect(redacted).toContain("error opening: Input/output error");
});

it("parses the tee slave index of a destination that failed", () => {
  expect(
    parseRelayFailure(
      "[tee @ 000002b9a859f540] Slave muxer #1 failed: Error number -138 occurred, continuing with 1/2 slaves.",
    ),
  ).toEqual({ index: 1, detail: "Error number -138 occurred" });
  expect(
    parseRelayFailure("[tee @ 1] Slave '[f=flv]rtmp://h/k': error opening: x"),
  ).toBeUndefined();
  expect(parseRelayFailure("frame=1 fps=30")).toBeUndefined();
});

it("marks only the failed destination and never exposes a key in its detail", async () => {
  const { child, relay } = await startRelay();
  expect(relay.server).toBe("rtmp://127.0.0.1:19350/live");
  expect(relay.key).toBe("tok");
  child.stderr.write(
    `[tee @ 1] Slave '[f=flv:onfail=ignore]${destinationUrl(facebook.server, facebook.key)}': error opening: Error number -138 occurred\n`,
  );
  child.stderr.write("[tee @ 1] Slave muxer #1 failed: Error number -138 occurred, continu");
  child.stderr.write("ing with 1/2 slaves.\r\n");
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(relay.alive()).toBe(true);
  expect(relay.failures()).toEqual([
    { accountId: "facebook", detail: "Error number -138 occurred" },
  ]);
  expect(JSON.stringify(relay.failures())).not.toMatch(/FB-1|s_bl|facebook\.com/);
  expect(relay.lastLine()).not.toMatch(/FB-1|s_bl|facebook\.com/);
});

it("reports every destination failed when ffmpeg exits unexpectedly, but not after Stop", async () => {
  const { child, relay } = await startRelay();
  child.stderr.write(`Conversion failed! ${youtube.key}\n`);
  child.emit("close", 1);
  expect(relay.alive()).toBe(false);
  expect(relay.failures().map((entry) => entry.accountId)).toEqual(["youtube", "facebook"]);
  expect(JSON.stringify(relay.failures())).not.toContain(youtube.key);

  const stopped = await startRelay();
  await stopped.relay.stop();
  expect(stopped.child.kill).toHaveBeenCalledOnce();
  expect(stopped.relay.failures()).toEqual([]);
});

it("kills the process and rejects when ffmpeg never listens or exits at once", async () => {
  const child = fakeChild();
  await expect(
    LiveStreamRelay.start({
      destinations: [youtube, facebook],
      ffmpeg: "ffmpeg",
      spawn: () => child as unknown as ChildProcess,
      port: 19351,
      isListening: async () => false,
      readyDeadlineMs: 150,
    }),
  ).rejects.toBeInstanceOf(LiveStreamRelayError);
  expect(child.kill).toHaveBeenCalled();

  const dying = fakeChild();
  const failed = LiveStreamRelay.start({
    destinations: [youtube, facebook],
    ffmpeg: "ffmpeg",
    spawn: () => dying as unknown as ChildProcess,
    port: 19352,
    isListening: async () => false,
  });
  dying.stderr.write(`Could not bind ${youtube.key}\n`);
  dying.emit("close", 1);
  await expect(failed).rejects.toThrow("ffmpeg stopped: Could not bind [redacted]");
});
