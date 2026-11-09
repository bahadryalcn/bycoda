import { StringDecoder } from "node:string_decoder";
import { RuntimeLogLineRedactor, RuntimeLogsService } from "./runtime-logs";
import type { RuntimeLogSource } from "../../src/features/host-tools/runtimeLogTypes";

type Stream = {
  redactor: RuntimeLogLineRedactor;
  source: RuntimeLogSource;
  decoder: StringDecoder;
  sequence: number;
  line: string;
  skipLine: boolean;
  truncated: boolean;
  escape: "text" | "escape" | "csi" | "osc" | "oscEnd";
};

type ExitFacts = { exitCode?: number; signal?: string };

/** The exit facts a closed packet carries; malformed values are ignored, never guessed. */
function exitFacts(params: Record<string, unknown>): ExitFacts | undefined {
  const facts: ExitFacts = {};
  const { exitCode, signal } = params;
  if (typeof exitCode === "number" && Number.isSafeInteger(exitCode) && exitCode >= 0)
    facts.exitCode = exitCode;
  if (typeof signal === "string" && /^[A-Za-z0-9 ._+-]{1,64}$/.test(signal)) facts.signal = signal;
  return facts.exitCode !== undefined || facts.signal !== undefined ? facts : undefined;
}

/** Receives only authenticated desktop PTY output, not agent tool input. */
export class RuntimeTerminalLogs {
  private streams = new Map<string, Stream>();
  private monitors = new Map<
    string,
    { projectId?: string; expiresAt: number; active: boolean; sequence: number }
  >();
  constructor(
    private logs: RuntimeLogsService,
    private readonly backgroundCapture = true,
    private readonly now = Date.now,
  ) {}

  monitor(
    owner: string,
    id: string,
    projectId: string | undefined,
    active: boolean,
    sequence: number,
  ): void {
    if (
      !/^[a-zA-Z0-9_-]{1,128}$/.test(id) ||
      !owner ||
      !Number.isSafeInteger(sequence) ||
      sequence < 0
    )
      throw new Error("Invalid terminal log monitor");
    const key = `${owner}:${id}`;
    const now = this.now();
    for (const [key, lease] of this.monitors) if (lease.expiresAt <= now) this.monitors.delete(key);
    const previous = this.monitors.get(key);
    if (previous && sequence <= previous.sequence) return;
    if (previous && previous.projectId !== projectId)
      throw new Error("Terminal log monitor scope changed");
    if (!previous && this.monitors.size >= 256) throw new Error("Too many terminal log monitors");
    this.monitors.set(key, { projectId, active, sequence, expiresAt: now + 30_000 });
  }

  demand(projectId: string): { enabled: boolean; background: boolean } {
    const now = this.now();
    for (const [key, lease] of this.monitors) if (lease.expiresAt <= now) this.monitors.delete(key);
    return {
      enabled:
        this.backgroundCapture ||
        [...this.monitors.values()].some(
          (lease) => lease.active && (!lease.projectId || lease.projectId === projectId),
        ),
      background: this.backgroundCapture,
    };
  }

  append(projectId: string, params: Record<string, unknown>) {
    const id = String(params.terminalId ?? "");
    const sequence = params.sequence;
    const encoded = params.data;
    if (
      !/^[a-zA-Z0-9_-]{1,128}$/.test(id) ||
      !Number.isSafeInteger(sequence) ||
      Number(sequence) < 0
    )
      throw new Error("Invalid terminal log stream");
    if (
      typeof encoded !== "string" ||
      encoded.length > 700_000 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
    )
      throw new Error("Invalid terminal log data");
    const key = `${projectId}:${id}`;
    const exit = params.closed ? exitFacts(params) : undefined;
    let stream = this.streams.get(key);
    if (!stream) {
      if (params.closed && !params.interrupted && !exit) return { accepted: false };
      if (this.streams.size >= 128) {
        const oldest = this.streams.keys().next().value!;
        const retired = this.streams.get(oldest)!;
        this.logs.setSource({ ...retired.source, available: false });
        this.streams.delete(oldest);
      }
      stream = {
        redactor: new RuntimeLogLineRedactor(),
        source: {
          id: `server:terminal:${id}`,
          kind: "server",
          label: "bycoda terminal",
          projectId,
          available: true,
        },
        decoder: new StringDecoder("utf8"),
        sequence: -1,
        line: "",
        skipLine: false,
        truncated: false,
        escape: "text",
      };
      this.streams.set(key, stream);
    }
    if (Number(sequence) <= stream.sequence) return { accepted: false };
    if (params.interrupted || Number(sequence) !== stream.sequence + 1) {
      this.logs.add(stream.source, {
        timestamp: Date.now(),
        level: "warn",
        message: "Terminal log capture was interrupted; some output is unavailable.",
        details: {
          stream: "pty",
          captureGap: true,
          expectedSequence: stream.sequence + 1,
          receivedSequence: Number(sequence),
          interrupted: !!params.interrupted,
        },
      });
      // Never concatenate a secret fragment across dropped queue chunks.
      stream.redactor.interrupt(stream.line);
      stream.decoder = new StringDecoder("utf8");
      stream.line = "";
      stream.skipLine = true;
      stream.escape = "text";
    }
    stream.sequence = Number(sequence);
    this.logs.setSource(stream.source);
    this.consume(stream, stream.decoder.write(Buffer.from(encoded, "base64")));
    if (params.closed) {
      this.consume(stream, stream.decoder.end());
      this.emit(stream);
      if (exit)
        this.logs.add(stream.source, {
          timestamp: Date.now(),
          level: "info",
          message: exit.signal
            ? `Terminal process ended by ${exit.signal}.`
            : `Terminal process exited with code ${exit.exitCode}.`,
          details: { stream: "pty", ...exit },
        });
      this.logs.setSource({
        ...stream.source,
        available: false,
        reason: "The terminal has closed. Retained logs remain available.",
      });
      this.streams.delete(key);
    }
    return { accepted: true };
  }

  private emit(stream: Stream) {
    const message = stream.redactor.redact(stream.line);
    if (!stream.skipLine && message.trim()) {
      const level =
        /\b(?:error|fatal|exception|EADDRINUSE)\b|^\s*(?:TypeError|ReferenceError|SyntaxError):/i.test(
          message,
        )
          ? "error"
          : /\b(?:warn(?:ing)?|deprecated|deprecation)\b/i.test(message)
            ? "warn"
            : /^\s*\[?debug\b/i.test(message)
              ? "debug"
              : "info";
      this.logs.add(stream.source, {
        timestamp: Date.now(),
        level,
        message: message + (stream.truncated ? "… [truncated]" : ""),
        details: { stream: "pty" },
      });
    }
    stream.line = "";
    stream.skipLine = false;
    stream.truncated = false;
  }

  private consume(stream: Stream, text: string) {
    // Ordinary ASCII output without control sequences can be appended in bulk.
    // Keep overflow observation so redaction still sees delimiters beyond the cap.
    if (stream.escape === "text" && /^[\x20-\x7e\t\r\n]*$/.test(text)) {
      // One forward scan per line break keeps splitting linear in the chunk size.
      const lineBreak = /[\r\n]/g;
      let start = 0;
      while (start <= text.length) {
        lineBreak.lastIndex = start;
        const match = lineBreak.exec(text);
        const index = match ? match.index : text.length;
        const segment = text.slice(start, index);
        const room = Math.max(0, 8192 - stream.line.length);
        stream.line += segment.slice(0, room);
        const overflow = segment.slice(room);
        if (overflow) {
          stream.redactor.observeOverflow(overflow, stream.line);
          stream.truncated = true;
        }
        if (index === text.length) break;
        this.emit(stream);
        start = index + 1;
      }
      return;
    }
    for (const char of text) {
      if (stream.escape === "osc") {
        if (char === "\x07") stream.escape = "text";
        else if (char === "\x1b") stream.escape = "oscEnd";
        continue;
      }
      if (stream.escape === "oscEnd") {
        stream.escape = char === "\\" ? "text" : "osc";
        continue;
      }
      if (stream.escape === "csi") {
        if (char >= "@" && char <= "~") stream.escape = "text";
        continue;
      }
      if (stream.escape === "escape") {
        stream.escape = char === "[" ? "csi" : char === "]" ? "osc" : "text";
        continue;
      }
      if (char === "\x1b") {
        stream.escape = "escape";
        continue;
      }
      if (char === "\n" || char === "\r") {
        this.emit(stream);
        continue;
      }
      if (char < " " && char !== "\t") continue;
      if (stream.line.length < 8192) stream.line += char;
      else {
        stream.redactor.observeOverflow(char, stream.line);
        stream.truncated = true;
      }
    }
  }
}
