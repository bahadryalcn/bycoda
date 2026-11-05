import { fileURLToPath } from "node:url";
import { prepareProviderGuardian } from "../provider-guardian-deployment";
import { TunnelError } from "../../src/integrations/external-tunnels";
import {
  tunnelEnvironment,
  tunnelOutput,
  type TunnelCommand,
  type TunnelEvent,
} from "./tunnel-providers";
import type { OwnedTunnelProcess } from "./tunnel-process";

/** A missing packaged guardian uses the existing worker and makes no custody claim. */
export function startNativeTunnel(
  command: TunnelCommand,
  emit: (event: TunnelEvent) => void,
  fallback: () => OwnedTunnelProcess,
): OwnedTunnelProcess {
  let stopping = false;
  let stopWork: Promise<void> | undefined;
  // Set once the provider process exists; a setup failure before that runs nothing.
  let started = false;
  const setup = (async (): Promise<OwnedTunnelProcess> => {
    const prepared = await prepareProviderGuardian(fileURLToPath(new URL("./", import.meta.url)), {
      allowLinuxOriginalChild: true,
    });
    if (!prepared) return fallback();
    try {
      if (!(await prepared.supportsTunnelCustody())) return fallback();
      const child = prepared.spawn({
        command: command.program,
        args: command.args,
        cwd: process.cwd(),
        env: tunnelEnvironment(command),
      });
      started = true;
      const startup = setTimeout(() => {
        emit({ type: "error", issue: "startup-timeout" });
        void child.stop().catch(() => emit({ type: "error", issue: "stop-failed" }));
      }, 45_000);
      const parser = tunnelOutput(command.provider, (event) => {
        if (event.type === "ready" || event.type === "error") clearTimeout(startup);
        emit(event);
      });
      const stdout = parser.stream();
      const stderr = parser.stream();
      child.stdout.on("data", (bytes: Buffer) => stdout.write(bytes));
      child.stderr.on("data", (bytes: Buffer) => stderr.write(bytes));
      void child.started.catch(() => emit({ type: "error", issue: "process-error" }));
      child.once("close", () => {
        clearTimeout(startup);
        stdout.end();
        stderr.end();
        void child.retirement.then(
          () => {
            if (!stopping) emit({ type: "error", issue: "unexpected-exit" });
            emit({ type: "exit" });
          },
          () => emit({ type: "error", issue: "stop-failed" }),
        );
      });
      return {
        async stop() {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              child.stop(),
              new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new TunnelError("stop-failed")), 7_000);
              }),
            ]);
          } finally {
            clearTimeout(timer);
          }
          if (!child.retirementVerified) throw new TunnelError("stop-failed");
        },
      };
    } finally {
      await prepared.dispose();
    }
  })();
  void setup.catch(() => emit({ type: "error", issue: "process-error" }));
  return {
    stop() {
      stopping = true;
      stopWork ??= setup
        .then(
          (child) => child.stop(),
          (error: unknown) => {
            if (started) throw error;
          },
        )
        .catch(() => {
          stopWork = undefined;
          throw new TunnelError("stop-failed");
        });
      return stopWork;
    },
  };
}
