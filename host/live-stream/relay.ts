import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { findFfmpegOnPath } from "../browser/browser-recording-encode";

export type RelayDestination = { accountId: string; server: string; key: string };
export type RelayFailure = { accountId: string; detail: string };

/** Raised when a relay cannot be started; carries no ingest address or key. */
export class LiveStreamRelayError extends Error {}

const READY_DEADLINE_MS = 6_000;
const STOP_GRACE_MS = 4_000;
const REDACTED = "[redacted]";
type Spawn = (command: string, args: string[]) => ChildProcess;

/** Full RTMP destination for one platform: the server with the key appended as the stream name. */
export function destinationUrl(server: string, key: string) {
  return `${server.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
}

/** The tee muxer splits slave specs on `|` and unquotes `\` and `'`, so URLs escape all three. */
export function escapeTee(url: string) {
  return url.replace(/[\\'|]/g, (character) => `\\${character}`);
}

/** Arguments for a local ingest on 127.0.0.1 that copies the stream to every destination. */
export function buildRelayArgs(input: {
  port: number;
  token: string;
  destinations: readonly RelayDestination[];
}) {
  const slaves = input.destinations
    .map(({ server, key }) => `[f=flv:onfail=ignore]${escapeTee(destinationUrl(server, key))}`)
    .join("|");
  return [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-nostdin",
    // Short probing: ffmpeg opens its destinations only after probing, and OBS sends codec headers first.
    "-analyzeduration",
    "2000000",
    "-probesize",
    "2000000",
    "-listen",
    "1",
    "-i",
    `rtmp://127.0.0.1:${input.port}/live/${input.token}`,
    "-map",
    "0",
    "-c",
    "copy",
    "-f",
    "tee",
    slaves,
  ];
}

/** Removes every destination address, every key and any other RTMP URL from ffmpeg output. */
export function redactRelayText(text: string, destinations: readonly RelayDestination[]) {
  let redacted = text;
  for (const { server, key } of destinations) {
    for (const secret of [destinationUrl(server, key), escapeTee(destinationUrl(server, key)), key])
      if (secret) redacted = redacted.split(secret).join(REDACTED);
  }
  return redacted
    .replace(/rtmps?:\/\/[^\s'"\]|]+/gi, REDACTED)
    .replace(/tcp:\/\/[^\s'"\]|]+/gi, REDACTED)
    .replace(/[?&](?:key|token|s_[a-z]+)=[^\s&'"]+/gi, REDACTED);
}

/** The tee slave index and reason of a destination ffmpeg gave up on, otherwise undefined. */
export function parseRelayFailure(line: string): { index: number; detail: string } | undefined {
  const match = /Slave muxer #(\d+) failed: (.*?)(?:, continuing with \d+\/\d+ slaves)?\.?$/.exec(
    line.trim(),
  );
  return match ? { index: Number(match[1]), detail: match[2] ?? "" } : undefined;
}

function lineBreak(bytes: Buffer) {
  const feed = bytes.indexOf(10);
  const carriage = bytes.indexOf(13);
  return feed < 0 ? carriage : carriage < 0 ? feed : Math.min(feed, carriage);
}

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new LiveStreamRelayError("No free local port.")),
      );
    });
  });
}

/** ffmpeg accepts only one connection, so listening is detected by the port already being taken. */
async function isListening(port: number) {
  return new Promise<boolean>((resolve) => {
    const probe = createServer();
    probe.once("error", (error: NodeJS.ErrnoException) => resolve(error.code === "EADDRINUSE"));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(false)));
  });
}

type RelayOptions = {
  destinations: readonly RelayDestination[];
  ffmpeg?: string;
  spawn?: Spawn;
  port?: number;
  token?: string;
  isListening?: (port: number) => Promise<boolean>;
  readyDeadlineMs?: number;
};

/**
 * One ffmpeg process that receives the OBS stream on a private local address and forwards it to
 * every destination. A destination that fails is reported and the others keep streaming.
 */
export class LiveStreamRelay {
  /** Where OBS should publish. */
  readonly server: string;
  readonly key: string;
  private readonly failed = new Map<string, string>();
  private tail: string[] = [];
  private pending = Buffer.alloc(0);
  private exited = false;
  private stopping = false;
  private readonly closed: Promise<void>;

  private constructor(
    private readonly child: ChildProcess,
    private readonly destinations: readonly RelayDestination[],
    port: number,
    token: string,
  ) {
    this.server = `rtmp://127.0.0.1:${port}/live`;
    this.key = token;
    child.stderr?.on("data", (chunk: Buffer) => this.read(chunk));
    this.closed = new Promise<void>((resolve) => {
      child.once("error", () => {
        this.exited = true;
        resolve();
      });
      child.once("close", () => {
        if (this.pending.byteLength) this.line(this.pending.toString("utf8"));
        this.pending = Buffer.alloc(0);
        this.exited = true;
        resolve();
      });
    });
  }

  /** Starts ffmpeg and resolves once its local ingest accepts a publisher. */
  static async start(options: RelayOptions) {
    const ffmpeg = options.ffmpeg ?? (await findFfmpegOnPath());
    if (!ffmpeg) throw new LiveStreamRelayError("ffmpeg was not found on PATH.");
    const port = options.port ?? (await freePort());
    const token = options.token ?? randomBytes(18).toString("base64url");
    const args = buildRelayArgs({ port, token, destinations: options.destinations });
    // shortcut: stream keys are in the ffmpeg argv (readable by same-user processes), upgrade if ffmpeg gains a secret input.
    const run = options.spawn ?? ((command, argv) => spawn(command, argv, spawnOptions));
    const child = run(ffmpeg, args);
    const relay = new LiveStreamRelay(child, options.destinations, port, token);
    const listening = options.isListening ?? isListening;
    const deadline = Date.now() + (options.readyDeadlineMs ?? READY_DEADLINE_MS);
    while (!(await listening(port))) {
      if (relay.exited || Date.now() > deadline) {
        await relay.stop();
        throw new LiveStreamRelayError(
          relay.exited && relay.lastLine()
            ? `ffmpeg stopped: ${relay.lastLine()}`
            : "ffmpeg did not start listening.",
        );
      }
      await delay(100);
    }
    return relay;
  }

  /** Redacted text from the last ffmpeg output line. */
  lastLine() {
    return this.tail.at(-1);
  }

  alive() {
    return !this.exited;
  }

  /** Destinations ffmpeg dropped, or all of them once the process is gone unexpectedly. */
  failures(): RelayFailure[] {
    const detail = this.lastLine() ?? "The relay stopped.";
    return this.destinations.flatMap(({ accountId }) => {
      const own = this.failed.get(accountId);
      if (own !== undefined) return [{ accountId, detail: own }];
      return this.exited && !this.stopping ? [{ accountId, detail }] : [];
    });
  }

  private read(chunk: Buffer) {
    this.pending = Buffer.concat([this.pending, chunk]);
    for (let newline = lineBreak(this.pending); newline >= 0; newline = lineBreak(this.pending)) {
      this.line(this.pending.subarray(0, newline).toString("utf8"));
      this.pending = this.pending.subarray(newline + 1);
    }
    if (this.pending.byteLength > 64 * 1024) this.pending = Buffer.alloc(0);
  }

  private line(raw: string) {
    const text = raw.trim();
    if (!text) return;
    const failure = parseRelayFailure(text);
    const redacted = redactRelayText(text, this.destinations).slice(0, 200);
    this.tail.push(redacted);
    if (this.tail.length > 20) this.tail.shift();
    const destination = failure && this.destinations[failure.index];
    if (destination)
      this.failed.set(
        destination.accountId,
        redactRelayText(failure.detail, this.destinations).slice(0, 200),
      );
  }

  async stop() {
    this.stopping = true;
    if (this.exited) return;
    this.child.kill();
    const stopped = await Promise.race([
      this.closed.then(() => true),
      delay(STOP_GRACE_MS).then(() => false),
    ]);
    if (!stopped) {
      this.child.kill("SIGKILL");
      await Promise.race([this.closed, delay(STOP_GRACE_MS)]);
    }
    this.exited = true;
  }
}

const spawnOptions: SpawnOptions = { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] };

/** Creates relays and tells callers whether ffmpeg exists; replaced in tests. */
export interface LiveStreamRelays {
  available(): Promise<boolean>;
  start(destinations: readonly RelayDestination[]): Promise<LiveStreamRelay>;
}

export const processRelays: LiveStreamRelays = {
  available: async () => Boolean(await findFfmpegOnPath()),
  start: (destinations) => LiveStreamRelay.start({ destinations }),
};
