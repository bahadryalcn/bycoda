import { invoke } from "@tauri-apps/api/core";
import {
  killPty,
  readyPtyBridge,
  resizePty,
  setPtyVisible,
  spawnPty,
  subscribePty,
  writePty,
} from "../../../platform/tauri/pty";
import type { SshEndpoint } from "../../connections/model/serverInventory";
import { terminalOutputBuffer } from "../model/outputBuffer";
import { takeTerminalCommand } from "../model/terminalLaunchCommand";
import { terminalInput } from "../model/terminalInput";
import { loadTerminalProfile } from "../model/terminalProfiles";

export type TerminalLifecycleState = "opened-on-computer" | "exited" | "failed" | "closed";
export type TerminalShellIntegration = "auto" | "bash" | "zsh" | "powershell";

/** What kind of native process this runtime owns. Exactly one variant per view. */
export type TerminalPtyLaunch =
  | { kind: "key-generation"; path: string }
  | {
      kind: "ssh-saved";
      connectionId: string;
      shellIntegration?: TerminalShellIntegration;
      agentForwardingReviewId?: string;
      expectedConfigurationDigest?: string;
      httpProxyTicketId?: string;
    }
  | {
      kind: "ssh-quick";
      endpoint: SshEndpoint;
      shellIntegration?: TerminalShellIntegration;
      agentForwardingReviewId?: string;
      httpProxyTicketId?: string;
    }
  | { kind: "local"; cwd: string; profile: () => string | undefined };

export type TerminalPtyLaunchInput = {
  keyGenerationPath?: string;
  sshConnectionId?: string;
  sshEndpoint?: SshEndpoint;
  shellIntegration?: TerminalShellIntegration;
  agentForwardingReviewId?: string;
  expectedConfigurationDigest?: string;
  httpProxyTicketId?: string;
  cwd: string;
  profile: () => string | undefined;
};

/** Same precedence the view always used: key generation, saved SSH, quick SSH, local. */
export function terminalPtyLaunch(input: TerminalPtyLaunchInput): TerminalPtyLaunch {
  if (input.keyGenerationPath) return { kind: "key-generation", path: input.keyGenerationPath };
  if (input.sshConnectionId)
    return {
      kind: "ssh-saved",
      connectionId: input.sshConnectionId,
      shellIntegration: input.shellIntegration,
      agentForwardingReviewId: input.agentForwardingReviewId,
      expectedConfigurationDigest: input.expectedConfigurationDigest,
      httpProxyTicketId: input.httpProxyTicketId,
    };
  if (input.sshEndpoint)
    return {
      kind: "ssh-quick",
      endpoint: input.sshEndpoint,
      shellIntegration: input.shellIntegration,
      agentForwardingReviewId: input.agentForwardingReviewId,
      httpProxyTicketId: input.httpProxyTicketId,
    };
  return { kind: "local", cwd: input.cwd, profile: input.profile };
}

type Output = string | Uint8Array;

export type TerminalPtyRuntimeOptions = {
  id: string;
  privateTerminal: boolean;
  launch: TerminalPtyLaunch;
  dimensions(): { cols: number; rows: number };
  /** Parser admission. `consumed` returns the output flow-control credit. */
  writeOutput(data: Output, consumed?: () => void): void;
  /** Whether the terminal is actually on screen right now. */
  isVisible(): boolean;
  /** Live reviewed-source guard, read immediately before each native spawn. */
  canStart: { readonly current: (() => boolean) | undefined };
  /** Live pending-authority check, read immediately before each native spawn. */
  authorizeStart: { readonly current: (() => Promise<boolean>) | undefined };
  lifecycle(state: TerminalLifecycleState): void;
  /** The native process ended on its own. View-side reset only. */
  onExit(code: number | null | undefined): void;
  /** Spawn succeeded and the process is live. */
  onSpawned(): void;
  /** Spawn was refused or failed while the view is still attached. */
  onStartFailed(message: string): void;
  /** Serial input failed or backed up while the view is still attached. */
  onInputFailure(message: string): void;
};

/**
 * Teardown still in flight per PTY id. A runtime that starts with an id another
 * runtime (or a StrictMode replay of the same view) is still retiring must wait,
 * or the late kill lands on the replacement shell and drops its data handler.
 * This fence is also how a new view re-attaches to the same terminal identity.
 */
const stoppingPtys = new Map<string, Promise<void>>();

/**
 * The single owner of one PTY's lifecycle for one mounted view.
 *
 * - `start()` waits out any retiring runtime with the same id, subscribes to
 *   output, passes the reviewed-source guards and spawns exactly once.
 * - `detach()` stops view-driven work (input, output delivery) without
 *   deciding the fate of the process.
 * - `retire()` is the only place a PTY is killed: it waits for the pending
 *   start, then unsubscribes and kills only if this runtime really spawned.
 */
export function createTerminalPtyRuntime(options: TerminalPtyRuntimeOptions) {
  const { id, privateTerminal, launch } = options;
  let closed = false;
  let exited = false;
  let didStart = false;
  let spawned = false;
  let unsubscribe = () => {};
  // The native side holds a hidden terminal's output instead of streaming it.
  let reportedVisible: boolean | undefined;
  let starting: Promise<void> | undefined;
  let retiring: Promise<void> | undefined;

  const output = terminalOutputBuffer(
    (data, consumed) => options.writeOutput(data, consumed),
    undefined,
    true,
  );

  const input = terminalInput(
    async (data) => {
      await starting;
      if (closed || exited) throw new Error("Terminal is disconnected.");
      await writePty(id, data);
    },
    (error) => {
      if (closed) return;
      options.onInputFailure(error instanceof Error ? error.message : String(error));
    },
  );

  const reportVisibility = () => {
    if (closed || !spawned) return;
    const next = options.isVisible();
    if (next === reportedVisible) return;
    reportedVisible = next;
    void setPtyVisible(id, next).catch(() => {
      if (reportedVisible === next) reportedVisible = undefined;
    });
  };

  const spawnNative = (): Promise<void> | void => {
    const { cols, rows } = options.dimensions();
    switch (launch.kind) {
      case "key-generation":
        return invoke<void>("ssh_key_generate", {
          id,
          path: launch.path,
          cols,
          rows,
        });
      case "ssh-saved": {
        const { shellIntegration } = launch;
        return invoke<void>("ssh_terminal_spawn", {
          id,
          connectionId: launch.connectionId,
          cols,
          rows,
          ...(shellIntegration ? { shellIntegration } : {}),
          ...(launch.agentForwardingReviewId
            ? { agentForwardingReviewId: launch.agentForwardingReviewId }
            : {}),
          ...(launch.expectedConfigurationDigest
            ? {
                expectedConfigurationDigest: launch.expectedConfigurationDigest,
              }
            : {}),
          ...(launch.httpProxyTicketId ? { httpProxyTicketId: launch.httpProxyTicketId } : {}),
        });
      }
      case "ssh-quick": {
        const { shellIntegration } = launch;
        return invoke<void>("ssh_terminal_quick_spawn", {
          id,
          endpoint: launch.endpoint,
          cols,
          rows,
          ...(shellIntegration ? { shellIntegration } : {}),
          ...(launch.agentForwardingReviewId
            ? { agentForwardingReviewId: launch.agentForwardingReviewId }
            : {}),
          ...(launch.httpProxyTicketId ? { httpProxyTicketId: launch.httpProxyTicketId } : {}),
        });
      }
      case "local":
        return spawnPty(id, launch.cwd, cols, rows, launch.profile() ?? loadTerminalProfile());
    }
  };

  const subscribeAndSpawn = async () => {
    if (closed) return;
    unsubscribe = subscribePty(
      id,
      (data, consumed) => {
        if (closed) {
          consumed?.();
          return;
        }
        output.append(data, consumed);
      },
      (code) => {
        if (closed) return;
        exited = true;
        spawned = false;
        input.dispose();
        options.lifecycle("exited");
        options.onExit(code);
        const status = code == null ? "" : ` (${code})`;
        output.append(`\n[process exited${status}]\r\n`);
      },
      true,
    );
    await readyPtyBridge();
    if (closed) return;
    const stale = () => !!options.canStart.current && !options.canStart.current();
    if (stale()) throw new Error("Reviewed terminal source changed or became private");
    if (options.authorizeStart.current && !(await options.authorizeStart.current()))
      throw new Error("Reviewed terminal authority expired or was revoked");
    if (closed || stale()) throw new Error("Reviewed terminal source changed or became private");
    didStart = true;
    return spawnNative();
  };

  return {
    id,
    get spawned() {
      return spawned;
    },
    /** The view released this runtime (`detach`/`retire`); view-side work must stop. */
    get detached() {
      return closed;
    },
    /** Neither detached nor exited: input and output still belong to a shell. */
    get live() {
      return !closed && !exited;
    },
    /** Begin the single start of this runtime. Later calls are ignored. */
    start() {
      if (starting) return;
      const pending = (stoppingPtys.get(id) ?? Promise.resolve())
        .then(subscribeAndSpawn)
        .then(() => {
          if (!closed && !exited) {
            spawned = true;
            reportVisibility();
            options.onSpawned();
            const command = privateTerminal ? undefined : takeTerminalCommand(id);
            if (command) return writePty(id, `${command}\r`);
          }
        })
        .catch((error) => {
          options.lifecycle("failed");
          spawned = false;
          if (!closed) {
            const message = error instanceof Error ? error.message : String(error);
            exited = true;
            options.onStartFailed(message);
          }
          throw error;
        });
      starting = pending;
      void pending.catch(() => undefined);
      void pending.then(
        () => {
          if (!closed && !exited) options.lifecycle("opened-on-computer");
        },
        () => {},
      );
    },
    enqueueInput(data: string): Promise<boolean> {
      return input.enqueue(data);
    },
    /** False when the shell is gone; the view then keeps its disconnected state. */
    resumeInput(): boolean {
      if (closed || exited) return false;
      input.resume();
      return true;
    },
    /** Output delivery is held while the terminal is hidden. */
    setOutputVisible(visible: boolean) {
      output.setVisible(visible);
    },
    reportVisibility,
    resize(cols: number, rows: number): Promise<void> {
      return (starting ?? Promise.resolve()).then(() =>
        closed ? undefined : resizePty(id, cols, rows),
      );
    },
    /** Stop view-driven input and output delivery. The process is not touched. */
    detach() {
      closed = true;
      input.dispose();
      output.dispose();
    },
    /**
     * The only decision to end the process. Waits for a pending start, then
     * unsubscribes and kills the PTY this runtime actually spawned, once.
     */
    retire(): Promise<void> {
      if (retiring) return retiring;
      closed = true;
      input.dispose();
      output.dispose();
      const pending = starting ?? Promise.resolve();
      const stopping: Promise<void> = pending
        .catch(() => undefined)
        .then(() => {
          unsubscribe();
          return didStart ? killPty(id) : undefined;
        })
        .then(
          () => {
            options.lifecycle("closed");
          },
          (error) => {
            options.lifecycle("failed");
            throw error;
          },
        )
        .finally(() => {
          if (stoppingPtys.get(id) === stopping) stoppingPtys.delete(id);
        });
      retiring = stopping;
      stoppingPtys.set(id, stopping);
      spawned = false;
      return stopping;
    },
  };
}

export type TerminalPtyRuntime = ReturnType<typeof createTerminalPtyRuntime>;
