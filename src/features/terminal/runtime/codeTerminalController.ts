import { featureHost } from "../../connections/public/hostFeatureClient";
import { remoteRequest } from "../../connections/public/connections";
import { parseRemotePath } from "../../connections/public/remoteProjects";
import type {
  HostTerminal,
  HostTerminalList,
  HostTerminalRead,
} from "../../../shared/model/host-contracts/terminals";
import { killPty } from "../../../platform/tauri/pty";
import { listTerminalProfiles, loadTerminalProfile } from "../model/terminalProfiles";
import { queueTerminalRun, discardTerminalRun } from "../model/terminalLaunchCommand";
import { CODE_OUTPUT_LIMIT, matchingCodeProfile, type CodeShellKind } from "../model/codeTerminal";
import { graphemes } from "../../../shared/lib/text/truncate";

export type CodeTerminalState = {
  id: string;
  phase: "starting" | "running" | "exited" | "unknown";
  shell: string;
  profile?: string;
  output: string;
  truncated: boolean;
  exitCode: number | null;
  error?: string;
};
export type CodeTerminalOptions = {
  cwd: string;
  projectCwd: string;
  native: boolean;
  command: string;
  shellKind: CodeShellKind;
  isCurrent(): boolean;
};

/** One explicit click owns one process; reads and failures never replay its launch. */
export function createCodeTerminal(options: CodeTerminalOptions) {
  let state: CodeTerminalState = {
    id: crypto.randomUUID(),
    phase: "starting",
    shell: options.shellKind,
    output: "",
    truncated: false,
    exitCode: null,
  };
  const listeners = new Set<() => void>();
  let readHost: (() => Promise<void>) | undefined;
  let stopHost: (() => Promise<void>) | undefined;
  let started = false;
  let reading: Promise<void> | undefined;
  const update = (patch: Partial<CodeTerminalState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const append = (data: string, truncated = false) => {
    const output = state.output + data;
    let bounded = output;
    if (output.length > CODE_OUTPUT_LIMIT) {
      const parts = graphemes(output);
      let start = parts.length;
      let remaining = CODE_OUTPUT_LIMIT;
      while (start > 0 && parts[start - 1].length <= remaining) remaining -= parts[--start].length;
      bounded = parts.slice(start).join("");
    }
    const patch = {
      output: bounded,
      truncated: state.truncated || truncated || output.length > CODE_OUTPUT_LIMIT,
    };
    // xterm already draws native chunks. Only notify its React owner at process settlement.
    if (options.native) state = { ...state, ...patch };
    else update(patch);
  };
  const assertCurrent = () => {
    if (!options.isCurrent())
      throw new Error("Conversation or working directory changed before execution.");
  };
  const refresh = async () => {
    if (!readHost || state.phase === "exited") return;
    if (reading) return reading;
    reading = readHost()
      .catch((reason) =>
        update({
          phase: "unknown",
          error: reason instanceof Error ? reason.message : String(reason),
        }),
      )
      .finally(() => {
        reading = undefined;
      });
    return reading;
  };
  return {
    snapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async start() {
      if (started) return;
      started = true;
      try {
        if (
          !options.command.trim() ||
          options.command.length > 10_000 ||
          options.command.includes("\0")
        )
          throw new Error("Command must contain 1 to 10000 characters and no NUL bytes.");
        assertCurrent();
        if (options.native) {
          if (parseRemotePath(options.cwd))
            throw new Error("Remote commands cannot run on this computer.");
          const catalog = await listTerminalProfiles();
          const profile = matchingCodeProfile(
            catalog.profiles,
            options.shellKind,
            loadTerminalProfile(),
          );
          assertCurrent();
          queueTerminalRun(state.id, {
            command: options.command,
            shellKind: options.shellKind,
            onOutput: append,
            onExit: (exitCode) => update({ phase: "exited", exitCode }),
            onError: (error) => update({ phase: "unknown", error }),
          });
          update({ phase: "running", shell: profile.name, profile: profile.id });
          return;
        }
        // Capture the exact machine/project once. Poll/stop never rediscover a replacement Host.
        const { machine, projectId } = await featureHost(
          options.projectCwd,
          "transport.ws.terminals.command.v1",
        );
        const request = <T>(method: string, params: Record<string, unknown>) =>
          remoteRequest<T>(
            machine.id,
            method,
            { ...params, projectId },
            false,
            true,
            machine.environmentId,
          );
        const catalog = await request<HostTerminalList>("terminals.list", {});
        if (!catalog.writable) throw new Error("This terminal is read-only.");
        assertCurrent();
        const terminal = await request<HostTerminal>("terminals.create", {
          requestId: state.id,
          cwd: parseRemotePath(options.cwd)?.hostPath ?? options.cwd,
          name: "Code block",
          command: options.command,
          shellKind: options.shellKind,
        });
        update({ id: terminal.id, phase: "running", shell: terminal.shell });
        let cursor = 0;
        readHost = async () => {
          const result = await request<HostTerminalRead>("terminals.read", {
            id: terminal.id,
            after: cursor,
            limit: 65536,
          });
          cursor = result.cursor;
          append(result.output, result.truncated);
          // The exit record can arrive before the final output page is drained.
          if (result.terminal.state === "exited" && !result.hasMore)
            update({ phase: "exited", exitCode: result.terminal.exitCode, error: undefined });
          else update({ phase: "running", error: undefined });
        };
        stopHost = async () => {
          await request("terminals.close", { id: terminal.id });
        };
        await refresh();
      } catch (reason) {
        discardTerminalRun(state.id);
        update({
          phase: "unknown",
          error: reason instanceof Error ? reason.message : String(reason),
        });
      }
    },
    refresh,
    async stop() {
      try {
        if (stopHost) {
          await stopHost();
          await refresh();
        } else if (options.native && state.profile) {
          await killPty(state.id);
          update({ phase: "unknown", error: "Stop requested. Command completion is unknown." });
        } else
          throw new Error(
            "Terminal identity is unknown. Inspect the original machine before stopping or starting another command.",
          );
      } catch (reason) {
        update({ error: reason instanceof Error ? reason.message : String(reason) });
      }
    },
  };
}
export type CodeTerminalController = ReturnType<typeof createCodeTerminal>;
