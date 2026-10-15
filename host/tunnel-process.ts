import { spawn, type ChildProcess } from "node:child_process";
import { TunnelError } from "../src/integrations/external-tunnels";
import {
  tunnelEnvironment,
  tunnelOutput,
  type TunnelCommand,
  type TunnelEvent,
} from "./tunnel-providers";

export type OwnedTunnelProcess = { stop: () => Promise<void> };

/** Only a retained ChildProcess handle is signalled, never a stored PID or name. */
export function startProviderProcess(
  command: TunnelCommand,
  emit: (event: TunnelEvent) => void,
): OwnedTunnelProcess {
  const child = spawn(command.program, command.args, {
    windowsHide: true,
    shell: false,
    detached: false,
    env: tunnelEnvironment(command),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let closed = false;
  let stopping = false;
  let stopPromise: Promise<void> | undefined;
  let failed = false;
  const fail = (event: TunnelEvent) => {
    if (event.type === "error") failed = true;
    emit(event);
  };
  const output = tunnelOutput(command.provider, (event) => {
    if (event.type === "ready") clearTimeout(startup);
    fail(event);
  });
  const stdout = output.stream();
  const stderr = output.stream();
  child.stdout?.on("data", (chunk: Buffer) => stdout.write(chunk));
  child.stderr?.on("data", (chunk: Buffer) => stderr.write(chunk));
  const startup = setTimeout(() => {
    fail({ type: "error", issue: "startup-timeout" });
    void stop().catch(() => fail({ type: "error", issue: "stop-failed" }));
  }, 45_000);
  child.once("error", (error: NodeJS.ErrnoException) => {
    clearTimeout(startup);
    fail({ type: "error", issue: error.code === "ENOENT" ? "cli-missing" : "process-error" });
  });
  child.once("close", () => {
    closed = true;
    clearTimeout(startup);
    stdout.end();
    stderr.end();
    if (!stopping && !failed) fail({ type: "error", issue: "unexpected-exit" });
    emit({ type: "exit" });
  });
  const stop = (): Promise<void> => {
    if (closed) return Promise.resolve();
    if (stopPromise) return stopPromise;
    stopping = true;
    clearTimeout(startup);
    stopPromise = stopChild(child).catch(() => {
      stopPromise = undefined;
      throw new TunnelError("stop-failed");
    });
    return stopPromise;
  };
  return { stop };
}

function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const force = setTimeout(() => child.kill("SIGKILL"), 3_000);
    const timeout = setTimeout(() => {
      cleanup();
      reject(new TunnelError("stop-failed"));
    }, 5_000);
    const finish = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      clearTimeout(force);
      clearTimeout(timeout);
      child.off("close", finish);
    };
    child.once("close", finish);
    child.kill();
  });
}

/** The guardian watches its host's IPC lifetime and owns the provider child. */
export function runTunnelWorker(
  parent: Pick<NodeJS.Process, "on" | "send" | "exit"> = process,
  launch: typeof startProviderProcess = startProviderProcess,
): void {
  let child: OwnedTunnelProcess | undefined;
  let ended = false;
  let started = false;
  let exiting = false;
  const send = (event: TunnelEvent) => {
    if (event.type === "exit") exiting = true;
    try {
      if (parent.send)
        parent.send(event, () => {
          if (event.type === "exit") parent.exit(0);
        });
      else if (event.type === "exit") parent.exit(0);
    } catch {
      if (event.type === "exit") parent.exit(0);
    }
  };
  const shutdown = async () => {
    if (ended) return;
    ended = true;
    try {
      await child?.stop();
      if (!exiting) parent.exit(0);
    } catch {
      send({ type: "error", issue: "stop-failed" });
      ended = false;
    }
  };
  parent.on("disconnect", () => void shutdown());
  parent.on("SIGTERM", () => void shutdown());
  parent.on("SIGINT", () => void shutdown());
  parent.on("message", (message: { type?: string; command?: TunnelCommand }) => {
    if (message?.type === "stop") {
      void shutdown();
      return;
    }
    if (message?.type !== "start" || started || ended || !message.command) return;
    started = true;
    try {
      child = launch(message.command, (event) => {
        send(event);
        if (event.type === "error") void shutdown();
      });
    } catch {
      send({ type: "error", issue: "process-error" });
      parent.exit(1);
    }
  });
}

/** Secrets cross private IPC and then the provider's environment, never argv. */
export function startTunnelGuardian(
  command: TunnelCommand,
  emit: (event: TunnelEvent) => void,
): OwnedTunnelProcess {
  const child = spawn(process.execPath, [process.argv[1], "tunnel-worker"], {
    windowsHide: true,
    shell: false,
    detached: false,
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  let closed = false;
  let stopping = false;
  let stopPromise: Promise<void> | undefined;
  const startup = setTimeout(() => {
    emit({ type: "error", issue: "startup-timeout" });
    void stop().catch(() => emit({ type: "error", issue: "stop-failed" }));
  }, 55_000);
  child.once("spawn", () => {
    child.send({ type: "start", command }, (error) => {
      if (error) emit({ type: "error", issue: "process-error" });
    });
  });
  child.on("message", (event: TunnelEvent) => {
    if (!event || !["ready", "error", "exit"].includes(event.type)) return;
    if (event.type === "ready" || event.type === "error") clearTimeout(startup);
    emit(event);
  });
  child.once("error", () => {
    clearTimeout(startup);
    closed = true;
    emit({ type: "error", issue: "process-error" });
    emit({ type: "exit" });
  });
  // Explicit IPC disconnect can leave `close` pending after exit on Windows.
  // Stdio is ignored here; process exit acknowledges the guardian's lifetime.
  child.once("exit", () => {
    clearTimeout(startup);
    closed = true;
    if (!stopping) emit({ type: "error", issue: "unexpected-exit" });
    emit({ type: "exit" });
  });
  const stop = (): Promise<void> => {
    if (closed) return Promise.resolve();
    if (stopPromise) return stopPromise;
    stopping = true;
    clearTimeout(startup);
    stopPromise = new Promise<void>((resolve, reject) => {
      const finish = () => {
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(() => {
        child.off("exit", finish);
        stopPromise = undefined;
        reject(new TunnelError("stop-failed"));
      }, 7_000);
      child.once("exit", finish);
      if (child.connected) child.send({ type: "stop" }, () => {});
    });
    return stopPromise;
  };
  return { stop };
}
