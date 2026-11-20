import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

/** One `git cat-file --batch-command` answer: header plus body (contents only). */
export type CatFileAnswer = { oid: string; type: string; size: number; body?: Buffer } | null;

type Pending = {
  contents: boolean;
  resolve: (answer: CatFileAnswer) => void;
  reject: (error: Error) => void;
};

export type CatFileReaderOptions = {
  git: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  /** The process exits after this long without a request. */
  idleMs?: number;
};

const OID = /^[a-f0-9]{40}$/;

/** One git process and the requests it still owes an answer to, in order. */
type Session = {
  proc: ChildProcessWithoutNullStreams;
  pending: Pending[];
  buffer: Buffer;
  timer?: NodeJS.Timeout;
  stderr: string;
};

/**
 * A long-lived `git cat-file --batch-command` process. Each lookup is one line on stdin
 * instead of a new git process: process creation blocks the Host event loop (tens of ms on
 * Windows, hundreds under load) and native-buffer reads made three per artifact.
 * Refs and new loose objects or packs are resolved per command, so writes by other git
 * processes are visible. Call `close()` before anything rewrites packs (gc), which an open
 * process would keep mapped (and locked on Windows); requests already sent still get answers.
 */
export function createCatFileReader(options: CatFileReaderOptions) {
  const idleMs = options.idleMs ?? 30_000;
  let current: Session | null = null;
  let idle: NodeJS.Timeout | undefined;

  function fail(session: Session, error: Error) {
    if (current === session) current = null;
    clearTimeout(session.timer);
    const failed = session.pending;
    session.pending = [];
    for (const request of failed) request.reject(error);
    if (session.proc.exitCode === null) session.proc.kill();
  }

  /** One deadline per session, rearmed whenever an answer arrives. */
  function arm(session: Session) {
    clearTimeout(session.timer);
    session.timer = session.pending.length
      ? setTimeout(
          () =>
            fail(session, new Error(`git cat-file exceeded its ${options.timeoutMs} ms deadline`)),
          options.timeoutMs,
        )
      : undefined;
  }

  /** Settles as many queued requests as the buffered stdout completes. */
  function drain(session: Session) {
    while (session.pending.length) {
      const end = session.buffer.indexOf(10);
      if (end < 0) break;
      const line = session.buffer.subarray(0, end).toString();
      const request = session.pending[0];
      let answer: CatFileAnswer;
      let used = end + 1;
      if (line.endsWith(" missing") || line.endsWith(" ambiguous")) answer = null;
      else {
        const [oid, type, size] = line.split(" ");
        const value = Number(size);
        if (!OID.test(oid) || !type || !Number.isSafeInteger(value) || value < 0) {
          fail(session, new Error("git cat-file returned an unexpected header"));
          return;
        }
        answer = { oid, type, size: value };
        if (request.contents) {
          if (session.buffer.length < used + value + 1) break;
          answer.body = Buffer.from(session.buffer.subarray(used, used + value));
          used += value + 1;
        }
      }
      session.buffer = session.buffer.subarray(used);
      session.pending.shift();
      arm(session);
      request.resolve(answer);
    }
    if (!session.pending.length && current === session) armIdle();
  }

  function start(): Session {
    if (current) return current;
    const proc = spawn(options.git, ["cat-file", "--batch-command"], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const session: Session = { proc, pending: [], buffer: Buffer.alloc(0), stderr: "" };
    current = session;
    proc.stdout.on("data", (chunk: Buffer) => {
      session.buffer = session.buffer.length ? Buffer.concat([session.buffer, chunk]) : chunk;
      drain(session);
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      // Lossy decoding: diagnostics only.
      if (session.stderr.length < 4096) session.stderr += chunk.toString();
    });
    proc.on("error", (error) => fail(session, error));
    proc.on("close", (code) =>
      fail(
        session,
        new Error(`git cat-file exited (${code}): ${session.stderr.trim().slice(0, 500)}`),
      ),
    );
    // EPIPE after an early exit is reported through "close".
    proc.stdin.on("error", () => {});
    return session;
  }

  function request(command: "info" | "contents", spec: string): Promise<CatFileAnswer> {
    if (/[\r\n]/.test(spec)) return Promise.reject(new Error("Invalid git object name"));
    const session = start();
    clearTimeout(idle);
    return new Promise<CatFileAnswer>((resolve, reject) => {
      session.pending.push({ contents: command === "contents", resolve, reject });
      if (session.pending.length === 1) arm(session);
      session.proc.stdin.write(`${command} ${spec}\n`);
    });
  }

  /** Detaches the current process; on stdin EOF git answers what it was sent, then exits. */
  function retire() {
    clearTimeout(idle);
    const session = current;
    current = null;
    if (!session) return;
    if (session.pending.length) session.proc.stdin.end();
    else fail(session, new Error("git cat-file reader closed"));
  }

  function armIdle() {
    clearTimeout(idle);
    idle = setTimeout(retire, idleMs);
    idle.unref();
  }

  return {
    info: (spec: string) => request("info", spec),
    contents: (spec: string) => request("contents", spec),
    close: retire,
  };
}
export type CatFileReader = ReturnType<typeof createCatFileReader>;
