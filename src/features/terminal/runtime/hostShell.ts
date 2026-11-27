import { featureHost } from "../../connections/public/hostFeatureClient";
import { remoteRequest } from "../../connections/public/connections";
import { parseRemotePath } from "../../connections/public/remoteProjects";
import { classifyFailureLifetime } from "../../connections/public/transientFailure";
import type {
  HostTerminal,
  HostTerminalRead,
} from "../../../shared/model/host-contracts/terminals";

/** Host-owned interactive shells: `terminals.create` without a command runs a PTY. */
export const HOST_SHELL_CAPABILITY = "transport.ws.terminals.v2";
/** The Host accepts 16384 UTF-8 bytes per write; 4096 UTF-16 units encode to at most 12288. */
const INPUT_CHUNK = 4096;
/** Read delay after each read that returned nothing new; typing and output reset it. */
const QUIET_POLL_MS = [40, 80, 150, 300, 600, 1000] as const;
/** A terminal nobody sees is read rarely; showing it again reads at once. */
const HIDDEN_POLL_MS = 3000;
const MAX_FAILURE_DELAY_MS = 10_000;

export type HostShellTarget = { projectCwd: string; cwd: string };

export type HostShellHandlers = {
  onOutput(data: string): void;
  onExit(code: number | null): void;
  /** Reading stopped for good (terminal or machine gone); the shell's fate is unknown. */
  onFailure(reason: unknown): void;
};

export type HostShellDeps = {
  resolve: (
    cwd: string,
    capability: string,
  ) => Promise<{
    machine: { id: string; environmentId: string };
    projectId: string;
  }>;
  request: <T>(
    machineId: string,
    method: string,
    params: Record<string, unknown>,
    environmentId: string,
  ) => Promise<T>;
  newRequestId: () => string;
};

const defaultDeps: HostShellDeps = {
  resolve: featureHost,
  request: (machineId, method, params, environmentId) =>
    remoteRequest(machineId, method, params, false, true, environmentId),
  newRequestId: () => crypto.randomUUID(),
};

/** Splits input into Host-sized writes without separating a surrogate pair. */
export function hostShellInputChunks(data: string, size = INPUT_CHUNK): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < data.length) {
    let end = Math.min(start + size, data.length);
    const last = data.charCodeAt(end - 1);
    if (end < data.length && end - start > 1 && last >= 0xd800 && last <= 0xdbff) end -= 1;
    chunks.push(data.slice(start, end));
    start = end;
  }
  return chunks;
}

/**
 * One interactive shell on the project's Host machine, for remote projects without SSH.
 * The Host has no output push, so reads poll: fast while the shell is busy or typed into,
 * slower while quiet, rarely while hidden.
 */
export function createHostShell(
  target: HostShellTarget,
  handlers: HostShellHandlers,
  deps: HostShellDeps = defaultDeps,
) {
  let call: (<T>(method: string, params: Record<string, unknown>) => Promise<T>) | undefined;
  let terminalId: string | undefined;
  let cursor = 0;
  let stopped = false;
  let exited = false;
  let visible = true;
  let quiet = 0;
  let failures = 0;
  let reading = false;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (delay: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => void read(), delay);
  };
  const idleDelay = () =>
    visible ? QUIET_POLL_MS[Math.min(quiet, QUIET_POLL_MS.length - 1)] : HIDDEN_POLL_MS;

  const read = async () => {
    timer = undefined;
    if (stopped || !call || !terminalId || reading) return;
    reading = true;
    let next: number | undefined;
    try {
      const result = await call<HostTerminalRead>("terminals.read", {
        id: terminalId,
        after: cursor,
        limit: 65536,
      });
      if (stopped) return;
      failures = 0;
      cursor = result.cursor;
      if (result.output) {
        quiet = 0;
        handlers.onOutput(result.output);
      } else quiet += 1;
      if (result.terminal.state === "exited" && !result.hasMore) {
        stopped = true;
        exited = true;
        handlers.onExit(result.terminal.exitCode);
        return;
      }
      next = result.hasMore ? 0 : idleDelay();
    } catch (reason) {
      if (stopped) return;
      if (classifyFailureLifetime(reason) !== "transient") {
        stopped = true;
        handlers.onFailure(reason);
        return;
      }
      failures += 1;
      next = Math.min(500 * 2 ** failures, MAX_FAILURE_DELAY_MS);
    } finally {
      reading = false;
    }
    if (stopped) return;
    schedule(again && failures === 0 ? 0 : (next ?? idleDelay()));
    again = false;
  };

  /** Input or a reveal just happened: read its echo now and poll fast again. */
  const poke = () => {
    if (stopped || !terminalId) return;
    quiet = 0;
    if (reading) again = true;
    else if (failures === 0) schedule(0);
  };

  return {
    async start(cols: number, rows: number): Promise<void> {
      // Capture the machine and project once; later calls never rediscover a replacement Host.
      const { machine, projectId } = await deps.resolve(target.projectCwd, HOST_SHELL_CAPABILITY);
      call = <T>(method: string, params: Record<string, unknown>) =>
        deps.request<T>(machine.id, method, { ...params, projectId }, machine.environmentId);
      const remote = parseRemotePath(target.cwd);
      const terminal = await call<HostTerminal>("terminals.create", {
        // A fresh identity per start: a replayed view must not adopt a retired shell.
        requestId: deps.newRequestId(),
        ...(remote && remote.environmentId === machine.environmentId
          ? { cwd: remote.hostPath }
          : {}),
        cols,
        rows,
      });
      terminalId = terminal.id;
      if (!stopped) schedule(0);
    },
    async write(data: string): Promise<void> {
      if (!call || !terminalId || exited) throw new Error("Terminal is disconnected.");
      // Sent once and never retried: a repeated key would type twice.
      for (const chunk of hostShellInputChunks(data))
        await call("terminals.write", { id: terminalId, data: chunk });
      poke();
    },
    async resize(cols: number, rows: number): Promise<void> {
      if (!call || !terminalId || stopped) return;
      await call("terminals.resize", { id: terminalId, cols, rows }).catch((reason: unknown) => {
        // A missed resize is corrected by the next one; a lost terminal surfaces through reads.
        if (classifyFailureLifetime(reason) === "transient") return;
        throw reason;
      });
    },
    setVisible(next: boolean) {
      visible = next;
      if (next) poke();
    },
    /** Ends the Host shell this runtime created. An exited shell's record is cleared best-effort. */
    async close(): Promise<void> {
      stopped = true;
      clearTimeout(timer);
      if (!call || !terminalId) return;
      try {
        await call("terminals.close", { id: terminalId });
      } catch (reason) {
        if (!exited) throw reason;
      }
    },
  };
}

export type HostShell = ReturnType<typeof createHostShell>;
