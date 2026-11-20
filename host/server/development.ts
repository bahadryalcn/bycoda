import type { DevServerDetails } from "../../src/features/host-tools/devServerTypes";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
import { DevServerAccess } from "../dev-servers/dev-server-access";
import { createLogger } from "../diagnostics/logger";
import { WebControl } from "../web/web-control";
import type { ServerBindings } from "./bindings";

const logSourcesLog = createLogger("host.runtime-logs");
/** How long a log read waits for the source refresh it triggers before reading what exists. */
const LOG_SOURCES_WAIT_MS = 1_500;
const LOG_SOURCES_FAILURE_LOG_MS = 60_000;

export function createDevelopmentRuntime(
  dependencies: Pick<ServerBindings, "engine" | "devServers" | "server">,
) {
  const devServerAccess = new DevServerAccess(
    async (params) => {
      await dependencies.engine.store.project(String(params.projectId ?? ""));
      return (await dependencies.devServers.handle(
        "devServers.details",
        params,
        (await dependencies.engine.store.projects()).map((project) => ({
          id: project.id,
          name: project.name,
          path: project.cwd,
        })),
      )) as DevServerDetails;
    },
    () => {
      const address = dependencies.server.address();
      return address && typeof address !== "string" ? address.port : undefined;
    },
  );
  let failureLog: { name: string; loggedAt: number } | undefined;
  let failuresSinceLog = 0;
  // Refresh failures are logged once per error name per minute: the name, not the message,
  // because messages can carry paths or command output.
  const noteRefreshFailure = (error: unknown) => {
    const name = error instanceof Error ? error.name : "UnknownError";
    failuresSinceLog++;
    const now = monotonicNow();
    if (
      failureLog?.name === name &&
      elapsedSince(failureLog.loggedAt, now) < LOG_SOURCES_FAILURE_LOG_MS
    )
      return;
    logSourcesLog.warn("runtime log source refresh failed", {
      error: name,
      count: failuresSinceLog,
    });
    failuresSinceLog = 0;
    failureLog = { name, loggedAt: now };
  };
  /** Resolves once the sources are refreshed, or after a bounded wait so a slow discovery
   * never blocks a log read. A failed refresh is logged and the read goes on with the
   * sources that exist. */
  const refreshLogSources = async () => {
    const refresh = dependencies.devServers
      .refreshLogSources(
        (await dependencies.engine.store.projects()).map((project) => ({
          id: project.id,
          name: project.name,
          path: project.cwd,
        })),
      )
      .catch(noteRefreshFailure);
    const late = Symbol("late");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        refresh,
        new Promise<typeof late>((resolve) => {
          timer = setTimeout(() => resolve(late), LOG_SOURCES_WAIT_MS);
          timer.unref?.();
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const webControl = process.env.BYCODA_WEB_CONTROL_ORIGIN
    ? new WebControl(process.env.BYCODA_WEB_CONTROL_ORIGIN)
    : undefined;
  return { devServerAccess, refreshLogSources, webControl };
}
