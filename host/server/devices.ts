import { dirname } from "node:path";
import { BrowserRuntime } from "../browser/browser-runtime";
import { BrowserRecordingService } from "../browser/browser-recording";
import { findFfmpegOnPath } from "../browser/browser-recording-encode";
import { SessionBrowserRegistry } from "../browser/shared-browser";
import { ConversationPreviewWorkflow } from "../conversation/conversation-preview";
import { DevServersService } from "../dev-servers/dev-servers";
import { DeviceHost } from "../devices/device-host";
import { DevicePreviews } from "../devices/device-preview";
import { perfMetrics } from "../diagnostics/perf-metrics";
import { ResourceDiagnostics } from "../diagnostics/resource-diagnostics";
import { RuntimeLogMonitors } from "../execution/runtime-log-monitors";
import { RuntimeLogsService } from "../execution/runtime-logs";
import { RuntimeLogWaiter } from "../execution/runtime-log-wait";
import { RuntimeTerminalLogs } from "../execution/runtime-terminal-logs";
import { GenericAcpService } from "../providers/generic-acp";
import { HandoffHistoryStore } from "../tasks/handoff-history";
import type { ServerBindings } from "./bindings";
export function createDevicesRuntime(
  dependencies: Pick<
    ServerBindings,
    | "engine"
    | "recordWorkspaceActivity"
    | "terminals"
    | "managedWorkspaces"
    | "inWorkspace"
    | "startWorkspaceActivity"
    | "managed"
  >,
) {
  const featureDirectory = dirname(dependencies.engine.store.attachmentDir);
  const deviceHost = new DeviceHost(featureDirectory);
  const devicePreviews = new DevicePreviews(deviceHost, undefined, (action) =>
    dependencies.engine.store.db.outsideScope(action),
  );
  const genericAcp = new GenericAcpService(featureDirectory);
  const handoffHistory = new HandoffHistoryStore(featureDirectory);
  const diagnostics = new ResourceDiagnostics(Date.now, () => perfMetrics.snapshot());
  const browserRuntime = new BrowserRuntime(featureDirectory);
  const runtimeLogs = new RuntimeLogsService();
  const runtimeLogWaiter = new RuntimeLogWaiter(runtimeLogs);
  const terminalLogs = new RuntimeTerminalLogs(
    runtimeLogs,
    process.env.BYCODA_TERMINAL_LOG_BACKGROUND !== "0",
  );
  const touchTerminalWorkspace = (projectId: string, terminalId: unknown, closedCwd?: string) =>
    dependencies.recordWorkspaceActivity(async () => {
      const terminal = dependencies.terminals
        .list(projectId)
        .terminals.find((entry) => entry.id === terminalId);
      const cwd = terminal?.cwd ?? closedCwd;
      if (!cwd) return;
      const workspaces = await dependencies.managedWorkspaces.list({
        projectId,
        environmentId: dependencies.engine.store.environmentId,
      });
      for (const workspace of workspaces)
        if (dependencies.inWorkspace(cwd, workspace.path))
          await dependencies.managedWorkspaces.touchActivity(workspace.id);
    });
  const logMonitors = new RuntimeLogMonitors(browserRuntime.load, runtimeLogs);
  const browserRegistry = new SessionBrowserRegistry(browserRuntime.load, Date.now, {
    runtimeLogs,
  });
  const sharedBrowser = Object.assign(browserRegistry, {
    recordings: new BrowserRecordingService({
      browser: browserRegistry,
      dataDir: featureDirectory,
      findFfmpeg: async () => (await browserRuntime.ffmpegPath()) ?? findFfmpegOnPath(),
      ensureFfmpeg: () => browserRuntime.ensureFfmpeg(),
    }),
  });
  // Best-effort startup prune of recordings older than 24 hours; a failure never blocks the Host.
  void sharedBrowser.recordings.pruneStale().catch(() => undefined);
  const conversationPreviews = new ConversationPreviewWorkflow();
  const devServers = new DevServersService({
    runtimeLogs,
    startActivity: (cwd, ownerId) => dependencies.startWorkspaceActivity(cwd, "devServer", ownerId),
    workspaceIdForDirectory: async (cwd) =>
      (await dependencies.managed.list()).find((value) => dependencies.inWorkspace(cwd, value.path))
        ?.id,
  });
  return {
    featureDirectory,
    deviceHost,
    devicePreviews,
    genericAcp,
    handoffHistory,
    diagnostics,
    browserRuntime,
    runtimeLogs,
    runtimeLogWaiter,
    terminalLogs,
    touchTerminalWorkspace,
    logMonitors,
    sharedBrowser,
    conversationPreviews,
    devServers,
  };
}
