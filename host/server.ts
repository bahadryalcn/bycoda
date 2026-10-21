import { ModelCatalogCache } from "./model-catalog-cache";
import { inlineSessionSync } from "./inlineSessionSync";
import { HostCrews } from "./crews";
import { probeNativeCodexImageCapability } from "./social-images";
import { execFileAsync as exec } from "../src/shared/lib/processExecution.node";
import { sessionConversationPage } from "../src/features/agent-app/model/sessionConversation";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpHttp } from "./mcp-http";
import { readHarnessSkill, searchHarnessSkills } from "./harness-skills";
import { skillInvocationTokens } from "../src/features/skills/model/skillTokens";
import { hostname, homedir } from "node:os";
import { RuntimeTerminalLogs } from "./runtime-terminal-logs";
import { HostTerminals } from "./terminals";
import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import {
  HOST_PROTOCOL_VERSION,
  type HostSession,
  type HostSessionSummary,
  type RemoteProvider,
  type SessionSync,
} from "../src/features/connections/model/protocol";
import { HostEngine, parseCommand } from "./engine";
import { isClearSessionCommand } from "../src/features/sessions/model/newSessionCommand";
import { HostAutomations } from "./automations";
import { SocialService, type SocialPrincipal } from "./social";
import { socialAgentGenerator } from "./social-agent";
import { OsSocialCredentials } from "./social-credentials";
import { SocialTransport } from "./social-transport";
import { XBrowserSessions } from "./social-browser";
import { SocialPeers } from "./social-peers";
import { createSocialAdapters } from "../src/integrations/social/platformAdapters";
import { HostTasks } from "./tasks";
import { AttachmentOwnership } from "./attachment-ownership";
import { HostGoals } from "./goals";
import { HostStewards } from "./stewards";
import { basename, dirname, join } from "node:path";
import { DeviceHost } from "./device-host";
import { DevicePreviews } from "./device-preview";
import type { DeviceAction } from "../src/features/devices/types";
import { GenericAcpService } from "./generic-acp";
import { HandoffHistoryStore } from "./handoff-history";
import { ResourceDiagnostics } from "./resource-diagnostics";
import { perfMetrics, mcpMetricName } from "./perf-metrics";
import { performance } from "node:perf_hooks";
import { BrowserRuntime } from "./browser-runtime";
import { SharedBrowser } from "./shared-browser";
import { RuntimeLogMonitors } from "./runtime-log-monitors";
import { DevServersService } from "./dev-servers";
import { DevServerAccess } from "./dev-server-access";
import { RuntimeLogsService, scrubRuntimeLogText } from "./runtime-logs";
import { RuntimeLogAccess, runtimeLogToolQuery } from "./runtime-log-tools";
import {
  ConversationDesktopRelay,
  conversationToolCatalog,
  validateConversationTool,
} from "./conversation-tools";
import { openDevServerBrowser } from "./dev-server-browser";
import type { DevServerDetails } from "../src/features/host-tools/devServerTypes";
import { WebControl } from "./web-control";
import type { GenericAcpConfig } from "../src/features/providers/model/genericAcp";
import type { HandoffHistory } from "../src/features/sessions/model/handoffBudget";
import { DesktopSessions } from "./desktopSessions";
import { SessionQueues } from "./session-queue";
import { sameQueuedModelTarget } from "../src/features/sessions/model/messageQueue";
import { parseRemoteAttachments, resolveAttachments } from "./attachments";
import { DesktopDelete } from "./desktopDelete";
import { HostNotes, hostInbox } from "./host-notes";
import {
  ConversationWorkspaceTools,
  isWorkspaceConversationTool,
} from "./conversation-workspace-tools";
import { ProviderInboxBridge } from "./provider-inbox";
import { MobilePairing } from "./mobile-pairing";
import { createMobileAccessService } from "./mobile-access";
import { MobileLanAccess } from "./mobile-lan";
import { ExternalTunnels } from "./tunnels";
import {
  parseRemoteInboxOperation,
  inboxOperationWrites,
} from "../src/features/inbox/model/remoteInbox";
import { branchCache } from "./git-actions";
import { withOverlay } from "./desktopLive";
import { writeAttachmentChunk, readAttachmentChunk, attachmentUploadStatus } from "./attachments";
import { sessionWorkCwd, type LinkedWorkItem } from "../src/features/sessions/model/session";
import { parseGithubWorkItemUrl } from "../src/features/sessions/model/sessionWorkItem";
import { SyncTransfers, serializedResponse } from "./sync-transfer";
import { RevisionWaits } from "./revisionWait";
import {
  TranscriptPages,
  transcriptPage,
  partialSessionSync,
  previewRewindHistory,
  previewSession,
} from "./transcriptPage";
import { RemoteChanges } from "./remoteChanges";
import { GitWatches } from "./git-watch";
import { syncPull, syncPush } from "./sync";
import type { SyncOp } from "../src/features/sync/model/syncProtocol";
import { browseHostDirectories, createHostDirectory } from "./browse";
import { createHostBranch, hostBranches, switchHostBranch } from "./git-branches";
import { createHostWorktree, hostWorktrees, resolveHostWorktreeAsync } from "./git-worktrees";
import {
  createHostPath,
  hostFileDiff,
  hostGitAction,
  hostGitIndex,
  indexHostFiles,
  listHostFiles,
  readHostFile,
  searchHostContent,
  searchHostFiles,
  writeHostFile,
} from "./workspace";
import { WorkspaceCommands } from "./workspace-commands";
import { discoverCodexModels } from "../src/integrations/harness/providers/codex/codexCatalog";
import { discoverClaudeModels } from "../src/integrations/harness/providers/claude/claudeCatalog";
import { discoverCursorModels } from "../src/integrations/harness/providers/cursor/cursorCatalog";
import { discoverGrokModels } from "../src/integrations/harness/providers/grok/grokCatalog";
import { discoverOpenCodeModels } from "../src/integrations/harness/providers/opencode/opencodeCatalog";
import {
  discoverPiModels,
  discoverOmpModels,
} from "../src/integrations/harness/providers/pi/piCatalog";
import { discoverFxModels } from "../src/integrations/harness/providers/fx/fxCatalog";
import { discoverHermesModels } from "../src/integrations/harness/providers/hermes/hermesCatalog";
import { discoverAntigravityModels } from "../src/integrations/harness/providers/antigravity/antigravityCatalog";
import { setHarnessModels, type AgentModel } from "../src/features/sessions/model/models";
import { listShellProfiles, setChosenProfile } from "./shellProfiles";
import {
  resolveAntigravityBinary,
  resolveClaudeBinary,
  resolveCodexBinary,
  resolveCursorBinary,
  resolveFxBinary,
  resolveGrokBinary,
  resolveHermesBinary,
  resolveOmpBinary,
  resolveOpenCodeBinary,
  resolvePiBinary,
} from "../src/integrations/harness/core/child";

import { resolveGeminiBinary } from "../src/integrations/harness/core/child";
import { discoverGeminiModels } from "../src/integrations/harness/providers/gemini/geminiCatalog";

// Providers also add models server-side, without a CLI update.
const resolveBinary: Record<RemoteProvider, () => Promise<{ path: string }>> = {
  codex: () => resolveCodexBinary(),
  claude: () => resolveClaudeBinary(),
  cursor: () => resolveCursorBinary(),
  grok: () => resolveGrokBinary(),
  opencode: () => resolveOpenCodeBinary(),
  pi: () => resolvePiBinary(),
  omp: () => resolveOmpBinary(),
  fx: () => resolveFxBinary(),
  hermes: () => resolveHermesBinary(),
  antigravity: () => resolveAntigravityBinary(),
  gemini: () => resolveGeminiBinary(),
  acp: async () => ({ path: "configured-acp" }),
};
// A 1 MiB text file can expand to 6 MiB when JSON escapes control characters.
// Existing files.write sends both the original and replacement contents.
const MAX_BODY = 16 * 1024 * 1024;
const discoverModels: Record<RemoteProvider, (cwd: string) => Promise<AgentModel[]>> = {
  codex: discoverCodexModels,
  claude: discoverClaudeModels,
  cursor: discoverCursorModels,
  grok: discoverGrokModels,
  opencode: discoverOpenCodeModels,
  pi: discoverPiModels,
  omp: discoverOmpModels,
  fx: discoverFxModels,
  hermes: discoverHermesModels,
  antigravity: discoverAntigravityModels,
  gemini: discoverGeminiModels,
  acp: async () => [],
};

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("Request is too large");
    chunks.push(chunk);
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid request");
  return value as Record<string, unknown>;
}

/** Identifies each installed provider CLI. An update changes its real path or
 * modification time, which invalidates the catalog the old version reported. */
async function providerBinaries(providers: RemoteProvider[]): Promise<string> {
  const binaries = await Promise.all(
    providers.map(async (provider) => {
      try {
        const file = await realpath((await resolveBinary[provider]()).path);
        return `${file}:${(await stat(file)).mtimeMs}`;
      } catch {
        return "";
      }
    }),
  );
  return binaries.join("\n");
}

/** Run id watchers use for a turn the desktop app is running. */
const DESKTOP_RUN_ID = "desktop";
const MAX_DESKTOP_VIEWS = 32;
const MAX_MEMOIZED_VIEWS = 4;
/** Long-poll ticks may reuse a desktop database read this recent. */
const WATCH_STAMP_MS = 200;

export function createHostServer(
  engine: HostEngine,
  providers: RemoteProvider[],
  lifecycle?: (request: IncomingMessage, response: ServerResponse) => void,
  automations = new HostAutomations(engine.store, engine),
  tasks = new HostTasks(engine.store, engine),
  desktop = new DesktopSessions(),
  goals = new HostGoals(engine.store, engine, tasks),
  stewards = new HostStewards(engine.store, engine, tasks),
  socialOverride?: SocialService,
  tunnelsOverride?: ExternalTunnels,
  terminalsOverride?: HostTerminals,
) {
  const featureDirectory = dirname(engine.store.attachmentDir);
  const deviceHost = new DeviceHost(featureDirectory);
  const devicePreviews = new DevicePreviews(deviceHost);
  const genericAcp = new GenericAcpService(featureDirectory);
  const handoffHistory = new HandoffHistoryStore(featureDirectory);
  const diagnostics = new ResourceDiagnostics(Date.now, () => perfMetrics.snapshot());
  const browserRuntime = new BrowserRuntime(featureDirectory);
  const runtimeLogs = new RuntimeLogsService();
  const terminalLogs = new RuntimeTerminalLogs(runtimeLogs);
  const terminals = terminalsOverride ?? new HostTerminals();
  const logMonitors = new RuntimeLogMonitors(browserRuntime.load, runtimeLogs);
  const sharedBrowser = new SharedBrowser(browserRuntime.load, Date.now, { runtimeLogs });
  const devServers = new DevServersService({ runtimeLogs });
  const devServerAccess = new DevServerAccess(
    async (params) => {
      engine.store.project(String(params.projectId ?? ""));
      return (await devServers.handle(
        "devServers.details",
        params,
        engine.store
          .projects()
          .map((project) => ({ id: project.id, name: project.name, path: project.cwd })),
      )) as DevServerDetails;
    },
    () => {
      const address = server.address();
      return address && typeof address !== "string" ? address.port : undefined;
    },
  );
  const refreshLogSources = () => {
    void devServers
      .refreshLogSources(
        engine.store.projects().map((project) => ({
          id: project.id,
          name: project.name,
          path: project.cwd,
        })),
      )
      .catch(() => {});
  };
  const webControl = process.env.BYCODA_WEB_CONTROL_ORIGIN
    ? new WebControl(process.env.BYCODA_WEB_CONTROL_ORIGIN)
    : undefined;
  const inHost = (id: string) => {
    try {
      engine.store.session(id);
      return true;
    } catch {
      return false;
    }
  };
  const desktopDelete = new DesktopDelete();
  const sessionQueues = new SessionQueues(engine.store.db);
  const attachmentOwnership = new AttachmentOwnership(engine.store);
  /** A desktop-only session on this machine, matched to a registered project. */
  const desktopSnapshot = (id: string) => {
    if (!id || inHost(id)) return undefined;
    const cwd = desktop.projectCwd(id);
    const project = cwd
      ? engine.store.projects().find((p) => desktop.samePath(p.cwd, cwd))
      : undefined;
    const snapshot = project && desktop.snapshot(id, project.id);
    return snapshot &&
      (snapshot.session.harness === "acp" ||
        providers.includes(snapshot.session.harness as RemoteProvider))
      ? snapshot
      : undefined;
  };
  const adopt = (id: string) => {
    const snapshot = desktopSnapshot(id);
    if (snapshot) engine.adoptSession(snapshot);
    else refresh(id);
  };
  const featureSession = (id: string) => {
    const snapshot = desktopSnapshot(id);
    if (snapshot) return snapshot;
    return engine.store.session(id);
  };
  const queueSessionStatus = (id: string) => {
    const metadata = desktop.metadata(id);
    if (
      metadata &&
      (metadata.harness === "acp" || providers.includes(metadata.harness as RemoteProvider)) &&
      engine.store.projects().some((project) => desktop.samePath(project.cwd, metadata.cwd))
    )
      return metadata.running ? "running" : "idle";
    return engine.store.sessionStatus(id);
  };
  const explicitSkillNames = (id: string) =>
    skillInvocationTokens(
      featureSession(id)
        .session.blocks.filter((block) => block.role === "user")
        .at(-1)?.text ?? "",
    ).map((token) => token.name.replace(/^skill:/, ""));
  const xBrowser = new XBrowserSessions(join(featureDirectory, "social"));
  const social =
    socialOverride ??
    new SocialService(
      engine.store,
      new OsSocialCredentials(
        join(featureDirectory, "social", "credentials"),
        engine.store.environmentId,
      ),
      createSocialAdapters(
        undefined,
        process.env.BYCODA_SOCIAL_GRAPH_VERSION,
        process.env.BYCODA_SOCIAL_LINKEDIN_VERSION,
      ),
      join(featureDirectory, "social"),
      featureSession,
      Date.now,
      socialAgentGenerator(join(featureDirectory, "social")),
      xBrowser.adapter(),
    );
  social.forgetBrowserSession ??= async (accountId) => {
    await xBrowser.workflows.cancelAccount(social, accountId);
    await xBrowser.forget(accountId);
  };
  social.cancelBrowserWorkflow ??= (accountId) =>
    xBrowser.workflows.cancelAccount(social, accountId);
  const runtimeLogAccess = new RuntimeLogAccess(social);
  const conversationAccess = new RuntimeLogAccess(social);
  const conversationDesktop = new ConversationDesktopRelay(engine.store.environmentId);
  const socialTransport = new SocialTransport(social, xBrowser);
  const socialPeers = new SocialPeers(
    social,
    new OsSocialCredentials(
      join(featureDirectory, "social", "peer-credentials"),
      engine.store.environmentId,
    ),
  );
  /** Pulls turns the desktop app ran in an adopted session since. */
  const refresh = (id: string, known?: { updatedAt: number; running: boolean }) => {
    let current;
    try {
      current = engine.store.session(id);
    } catch {
      return;
    }
    if (!current.desktop) return;
    const stamp = known ?? desktop.stamp(id);
    if (!stamp) return;
    if (stamp.running)
      throw new Error("This session is running in bycoda on that computer. Wait for it to finish.");
    if (stamp.updatedAt <= current.desktop.updatedAt) return;
    const snapshot = desktop.snapshot(id, current.projectId);
    if (snapshot) engine.refreshFromDesktop(snapshot);
  };
  /** Where watchers of `id` should look: the desktop app's copy for a
   * desktop-only session, or for an adopted one the app is running a turn in. */
  const desktopWatch = (id: string, polling = false) => {
    if (!id) return undefined;
    let hosted: HostSession | undefined;
    try {
      hosted = engine.store.session(id);
    } catch {
      /* desktop-only */
    }
    if (hosted && (!hosted.desktop || hosted.status === "running")) return undefined;
    const stamp = desktop.stamp(id, polling ? WATCH_STAMP_MS : 0);
    if (!stamp) return undefined;
    if (hosted && !stamp.running) return undefined;
    const overlay = desktop.live.overlay(id);
    return {
      projectId: hosted?.projectId,
      running: stamp.running,
      revision: Math.max(stamp.updatedAt, overlay?.changedAt ?? 0),
    };
  };
  /** The desktop copy with its live prompts; a running one carries a run id
   * so watchers can stop it and answer its prompts. */
  const desktopView = (id: string, projectId?: string): HostSession | undefined => {
    // Watchers re-request the same unchanged transcript many times (pages,
    // block fetches, polls); parsing it again is only needed once it moves.
    const stamp = desktop.stamp(id);
    const key =
      stamp && (projectId || !inHost(id))
        ? `${id}\0${projectId ?? ""}\0${stamp.updatedAt}\0${stamp.running}\0${desktop.live.overlay(id)?.changedAt ?? 0}`
        : undefined;
    const known = key ? viewMemo.get(key) : undefined;
    if (known) return known;
    const view = buildDesktopView(id, projectId);
    if (key && view) {
      for (const old of viewMemo.keys()) if (old.startsWith(`${id}\0`)) viewMemo.delete(old);
      viewMemo.set(key, view);
      while (viewMemo.size > MAX_MEMOIZED_VIEWS) viewMemo.delete(viewMemo.keys().next().value!);
    }
    return view;
  };
  const viewMemo = new Map<string, HostSession>();
  const buildDesktopView = (id: string, projectId?: string): HostSession | undefined => {
    const snapshot = projectId ? desktop.snapshot(id, projectId) : desktopSnapshot(id);
    if (!snapshot) return undefined;
    const overlay = desktop.live.overlay(id);
    return {
      ...snapshot,
      revision: Math.max(snapshot.revision, overlay?.changedAt ?? 0),
      ...(snapshot.status === "running" ? { runId: DESKTOP_RUN_ID } : {}),
      ...(snapshot.blockRevisions
        ? {
            blockRevisions: {
              ...snapshot.blockRevisions,
              ...Object.fromEntries(
                (overlay?.pending ?? []).map((block) => [
                  block.id,
                  overlay?.changedAt ?? snapshot.revision,
                ]),
              ),
            },
          }
        : {}),
      session: withOverlay(snapshot.session, overlay),
    };
  };
  /** Per-block change revisions of watched desktop copies, so a watcher
   * fetches only what changed, as for the host's own sessions. */
  const views = new Map<
    string,
    {
      revision: number;
      first: number;
      revs: Map<string, number>;
      json: Map<string, string>;
      bytes: number;
    }
  >();
  const desktopSync = (view: HostSession, client?: number): SessionSync => {
    const id = view.session.id;
    let entry = views.get(id);
    if (!entry || entry.revision !== view.revision) {
      const revs = new Map<string, number>();
      const json = new Map<string, string>();
      for (const block of view.session.blocks) {
        const persisted = view.blockRevisions?.[block.id];
        const text = persisted !== undefined ? `revision:${persisted}` : JSON.stringify(block);
        json.set(block.id, text);
        revs.set(
          block.id,
          entry && entry.json.get(block.id) === text ? entry.revs.get(block.id)! : view.revision,
        );
      }
      entry = {
        revision: view.revision,
        first: entry?.first ?? view.revision,
        revs,
        json,
        bytes: [...json].reduce(
          (sum, [blockId, text]) => sum + (blockId.length + text.length) * 2 + 64,
          0,
        ),
      };
      views.delete(id);
      views.set(id, entry);
      if (views.size > MAX_DESKTOP_VIEWS) views.delete(views.keys().next().value!);
      let bytes = [...views.values()].reduce((sum, view) => sum + view.bytes, 0);
      while (bytes > 64 * 1024 * 1024 && views.size) {
        const key = views.keys().next().value!;
        bytes -= views.get(key)!.bytes;
        views.delete(key);
      }
    }
    if (client === view.revision) return { kind: "unchanged", revision: client };
    if (client === undefined || client < entry.first || client > view.revision)
      return { kind: "snapshot", value: view };
    const {
      session: { blocks, ...session },
      ...rest
    } = view;
    const revs = entry.revs;
    return {
      kind: "delta",
      base: client,
      value: { ...rest, session },
      blockIds: blocks.map((block) => block.id),
      blocks: blocks.filter((block) => (revs.get(block.id) ?? view.revision) > client),
    };
  };
  /** Like `refresh`, for reads: a running desktop turn just isn't pulled yet. */
  const catchUp = (id: string, known?: { updatedAt: number; running: boolean }) => {
    try {
      refresh(id, known);
    } catch {
      /* the desktop is mid-turn; serve the host copy */
    }
  };
  // Legacy Gemini CLI opens a browser sign-in from session/new when its cached
  // OAuth is unusable, so it is discovered only for hosts that already run it.
  // Individual Google accounts use Antigravity; turns still route to Gemini.
  const usesGemini = engine.store.startupStates().some((state) => state.harness === "gemini");
  const catalogProviders = providers.filter((provider) => provider !== "gemini" || usesGemini);
  const catalogs = new ModelCatalogCache(
    [...new Set([...catalogProviders, "acp" as const])],
    () => providerBinaries(catalogProviders),
    async (provider, cwd) => {
      const discovered =
        provider === "acp"
          ? (await genericAcp.list()).map((config) => ({
              id: `acp:${config.id}`,
              nativeId: config.id,
              harness: "acp" as const,
              name: config.name,
              contextWindow: config.contextWindow,
            }))
          : await discoverModels[provider](cwd);
      if (discovered.length || provider === "acp") setHarnessModels(provider, discovered);
      return discovered;
    },
  );
  const transfers = new SyncTransfers();
  const desktopRecheckMs = (id: string): number => {
    const hosted = engine.store.sessionStateMetadata(id);
    return (!hosted || (hosted.desktop && hosted.status !== "running")) &&
      desktop.stamp(id, WATCH_STAMP_MS)?.running
      ? WATCH_STAMP_MS
      : 1000;
  };
  const signal = engine.store.changes;
  desktop.live.onChange = () => signal.notify();
  tasks.onChange = () => signal.notify();
  const revisionWaits = new RevisionWaits(64, signal);
  const transcriptPages = new TranscriptPages();
  const remoteChanges = new RemoteChanges(signal);
  const gitWatches = new GitWatches({ onChange: () => signal.notify() });
  const workspace = new WorkspaceCommands(
    engine.store,
    (projectId, action) => engine.withIdleProject(projectId, action),
    engine.checkpoints,
  );
  const models = (projectId?: unknown, progressive = false) =>
    catalogs.read(
      typeof projectId === "string" ? engine.store.project(projectId).cwd : homedir(),
      progressive,
    );
  let imageCapability: { at: number; value: Promise<boolean> } | undefined;
  const crews = new HostCrews(
    engine.store,
    engine,
    tasks,
    (projectId) => models(projectId),
    Date.now,
    async (candidate, capability) => {
      if (candidate.harness === "codex" && capability === "image-generation") {
        if (!imageCapability || Date.now() - imageCapability.at > 60_000)
          imageCapability = {
            at: Date.now(),
            value: probeNativeCodexImageCapability(join(featureDirectory, "crews")).then(
              (result) => result.available,
            ),
          };
        return imageCapability.value;
      }
      return undefined;
    },
  );
  const projectSessionList = async (projectId: string) => {
    const project = engine.store.project(projectId);
    const local = desktop.list(project.cwd, projectId, providers);
    const stamps = new Map(local.map((session) => [session.id, session]));
    for (const adopted of engine.store.adopted()) {
      const stamp = stamps.get(adopted.id);
      // Only a desktop copy newer than the one the host caught up with needs
      // the session loaded; a running one is not pulled yet.
      if (
        adopted.projectId === projectId &&
        stamp &&
        stamp.status !== "running" &&
        stamp.updatedAt > adopted.desktopUpdatedAt
      )
        catchUp(adopted.id, {
          updatedAt: stamp.updatedAt,
          running: false,
        });
    }
    const own = engine.store
      .summaries(projectId)
      .map((session) =>
        session.status !== "running" && stamps.get(session.id)?.status === "running"
          ? { ...session, status: "running" as const }
          : session,
      );
    const known = new Set(own.map((session) => session.id));
    const summaries = [...own, ...local.filter((session) => !known.has(session.id))].sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
    const paths = [...new Set(summaries.map((session) => session.cwd ?? project.cwd))];
    const branches = new Map(
      await Promise.all(paths.map(async (cwd) => [cwd, await branchCache.get(cwd)] as const)),
    );
    const list = summaries.map((session) => ({
      ...session,
      repo: project.name,
      branch: branches.get(session.cwd ?? project.cwd) || undefined,
      worktreeCwd: session.cwd && session.cwd !== project.cwd ? session.cwd : undefined,
    }));
    return {
      list,
      etag: createHash("sha256").update(JSON.stringify(list)).digest("base64url"),
    };
  };
  const projectChangeCache = new Map<
    string,
    {
      version: number;
      refreshed: number;
      value: { etag: string; sessions: HostSessionSummary[] };
    }
  >();
  const taskChangeEtag = async () => tasks.changeEtag();
  const projectChangeSnapshot = async (projectId: string) => {
    const now = Date.now();
    // Per project: another project's streaming must not rebuild this list.
    // Desktop-side changes bypass the store, so the 1s cap below bounds them.
    const version = engine.store.projectVersion(projectId);
    const cached = projectChangeCache.get(projectId);
    if (
      cached &&
      now - cached.refreshed < 1_000 &&
      (cached.version === version || now - cached.refreshed < 250)
    )
      return cached.value;
    const { list, etag } = await projectSessionList(projectId);
    const value = { etag, sessions: list };
    projectChangeCache.set(projectId, {
      version,
      refreshed: now,
      value,
    });
    while (projectChangeCache.size > 32)
      projectChangeCache.delete(projectChangeCache.keys().next().value!);
    return value;
  };
  const hostNotes = new HostNotes();
  const providerInbox = new ProviderInboxBridge(engine.store.db);
  const conversationWorkspace = new ConversationWorkspaceTools(
    engine.store,
    hostNotes,
    automations,
    providerInbox,
    async (projectId, principal) =>
      hostInbox(
        {
          sessions: (await projectSessionList(projectId)).list,
          tasks: tasks.list(),
          goals: goals.list(),
          automations: automations.list(),
          threads: social.snapshot({ ...principal, actorId: `session:${principal.sessionId}` })
            .threads,
        },
        projectId,
      ).items,
    (operation, cwd, principal, authorized) =>
      conversationDesktop.call("inbox.write.authorize", { operation }, cwd, principal, authorized),
  );
  const mobilePairing = new MobilePairing({
    environmentId: engine.store.environmentId,
    hasDeviceHash: (hash) =>
      !!engine.store.db.prepare("SELECT id FROM devices WHERE hash=?").get(hash),
    issueDevice: (name) => engine.store.issueDevice(name),
  });
  const mobileAccess = createMobileAccessService((): number => {
    const address = server.address();
    if (!address || typeof address === "string" || address.port <= 0)
      throw new Error("Host is not listening.");
    return address.port;
  });
  const mobileLan = new MobileLanAccess(
    join(featureDirectory, "mobile-lan.json"),
    engine.store.environmentId,
    () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Host is not listening.");
      return address.port;
    },
  );
  const tunnels =
    tunnelsOverride ??
    new ExternalTunnels(join(featureDirectory, "tunnels"), engine.store.environmentId, () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Host is not listening.");
      return `http://127.0.0.1:${address.port}`;
    });
  function mcpBridgeMetadata(scope: "conversation" | "runtime-logs" | "social") {
    const address = server.address();
    const local = address && typeof address !== "string" && address.address === "127.0.0.1";
    return {
      command: process.execPath,
      args: [process.argv[1]],
      ...(local && !(scope === "social" && social.isDelegated?.())
        ? { mcpUrl: `http://127.0.0.1:${address.port}/mcp/${scope}` }
        : {}),
    };
  }
  const mcpHttp = new McpHttp({
    store: engine.store,
    social,
    conversationAccess,
    runtimeLogAccess,
    runtimeLogs,
    refreshLogSources,
    conversationWorkspace,
    projectSessions: projectSessionList,
  });
  const server = createServer(
    { requestTimeout: 20_000, headersTimeout: 10_000, maxHeaderSize: 8192 },
    async (request, response) => {
      const mcpMetric = mcpMetricName(request.url ?? "");
      if (mcpMetric) {
        await perfMetrics.measure(mcpMetric, () => mcpHttp.handle(request, response, server));
        return;
      }
      if (await mcpHttp.handle(request, response, server)) return;
      if (await socialTransport.http(request, response)) return;
      if (webControl?.handle(request, response)) return;
      if (request.url === "/lifecycle" && lifecycle) {
        lifecycle(request, response);
        return;
      }
      response.setHeader("Content-Type", "application/json");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      let dispatchStarted: number | undefined;
      let dispatchMethod: unknown;
      try {
        if (await mobilePairing.handle(request, response)) return;
        // Desktop native HTTP supplies credentials. This endpoint intentionally
        // accepts no browser origin and provides no permissive CORS escape hatch.
        if (
          !(
            webControl?.acceptsRpc(request) ||
            (!request.headers.origin && request.method === "POST" && request.url === "/rpc")
          )
        ) {
          response
            .writeHead(403)
            .end(JSON.stringify({ error: "Unsupported request origin or route" }));
          return;
        }
        const token = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
        let socialPrincipal = token ? social.principalForToken(token) : undefined;
        let runtimePrincipal = token ? runtimeLogAccess.principalForToken(token) : undefined;
        let conversationPrincipal = token ? conversationAccess.principalForToken(token) : undefined;
        let peerIdentity = token ? socialPeers.authenticated(token) : undefined;
        if (
          !token ||
          (!socialPrincipal &&
            !runtimePrincipal &&
            !conversationPrincipal &&
            !peerIdentity &&
            !engine.store.authenticated(token))
        ) {
          response.writeHead(401).end(
            JSON.stringify({
              error: "Device credential is invalid or revoked",
            }),
          );
          return;
        }
        const input = await body(request);
        // Reading a request body yields: a device may have been revoked since
        // the headers arrived. Reject it before dispatching any operation.
        socialPrincipal = socialPrincipal ? social.principalForToken(token) : undefined;
        runtimePrincipal = runtimePrincipal ? runtimeLogAccess.principalForToken(token) : undefined;
        conversationPrincipal = conversationPrincipal
          ? conversationAccess.principalForToken(token)
          : undefined;
        peerIdentity = peerIdentity ? socialPeers.authenticated(token) : undefined;
        if (
          !socialPrincipal &&
          !runtimePrincipal &&
          !conversationPrincipal &&
          !peerIdentity &&
          !engine.store.authenticated(token)
        ) {
          response.writeHead(401).end(
            JSON.stringify({
              error: "Device credential is invalid or revoked",
            }),
          );
          return;
        }
        if (input.version !== HOST_PROTOCOL_VERSION)
          throw new Error("Incompatible protocol version");
        if (
          input.method !== "environment.describe" &&
          input.environmentId !== engine.store.environmentId
        )
          throw new Error("Host identity changed; reconnect this machine explicitly");
        const params =
          input.params && typeof input.params === "object" && !Array.isArray(input.params)
            ? (input.params as Record<string, unknown>)
            : {};
        // Scope the timer to dispatch, including all early returns and failures.
        // Never retain input/params or error contents in the metrics collector.
        dispatchStarted = performance.now();
        dispatchMethod = input.method;
        let result: unknown;
        if (mcpHttp.rpc(input.method, params, token, response)) return;
        if (peerIdentity) {
          result = await socialPeers.peerRpc(peerIdentity, String(input.method), params);
          response.end(JSON.stringify({ result }));
          return;
        }
        if (socialPrincipal && input.method !== "social.tools.call")
          throw new Error("Session social credentials cannot access other host operations.");
        if (runtimePrincipal && input.method !== "runtimeLogs.tools.call")
          throw new Error("Session log credentials only permit reading runtime logs.");
        if (conversationPrincipal && input.method !== "conversation.tools.call")
          throw new Error("Session conversation credentials only permit Conversation Tools.");
        if (input.method === "conversation.tools.call") {
          if (!conversationPrincipal)
            throw new Error("A scoped conversation credential is required.");
          const action = String(params.action ?? "");
          const args = params.input as Record<string, unknown>;
          validateConversationTool(action, args);
          const projectId = conversationPrincipal.projectId;
          const project = engine.store.project(projectId);
          if (action === "sessions.list" || action === "sessions.read") {
            if (!inHost(conversationPrincipal.sessionId))
              result = await conversationDesktop.call(
                action,
                args,
                project.cwd,
                conversationPrincipal,
                () => !!conversationAccess.principalForToken(token),
              );
            else if (action === "sessions.list") {
              const { list } = await projectSessionList(projectId);
              result = {
                cwd: project.cwd,
                sessions: list.map((session) => ({
                  id: session.id,
                  title: session.title,
                  harness: session.harness,
                  model: session.model,
                  busy: session.status === "running",
                  hasDraft: !!session.draft,
                })),
              };
            } else {
              const target = featureSession(String(args.sessionId));
              if (target.projectId !== projectId)
                throw new Error("Conversation belongs to another project");
              result = sessionConversationPage(
                { ...target.session, busy: target.status === "running" },
                args,
              );
            }
          } else if (action === "skills.search")
            result = searchHarnessSkills(
              sessionWorkCwd(featureSession(conversationPrincipal.sessionId).session),
              args,
              undefined,
              conversationPrincipal.sessionId,
              explicitSkillNames(conversationPrincipal.sessionId),
            );
          else if (action === "skills.read")
            result = await readHarnessSkill(
              sessionWorkCwd(featureSession(conversationPrincipal.sessionId).session),
              {
                name: String(args.name),
                source: typeof args.source === "string" ? args.source : undefined,
                scope: typeof args.scope === "string" ? args.scope : undefined,
                offset: args.offset as number | undefined,
                maxChars: args.maxChars as number | undefined,
              },
              undefined,
              conversationPrincipal.sessionId,
              explicitSkillNames(conversationPrincipal.sessionId),
            );
          else if (action.startsWith("crews."))
            result = await crews.call(action, args, projectId, conversationPrincipal);
          else if (isWorkspaceConversationTool(action))
            result = await conversationWorkspace.call(
              action,
              args,
              conversationPrincipal,
              featureSession(conversationPrincipal.sessionId).session,
              () => !!conversationAccess.principalForToken(token),
            );
          else if (action === "tools.list")
            result = {
              environmentId: engine.store.environmentId,
              projectId,
              tools: conversationToolCatalog(),
            };
          else if (
            action.startsWith("ui.") ||
            action === "machines.list" ||
            action === "terminals.list" ||
            action === "terminals.write" ||
            (action.startsWith("devices.") && args.machineId !== undefined)
          )
            result = await conversationDesktop.call(
              action,
              args,
              project.cwd,
              conversationPrincipal,
              () => !!conversationAccess.principalForToken(token),
            );
          else if (action === "terminals.read")
            result = runtimeLogs.read({
              projectId,
              source: "server",
              sourceId: `server:terminal:${args.terminalId}`,
              after: args.after as number | undefined,
              limit: args.limit as number | undefined,
            });
          else if (action === "logs.sources" || action === "logs.read") {
            refreshLogSources();
            const query = runtimeLogToolQuery(
              action === "logs.read" ? "read" : "sources",
              args,
              conversationPrincipal,
            );
            result = action === "logs.read" ? runtimeLogs.read(query) : runtimeLogs.sources(query);
          } else if (action === "logs.monitors.list") result = logMonitors.list(projectId);
          else if (action === "logs.monitors.start")
            result = await logMonitors.start(projectId, args.url);
          else if (action === "logs.monitors.stop") {
            await logMonitors.stop(projectId, String(args.id));
            result = { stopped: true };
          } else if (action === "devices.preflight")
            result = await deviceHost.preflight(args.deviceId as string | undefined);
          else if (action === "devices.preview")
            result = devicePreviews.start(
              args as any,
              `${projectId}:${conversationPrincipal.sessionId}`,
              () => !!conversationAccess.principalForToken(token),
            );
          else if (action === "devices.preview.status")
            result = devicePreviews.status(
              String(args.id),
              `${projectId}:${conversationPrincipal.sessionId}`,
              args.includeFrame === true,
            );
          else if (action === "devices.status") result = await deviceHost.status();
          else if (action === "devices.list") result = await deviceHost.list();
          else if (action === "devices.start") result = await deviceHost.start();
          else if (action === "devices.boot") result = await deviceHost.boot(String(args.deviceId));
          else if (action === "devices.capture")
            result = await deviceHost.capture(String(args.deviceId));
          else if (action === "devices.action")
            result = await deviceHost.action(String(args.deviceId), args.action as DeviceAction);
          else if (action.startsWith("browser."))
            result = await sharedBrowser.dispatchForSession(
              action,
              { ...args, projectId, sessionId: conversationPrincipal.sessionId },
              token,
            );
          else if (action.startsWith("tasks.")) {
            const list = tasks.list().filter((task) => task.projectId === projectId);
            if (action === "tasks.create") {
              const own = featureSession(conversationPrincipal.sessionId).session;
              const input = {
                id: String(args.taskId),
                projectId,
                title: String(args.title),
                prompt: String(args.prompt),
                harness: own.harness,
                model: own.model,
                modelSettings: own.modelSettings,
                runtimeMode: own.runtimeMode,
                maxRunMinutes: 0,
                isolate: false,
                review: !args.crewDefinitionId,
                autoMerge: false,
                continueUntilDone: false,
                ...(args.crewDefinitionId
                  ? { crewDefinitionId: String(args.crewDefinitionId) }
                  : {}),
                status: args.status === "queued" ? "queued" : "todo",
              };
              const key = `task-create:${projectId}:${input.id}`;
              const fingerprint = createHash("sha256")
                .update(JSON.stringify([conversationPrincipal.sessionId, input]))
                .digest("hex");
              result = engine.store.transaction(() => {
                const receipt = engine.store.db
                  .prepare("SELECT value FROM metadata WHERE key=?")
                  .get(key) as { value: string } | undefined;
                const existing = tasks.get(input.id);
                if (receipt || existing) {
                  if (
                    receipt?.value !== fingerprint ||
                    !existing ||
                    existing.projectId !== projectId
                  )
                    throw new Error("Task ID was reused or its task no longer exists.");
                  return existing;
                }
                const created = tasks.save(input);
                engine.store.db
                  .prepare("INSERT INTO metadata(key,value) VALUES(?,?)")
                  .run(key, fingerprint);
                return created;
              });
            } else if (action === "tasks.list") result = list;
            else {
              const task = list.find((task) => task.id === args.taskId);
              if (!task) throw new Error("Task is not in this project.");
              if (
                !["tasks.get", "tasks.notes.read", "tasks.session.read"].includes(action) &&
                (task.sessionId === conversationPrincipal.sessionId ||
                  task.reviewer?.sessionId === conversationPrincipal.sessionId)
              )
                throw new Error("An agent cannot change its own active task.");
              if (action === "tasks.get") result = task;
              else if (action === "tasks.session.read") {
                const sessionId =
                  args.role === "reviewer" ? task.reviewer?.sessionId : task.sessionId;
                if (!sessionId) throw new Error("This task has no session for the selected role.");
                const snapshot = featureSession(sessionId);
                if (snapshot.projectId !== projectId)
                  throw new Error("Task session belongs to another project.");
                const limit = Number(args.limit ?? 20),
                  after = Number(args.after ?? Math.max(0, snapshot.session.blocks.length - limit));
                const blocks = snapshot.session.blocks
                  .slice(after, after + limit)
                  .map((block) => scrubRuntimeLogText(JSON.stringify(block), 8192));
                result = {
                  sessionId,
                  status: snapshot.status,
                  revision: snapshot.revision,
                  totalBlocks: snapshot.session.blocks.length,
                  blocks,
                  next: after + blocks.length,
                };
              } else if (action === "tasks.start") result = await tasks.startTask(task.id);
              else if (action === "tasks.retry") {
                if (task.status !== "blocked")
                  throw new Error("Only blocked tasks can be retried.");
                result = await tasks.move(task.id, "queued");
              } else if (action === "tasks.stop") {
                if (!["running", "verifying"].includes(task.status))
                  throw new Error("Task is not running.");
                result = await tasks.move(task.id, "blocked");
              } else if (action === "tasks.update") {
                if (args.title === undefined && args.prompt === undefined)
                  throw new Error("Supply a title or prompt.");
                const { status: _status, ...input } = task;
                result = tasks.save({
                  ...input,
                  ...(args.title !== undefined ? { title: args.title } : {}),
                  ...(args.prompt !== undefined ? { prompt: args.prompt } : {}),
                });
              } else if (action === "tasks.review.recheck") result = tasks.recheckReview(task.id);
              else result = tasks.readNotes(task.id, args.noteIds);
            }
          } else if (action.startsWith("devServers.")) {
            const projects = [{ id: project.id, name: project.name, path: project.cwd }];
            if (action === "devServers.list") {
              const list = (await devServers.handle(action, { projectId }, projects)) as {
                servers: { projectId?: string }[];
              };
              result = {
                ...list,
                servers: list.servers.filter((server) => server.projectId === projectId),
              };
            } else {
              if (action !== "devServers.start") {
                const details = (await devServers.handle(
                  "devServers.details",
                  { ...args, projectId },
                  projects,
                )) as DevServerDetails;
                if (details.server.projectId !== projectId)
                  throw new Error(
                    "Dev server belongs to another project or has no verified project association.",
                  );
              }
              result = await devServers.handle(
                action,
                { ...args, projectId, cwd: project.cwd },
                projects,
              );
            }
          } else if (action === "resources.read")
            result = diagnostics.read(`session:${conversationPrincipal.sessionId}`);
          response.end(JSON.stringify({ result }));
          return;
        }
        if (input.method === "runtimeLogs.tools.call") {
          if (!runtimePrincipal) throw new Error("A scoped session log credential is required.");
          refreshLogSources();
          const action = String(params.action ?? "");
          const query = runtimeLogToolQuery(
            action,
            params.input && typeof params.input === "object" && !Array.isArray(params.input)
              ? (params.input as Record<string, unknown>)
              : {},
            runtimePrincipal,
          );
          result =
            action === "sources" || action === "runtimeLogs.sources"
              ? runtimeLogs.sources(query)
              : runtimeLogs.read(query);
          response.end(JSON.stringify({ result }));
          return;
        }
        if (typeof input.method === "string" && input.method.startsWith("social.")) {
          const principal: SocialPrincipal = socialPrincipal ?? {
            kind: "owner",
            actorId: `device:${createHash("sha256").update(token).digest("hex")}`,
            provider: "owner",
          };
          if (input.method === "social.bridge.describe") {
            if (principal.kind !== "owner") throw new Error("Native owner device required.");
            result = mcpBridgeMetadata("social");
          } else if (input.method === "social.access.issue") {
            if (principal.kind !== "owner")
              throw new Error("Only a native owner device can issue social access.");
            const sessionId = String(params.sessionId ?? "");
            // The desktop database supplies the cwd; a tool cannot register a
            // project by claiming a path in its request.
            if (!inHost(sessionId)) {
              const cwd = desktop.projectCwd(sessionId);
              if (cwd) engine.store.addProject(cwd, basename(cwd));
            }
            const grant = (await social.remoteAccess?.(sessionId)) ?? {
              ...social.issueSessionGrant(
                sessionId,
                createHash("sha256").update(token).digest("hex"),
              ),
              environmentId: engine.store.environmentId,
            };
            result = { ...grant, command: process.execPath, args: [process.argv[1]] };
          } else if (input.method.startsWith("social.native.")) {
            if (principal.kind !== "owner") throw new Error("Native owner device required.");
            const deviceHash = createHash("sha256").update(token).digest("hex");
            switch (input.method) {
              case "social.native.status":
                result = socialPeers.status();
                break;
              case "social.native.enroll":
                result = await socialPeers.enroll(String(params.environmentId ?? ""), deviceHash);
                break;
              case "social.native.register":
                result = await socialPeers.register(params, deviceHash);
                break;
              case "social.native.authority":
                result = await socialPeers.useAuthority(params);
                break;
              case "social.native.reset":
                result = socialPeers.resetAuthority();
                break;
              default:
                throw new Error("Unsupported native social operation.");
            }
          } else result = await socialTransport.rpc(principal, input.method, params);
          response.end(JSON.stringify({ result }));
          return;
        }
        switch (input.method) {
          case "terminals.list":
          case "terminals.create":
          case "terminals.read":
          case "terminals.write":
          case "terminals.interrupt":
          case "terminals.close": {
            const project = engine.store.project(String(params.projectId ?? ""));
            if (input.method === "terminals.list") result = terminals.list(project.id);
            else if (input.method === "terminals.create")
              result = await terminals.create(
                project,
                params,
                createHash("sha256").update(token).digest("hex"),
                () => engine.store.authenticated(token),
              );
            else if (input.method === "terminals.read") result = terminals.read(project.id, params);
            else if (input.method === "terminals.write")
              result = await terminals.write(project.id, params);
            else if (input.method === "terminals.interrupt")
              result = await terminals.interrupt(project.id, params.id);
            else result = await terminals.remove(project.id, params.id);
            break;
          }
          case "conversation.desktop.take":
            result = conversationDesktop.take(createHash("sha256").update(token).digest("hex"));
            break;
          case "conversation.desktop.finish":
            result = conversationDesktop.finish(
              String(params.id ?? ""),
              params.result,
              typeof params.error === "string" ? params.error : undefined,
              createHash("sha256").update(token).digest("hex"),
            );
            break;
          case "conversation.bridge.describe":
            result = mcpBridgeMetadata("conversation");
            break;
          case "conversation.access.issue": {
            const sessionId = String(params.sessionId ?? "");
            if (!inHost(sessionId)) {
              const cwd = desktop.projectCwd(sessionId);
              if (cwd) engine.store.addProject(cwd, basename(cwd));
            }
            result = {
              ...conversationAccess.issueSessionGrant(
                sessionId,
                createHash("sha256").update(token).digest("hex"),
              ),
              environmentId: engine.store.environmentId,
              command: process.execPath,
              args: [process.argv[1]],
            };
            break;
          }
          case "runtimeLogs.terminals.append": {
            const cwd = String(params.cwd ?? "");
            if (!cwd || cwd.length > 4096)
              throw new Error("Terminal project directory is required");
            const project =
              engine.store.projects().find((project) => project.cwd === cwd) ??
              engine.store.addProject(cwd, basename(cwd));
            result = terminalLogs.append(project.id, params);
            break;
          }
          case "runtimeLogs.bridge.describe":
            result = mcpBridgeMetadata("runtime-logs");
            break;
          case "runtimeLogs.access.issue": {
            const sessionId = String(params.sessionId ?? "");
            if (!inHost(sessionId)) {
              const cwd = desktop.projectCwd(sessionId);
              if (cwd) engine.store.addProject(cwd, basename(cwd));
            }
            result = {
              ...runtimeLogAccess.issueSessionGrant(
                sessionId,
                createHash("sha256").update(token).digest("hex"),
              ),
              environmentId: engine.store.environmentId,
              command: process.execPath,
              args: [process.argv[1]],
            };
            break;
          }
          case "runtimeLogs.monitors.list":
          case "runtimeLogs.monitors.start":
          case "runtimeLogs.monitors.stop": {
            const projectId = String(params.projectId ?? "");
            engine.store.project(projectId);
            if (input.method === "runtimeLogs.monitors.start")
              result = await logMonitors.start(projectId, params.url);
            else if (input.method === "runtimeLogs.monitors.stop") {
              await logMonitors.stop(projectId, String(params.id ?? ""));
              result = { stopped: true };
            } else result = logMonitors.list(projectId);
            break;
          }
          case "runtimeLogs.read":
          case "runtimeLogs.sources": {
            refreshLogSources();
            if (params.projectId !== undefined) engine.store.project(String(params.projectId));
            if (params.sessionId !== undefined) {
              const session = featureSession(String(params.sessionId));
              if (params.projectId !== undefined && session.projectId !== params.projectId)
                throw new Error("Runtime logs belong to another project");
            }
            result =
              input.method === "runtimeLogs.sources"
                ? runtimeLogs.sources(params)
                : runtimeLogs.read(params);
            break;
          }
          case "devServers.bridgeCheck":
          case "devServers.bridgeOpen":
          case "devServers.bridgeRead":
          case "devServers.bridgeWrite":
          case "devServers.bridgeClose":
            engine.store.project(String(params.projectId ?? ""));
            result = await devServerAccess.handle(input.method, params, token);
            break;
          case "devServers.list":
          case "devServers.details":
          case "devServers.start":
          case "devServers.stop":
          case "devServers.kill":
          case "devServers.restart":
          case "devServers.logs":
          case "devServers.openExternal": {
            engine.store.project(String(params.projectId ?? ""));
            const projects = engine.store.projects().map((project) => ({
              id: project.id,
              name: project.name,
              path: project.cwd,
            }));
            if (input.method === "devServers.openExternal") {
              const details = (await devServers.handle(
                "devServers.details",
                params,
                projects,
              )) as DevServerDetails;
              const endpoint = details.server.endpoints.find(
                (value) =>
                  value.port === params.port &&
                  (params.address === undefined || value.address === params.address),
              );
              if (!endpoint)
                throw new Error("The selected server is no longer listening on this port");
              result = await openDevServerBrowser(endpoint.url);
            } else result = await devServers.handle(input.method, params, projects);
            break;
          }
          case "resources.read":
            result = diagnostics.read(token);
            break;
          case "browser.setup":
            // Explicit machine tools are authorized by the paired host credential.
            // When a conversation project is supplied, retain its validation.
            if (params.projectId !== undefined)
              engine.store.project(String(params.projectId ?? ""));
            await browserRuntime.setup();
            result = {
              ...(await sharedBrowser.dispatch("browser.status", params, token)),
              runtime: await browserRuntime.status(),
            };
            break;
          case "browser.status":
          case "browser.claim":
          case "browser.release":
          case "browser.open":
          case "browser.frame":
          case "browser.input":
          case "browser.close":
            if (params.projectId !== undefined) engine.store.project(String(params.projectId));
            if (params.sessionId !== undefined) {
              const session = featureSession(String(params.sessionId));
              if (params.projectId !== undefined && session.projectId !== params.projectId)
                throw new Error("Browser belongs to another project");
            }
            result = {
              // Only paired owner RPCs may explicitly take control. Conversation
              // tools use dispatchForSession and cannot enable this option.
              ...(await sharedBrowser.dispatch(input.method, params, token, {
                takeover: input.method === "browser.claim" && params.takeover === true,
              })),
              runtime: await browserRuntime.status(),
            };
            break;
          case "browser.annotation.start":
          case "browser.annotation.hover":
          case "browser.annotation.select":
          case "browser.annotation.clear":
          case "browser.annotation.read":
          case "browser.annotation.cancel": {
            const projectId = String(params.projectId ?? "");
            engine.store.project(projectId);
            if (featureSession(String(params.sessionId ?? "")).projectId !== projectId)
              throw new Error("Conversation belongs to another project");
            result = await sharedBrowser.dispatch(input.method, params, token);
            break;
          }
          case "environment.describe":
            result = {
              protocolVersion: HOST_PROTOCOL_VERSION,
              environmentId: engine.store.environmentId,
              name: hostname(),
              webControl: webControl
                ? { origin: webControl.origin, url: `${webControl.origin}/control` }
                : undefined,
              platform: process.platform,
              // Older clients validate this list against Codex and Claude only.
              providers: [
                ...new Set([
                  ...providers,
                  ...((await genericAcp.list()).length ? ["acp" as const] : []),
                ]),
              ].filter((provider) =>
                Array.isArray(params.supportedProviders)
                  ? params.supportedProviders.includes(provider)
                  : provider === "codex" || provider === "claude",
              ),
              capabilities: [
                "terminals.v1",
                "mobile.pairing",
                "mobile.access",
                "tunnels.manage",
                "sessions",
                "sessions.createFirstTurn",
                "sessions.pages",
                "sessions.longPoll",
                "sessions.lazyHistory",
                "sessions.block",
                "machine.changes",
                "machine.changes.inlineSync",
                "git.watch",
                "commands.status",
                "sessions.harnessSwitch",
                "sessions.steer",
                "sessions.rewind",
                "projects.browse",
                "projects.directory.v1",
                "projects.createDirectory",
                "models.list",
                "crews.v1",
                "crews.tasks.v1",
                "crews.delete.v1",
                "approvals",
                "questions",
                "diff",
                "git.branches",
                "git.switch",
                "git.createBranch",
                "git.worktrees",
                "git.worktreeCreate",
                "files.read",
                "files.list",
                "files.index",
                "workspace.run",
                "workspace.browseDir",
                "files.search",
                "files.searchContent",
                "files.create",
                "files.write",
                "git.index",
                "git.fileDiff",
                "git.action",
                "git.actions",
                "git.conflicts",
                "attachments.upload",
                "attachments.resume",
                "attachments.ownership.v1",
                "attachments.read",
                "sessions.draft",
                "sessions.plan",
                "sessions.shell",
                "shell.profiles",
                "sessions.desktop",
                "sessions.desktopLive",
                "sessions.queue",
                "sync",
                "automations",
                "tasks",
                "tasks.todo",
                "tasks.workspaces",
                "goals.direct-checkout",
                "goals.settings",
                "tasks.notes",
                "tasks.review-recheck",
                "tasks.blocked-takeover",
                "tasks.continue-until-done",
                "goals",
                "stewards",
                "host.settings",
                "notes",
                "inbox.attention",
                "inbox.providers.desktop",
                "device.host",
                "host.tools.machine-targets",
                "generic-acp-v1",
                "handoff-history-v1",
                "resources.diagnostics",
                "browser.shared.setup",
                "browser.shared",
                "runtime.logs",
                "conversation.tools",
                "runtime.logs.monitors",
                "browser.annotation",
                "dev.servers",
                "dev.servers.private-access",
                "social.v1",
                "social.programs.v2",
              ],
            };
            break;
          case "generic_acp_list":
            result = await genericAcp.list();
            break;
          case "generic_acp_save":
            await genericAcp.save(params.config as GenericAcpConfig);
            catalogs.clear();
            result = null;
            break;
          case "generic_acp_remove":
            await genericAcp.remove(String(params.id ?? ""));
            catalogs.clear();
            result = null;
            break;
          case "generic_acp_registry":
            result = await genericAcp.registry(params.refresh === true);
            break;
          case "generic_acp_install":
            await genericAcp.install(String(params.id ?? ""), String(params.version ?? ""));
            catalogs.clear();
            result = null;
            break;
          case "generic_acp_cancel_install":
            genericAcp.cancelInstall(String(params.id ?? ""));
            result = null;
            break;
          case "handoff_history_save":
          case "handoff_history_read": {
            const projectId = String(params.projectId ?? "");
            engine.store.project(projectId);
            const sessionId =
              input.method === "handoff_history_save"
                ? (params.history as HandoffHistory)?.sessionId
                : String(params.sessionId ?? "");
            if (!sessionId) throw new Error("Invalid conversation");
            if (featureSession(sessionId).projectId !== projectId)
              throw new Error("Conversation belongs to another project");
            result =
              input.method === "handoff_history_save"
                ? await handoffHistory.save(params.history as HandoffHistory)
                : await handoffHistory.read(
                    sessionId,
                    Number(params.cursor ?? 0),
                    Number(params.limit ?? 20),
                  );
            break;
          }
          case "devices.status":
          case "devices.preflight":
          case "devices.preview":
          case "devices.preview.status":
          case "devices.setup":
          case "devices.start":
          case "devices.stop":
          case "devices.list":
          case "devices.boot":
          case "devices.capture":
          case "devices.action": {
            if (params.projectId !== undefined)
              engine.store.project(String(params.projectId ?? ""));
            if (input.method === "devices.preflight")
              result = await deviceHost.preflight(params.deviceId as string | undefined);
            else if (
              input.method === "devices.preview" ||
              input.method === "devices.preview.status"
            ) {
              const { previewOwner, previewExpiresAt, projectId: _projectId, ...args } = params;
              validateConversationTool(input.method, args);
              const owner = typeof previewOwner === "string" ? previewOwner : "native-owner";
              result =
                input.method === "devices.preview"
                  ? devicePreviews.start(
                      args as any,
                      owner,
                      () => previewExpiresAt === undefined || Date.now() < Number(previewExpiresAt),
                    )
                  : devicePreviews.status(String(args.id), owner, args.includeFrame === true);
            } else if (input.method === "devices.status") result = await deviceHost.status();
            else if (input.method === "devices.setup") {
              if (typeof params.agentAccess !== "boolean")
                throw new Error("Choose whether agents may control devices");
              result = await deviceHost.setup(params.agentAccess);
            } else if (input.method === "devices.start") result = await deviceHost.start();
            else if (input.method === "devices.stop") result = await deviceHost.stop();
            else if (input.method === "devices.list") result = await deviceHost.list();
            else if (input.method === "devices.boot")
              result = await deviceHost.boot(String(params.deviceId ?? ""));
            else if (input.method === "devices.capture")
              result = await deviceHost.capture(String(params.deviceId ?? ""));
            else
              result = await deviceHost.action(
                String(params.deviceId ?? ""),
                params.action as DeviceAction,
              );
            break;
          }
          case "projects.list":
            result = engine.store.projects();
            break;
          case "projects.directory":
            result = desktop.live.projectDirectory(
              engine.store.projects(),
              engine.store.environmentId,
            );
            break;
          case "projects.browse":
            result = await browseHostDirectories(params.path);
            break;
          case "projects.createDirectory":
            result = await createHostDirectory(params.path, params.name);
            break;
          case "projects.open":
            result = await engine.openProject(String(params.cwd ?? ""));
            break;
          case "shell.profiles":
            result = listShellProfiles();
            break;
          case "shell.setProfile":
            setChosenProfile(
              typeof params.profile === "string" && params.profile.trim()
                ? params.profile.trim()
                : null,
            );
            result = listShellProfiles();
            break;
          case "models.list":
            result = await models(params.projectId, params.progressive === true);
            break;
          case "sessions.list": {
            const projectId = String(params.projectId ?? "");
            const { list, etag } = await projectSessionList(projectId);
            // A client that sends `known` can take "unchanged" instead of the
            // array. Clients that omit it keep getting the plain array.
            if (typeof params.known === "string") {
              result = params.known === etag ? { unchanged: true, etag } : { etag, sessions: list };
            } else result = list;
            break;
          }
          case "machine.changes": {
            result = await remoteChanges.read(
              {
                inlineSync: params.inlineSync === true,
                instanceId: typeof params.instanceId === "string" ? params.instanceId : undefined,
                sessions: Array.isArray(params.sessions)
                  ? (params.sessions as {
                      sessionId: string;
                      revision: number;
                    }[])
                  : [],
                projects: Array.isArray(params.projects)
                  ? (params.projects as { projectId: string; known?: string }[])
                  : [],
                tasksKnown: typeof params.tasksKnown === "string" ? params.tasksKnown : undefined,
                git: Array.isArray(params.git)
                  ? (params.git as { cwd: string; known?: string }[])
                  : undefined,
                waitMs: Number(params.waitMs),
              },
              (sessionId) => {
                const host = engine.store.sessionStateMetadata(sessionId);
                if (host && (!host.desktop || host.status === "running")) return host.revision;
                // A change-poll tick: a fraction-of-a-second old read is fine.
                const stamp = desktop.stamp(sessionId, WATCH_STAMP_MS);
                if (host && (!stamp || !stamp.running)) return host.revision;
                if (!host && !stamp) return undefined;
                const overlay = desktop.live.overlay(sessionId);
                return Math.max(stamp?.updatedAt ?? host?.revision ?? 0, overlay?.changedAt ?? 0);
              },
              projectChangeSnapshot,
              () => response.destroyed || !engine.store.authenticated(token),
              taskChangeEtag,
              (cwd) => gitWatches.read(cwd),
              () =>
                Array.isArray(params.sessions) &&
                params.sessions.some(
                  (entry: { sessionId: string }) =>
                    desktopRecheckMs(entry.sessionId) === WATCH_STAMP_MS,
                )
                  ? WATCH_STAMP_MS
                  : 1000,
            );
            result = inlineSessionSync(
              {
                inlineSync: params.inlineSync === true,
                sessions: params.sessions as { sessionId: string; revision: number }[],
                projects: [],
              },
              result as Awaited<ReturnType<RemoteChanges["read"]>>,
              (id, revision) => {
                // Desktop rows may require transcript IO. Keep those on sessions.sync.
                const metadata = engine.store.sessionStateMetadata(id);
                if (!metadata || desktopWatch(id, true)) return undefined;
                const sync = engine.store.sync(id, revision);
                return sync.kind === "delta"
                  ? {
                      ...sync,
                      value: {
                        ...sync.value,
                        session: {
                          ...sync.value.session,
                          ...previewRewindHistory(sync.value.session),
                        },
                      },
                    }
                  : undefined;
              },
            );
            if (!engine.store.authenticated(token))
              throw new Error("Device authorization was revoked");
            break;
          }
          case "sessions.update": {
            const sessionId = String(params.sessionId ?? "");
            adopt(sessionId);
            const current = engine.store.session(sessionId);
            if (current.projectId !== params.projectId)
              throw new Error("Session does not belong to this project");
            const patch: {
              title?: string;
              archived?: boolean;
              pinned?: boolean;
              linkedWorkItem?: LinkedWorkItem | null;
            } = {};
            if (params.title !== undefined) {
              if (typeof params.title !== "string") throw new Error("Invalid session title");
              patch.title = params.title;
            }
            if (params.archived !== undefined) {
              if (typeof params.archived !== "boolean") throw new Error("Invalid archive value");
              patch.archived = params.archived;
            }
            if (params.pinned !== undefined) {
              if (typeof params.pinned !== "boolean") throw new Error("Invalid pin value");
              patch.pinned = params.pinned;
            }
            if (params.linkedWorkItem !== undefined) {
              const item = params.linkedWorkItem;
              const parsed =
                item && typeof item === "object" && !Array.isArray(item)
                  ? parseGithubWorkItemUrl(String((item as LinkedWorkItem).url ?? ""))
                  : null;
              if (
                item !== null &&
                (typeof item !== "object" ||
                  Array.isArray(item) ||
                  !parsed ||
                  parsed.kind !== (item as LinkedWorkItem).kind ||
                  parsed.repo !== (item as LinkedWorkItem).repo ||
                  parsed.number !== (item as LinkedWorkItem).number ||
                  parsed.url !== (item as LinkedWorkItem).url)
              )
                throw new Error("Invalid linked work item");
              patch.linkedWorkItem = item as LinkedWorkItem | null;
            }
            if (Object.keys(patch).length === 0) throw new Error("No session changes supplied");
            result = engine.updateSession(sessionId, patch);
            break;
          }
          case "sessions.delete": {
            const sessionId = String(params.sessionId ?? "");
            const cwd = desktop.projectCwd(sessionId);
            if (cwd) {
              const project = engine.store.projects().find((p) => desktop.samePath(p.cwd, cwd));
              if (!project || project.id !== params.projectId)
                throw new Error("Session does not belong to this project");
              if (inHost(sessionId) && engine.store.session(sessionId).projectId !== project.id)
                throw new Error("Session does not belong to this project");
              if (
                desktop.stamp(sessionId)?.running ||
                engine.store.sessionStateMetadata(sessionId)?.status === "running"
              )
                throw new Error("Stop this session before deleting it");
              await desktopDelete.request(sessionId, cwd, () => engine.store.authenticated(token));
              if (desktop.projectCwd(sessionId))
                throw new Error(
                  "The desktop did not remove this conversation. Refresh the list before retrying.",
                );
              // An adopted transcript must go too, or it would reappear in the list.
              if (inHost(sessionId)) engine.store.deleteSession(sessionId);
              sessionQueues.delete(sessionId);
              result = { deleted: true };
              break;
            }
            const current = engine.store.session(sessionId);
            if (current.projectId !== params.projectId)
              throw new Error("Session does not belong to this project");
            engine.store.deleteSession(sessionId);
            sessionQueues.delete(sessionId);
            result = { deleted: true };
            break;
          }
          case "sessions.page": {
            const sessionId = String(params.sessionId ?? "");
            const watch = desktopWatch(sessionId);
            const page = transcriptPages.page(
              () =>
                (watch && desktopView(sessionId, watch.projectId)) ??
                engine.store.session(sessionId),
              sessionId,
              params.before === undefined ? undefined : Number(params.before),
              params.revision === undefined ? undefined : Number(params.revision),
              params.preview === true,
            );
            result = {
              ...page,
              value: undefined,
              sync: transfers.respond(sessionId, {
                kind: "snapshot",
                value: page.value,
              }),
            };
            break;
          }
          case "sessions.sync": {
            const sessionId = String(params.sessionId ?? "");
            const revision = Number.isSafeInteger(params.revision)
              ? Number(params.revision)
              : undefined;
            if (
              revision !== undefined &&
              Number.isFinite(params.waitMs) &&
              Number(params.waitMs) > 0
            ) {
              await revisionWaits.wait(
                () =>
                  desktopWatch(sessionId, true)?.revision ??
                  engine.store.session(sessionId).revision,
                revision,
                Number(params.waitMs),
                () => response.destroyed || !engine.store.authenticated(token),
                () => desktopRecheckMs(sessionId),
              );
              if (!engine.store.authenticated(token))
                throw new Error("Device authorization was revoked");
            }
            const watch = desktopWatch(sessionId);
            let current: HostSession | undefined;
            let sync: SessionSync;
            if (watch) {
              // Watching a desktop turn polls fast; skip the transcript read
              // while the desktop copy hasn't changed.
              if (revision === watch.revision) {
                result = { kind: "unchanged", revision };
                break;
              }
              const view = desktopView(sessionId, watch.projectId);
              if (view) {
                current = view;
                sync = desktopSync(view, revision);
              } else {
                catchUp(sessionId);
                current = engine.store.session(sessionId);
                sync = engine.store.sync(sessionId, revision);
              }
            } else {
              catchUp(sessionId);
              current = engine.store.session(sessionId);
              sync = engine.store.sync(sessionId, revision);
            }
            if (params.partial === true) {
              const rawIds = params.loadedBlockIds ?? [];
              if (
                !Array.isArray(rawIds) ||
                rawIds.length > 32768 ||
                rawIds.some((id) => typeof id !== "string" || !id || id.length > 512)
              )
                throw new Error("Invalid loaded block IDs");
              if (sync.kind !== "unchanged") {
                const partial = partialSessionSync(sync, current!, rawIds as string[]);
                if (partial) sync = partial;
                else {
                  const page = transcriptPages.page(
                    () => current!,
                    sessionId,
                    undefined,
                    undefined,
                    true,
                  );
                  sync = { kind: "snapshot", value: page.value };
                }
              }
            }
            if (sync.kind === "snapshot") {
              sync = { ...sync, value: previewSession(sync.value) };
            } else if (sync.kind === "delta") {
              sync = {
                ...sync,
                value: {
                  ...sync.value,
                  session: {
                    ...sync.value.session,
                    ...previewRewindHistory(sync.value.session),
                  },
                },
              };
            }
            result = transfers.respond(sessionId, sync!);
            break;
          }
          case "commands.status": {
            const commandId = params.commandId;
            if (typeof commandId !== "string" || !commandId || commandId.length > 200)
              throw new Error("Invalid command ID");
            result = engine.store.receiptStatus(commandId) ?? null;
            break;
          }
          case "sessions.desktopLive":
            result = {
              ...desktop.live.beat(params),
              deletions: desktopDelete.beat(
                `${createHash("sha256").update(token).digest("hex")}:${String(params.clientId ?? "")}`,
                params.deletions,
              ),
              inbox: providerInbox.beat(
                createHash("sha256").update(token).digest("hex"),
                params.clientId,
                params.inbox,
              ),
              notesRevision: hostNotes.revision,
            };
            break;
          case "sessions.adopted":
            result = engine.store.adopted();
            break;
          case "sessions.queue.get":
          case "sessions.queue.change":
          case "sessions.queue.claim":
          case "sessions.queue.finish": {
            const id = String(params.sessionId ?? "");
            attachmentOwnership.validateExposure(params);
            const queueStatus = queueSessionStatus(id); // Lightweight authorized session existence check.
            const clientId = params.clientId;
            if (typeof clientId !== "string" || !clientId || clientId.length > 200)
              throw new Error("Invalid queue client");
            if (input.method === "sessions.queue.get") {
              const queue = sessionQueues.get(id);
              result = queue;
            } else if (input.method === "sessions.queue.change") {
              const normalize = (raw: unknown) => {
                if (
                  !raw ||
                  typeof raw !== "object" ||
                  !Array.isArray((raw as { messages?: unknown }).messages)
                )
                  throw new Error("Invalid queue");
                const value =
                  raw as import("../src/features/connections/model/remoteQueue").RemoteQueue;
                return {
                  ...value,
                  messages: value.messages.map((message) => ({
                    ...message,
                    attachments: resolveAttachments(
                      engine.store,
                      parseRemoteAttachments(message.attachments),
                    ).map((file) => ({
                      ...file,
                      hostEnvironmentId: engine.store.environmentId,
                    })),
                  })),
                };
              };
              result = engine.store.transaction(() =>
                sessionQueues.change(
                  id,
                  normalize(params.before),
                  normalize(params.after),
                  params.takeOwnership === true ? clientId : undefined,
                ),
              );
            } else if (input.method === "sessions.queue.claim") {
              if (!clientId.startsWith("desktop:"))
                throw new Error("Only the owning desktop claims local sends.");
              result = engine.store.transaction(() =>
                sessionQueues.claim(
                  id,
                  String(params.id ?? ""),
                  clientId,
                  Number(params.revision),
                  params.steer === true,
                ),
              );
            } else {
              const currentQueue = sessionQueues.get(id);
              if (
                currentQueue.claim?.clientId !== clientId &&
                currentQueue.settled?.clientId !== clientId
              )
                throw new Error("Queued send belongs to another client.");
              if (typeof params.accepted !== "boolean")
                throw new Error("Invalid queue acknowledgement");
              if (
                params.accepted === false &&
                (desktopWatch(id)?.running || queueStatus === "running")
              )
                throw new Error("Wait for the running turn before recovering its queued message.");
              result = engine.store.transaction(() =>
                sessionQueues.finish(id, String(params.token ?? ""), params.accepted as boolean),
              );
            }
            const exposed =
              result as import("../src/features/connections/model/sharedQueue").SharedQueue;
            attachmentOwnership.expose(
              token,
              exposed.messages.flatMap((message) => message.attachments.map((file) => file.id)),
              params,
            );
            break;
          }
          case "sessions.syncChunk":
            result = transfers.chunk(
              String(params.sessionId ?? ""),
              String(params.transfer ?? ""),
              Number(params.offset),
            );
            break;
          case "sessions.block": {
            const sessionId = String(params.sessionId ?? "");
            const blockId = String(params.blockId ?? "");
            if (!blockId || blockId.length > 512 || !Number.isSafeInteger(params.revision))
              throw new Error("Invalid transcript block request");
            const watch = desktopWatch(sessionId);
            const value =
              (watch && desktopView(sessionId, watch.projectId)) ?? engine.store.session(sessionId);
            if (value.revision !== params.revision)
              throw new Error("Transcript changed; reload history");
            const block = value.session.blocks.find((entry) => entry.id === blockId);
            if (!block) throw new Error("Transcript block no longer exists");
            result = transfers.respond(sessionId, {
              kind: "snapshot",
              value: {
                ...value,
                session: { ...value.session, blocks: [block] },
                history: {
                  revision: value.revision,
                  totalBlocks: value.session.blocks.length,
                },
              },
            });
            break;
          }
          case "sessions.get": {
            const id = String(params.sessionId ?? "");
            const watch = desktopWatch(id);
            const value = (watch && desktopView(id, watch.projectId)) ?? engine.store.session(id);
            result =
              value.revision === params.revision
                ? null
                : params.preview === true
                  ? transcriptPage(
                      params.summary === true
                        ? {
                            ...value,
                            session: {
                              ...value.session,
                              blocks: [
                                value.session.blocks.findLast(
                                  (block) => block.role === "assistant" && block.text.trim(),
                                ),
                                value.session.blocks.findLast(
                                  (block) => block.role === "system" && block.text.trim(),
                                ),
                                value.session.blocks.findLast(
                                  (block) => block.approval && !block.approval.decided,
                                ),
                              ].filter((block): block is NonNullable<typeof block> => !!block),
                            },
                          }
                        : value,
                      undefined,
                      undefined,
                      true,
                    ).value
                  : value;
            break;
          }
          case "events.read": {
            if (!Number.isSafeInteger(params.after) || Number(params.after) < 0)
              throw new Error("Invalid event cursor");
            result = engine.store.events(String(params.sessionId ?? ""), Number(params.after));
            break;
          }
          case "commands.dispatch": {
            const sessionId = String(params.sessionId ?? "");
            if (
              ["send", "steer", "compact", "configure", "plan", "rewind"].includes(
                String(params.type),
              ) &&
              sessionQueues.get(sessionId).claim &&
              !engine.store.receiptStatus(String(params.commandId ?? ""))
            )
              throw new Error(
                "The owning desktop is preparing a queued send. Wait for its acknowledgement.",
              );
            const queued = params.queued as
              | { id?: unknown; clientId?: unknown; revision?: unknown; selected?: unknown }
              | undefined;
            if (queued && !engine.store.receiptStatus(String(params.commandId ?? ""))) {
              if (!["send", "steer", "compact"].includes(String(params.type)))
                throw new Error("Invalid queued command");
              if (
                typeof queued.id !== "string" ||
                typeof queued.clientId !== "string" ||
                !Number.isSafeInteger(queued.revision)
              )
                throw new Error("Invalid queued send");
              if (desktopWatch(sessionId)?.running)
                throw new Error("The owning desktop is still running this session.");
              const currentQueue = sessionQueues.assertSend(
                sessionId,
                queued.id,
                queued.clientId,
                Number(queued.revision),
                params.type === "steer" || queued.selected === true,
              );
              const row = currentQueue.messages.find((entry) => entry.id === queued.id)!;
              if (
                params.type === "compact"
                  ? row.text.trim().toLowerCase() !== "/compact"
                  : params.text !== row.text
              )
                throw new Error("Queued message content changed.");
              if (row.modelTarget) {
                const session = featureSession(sessionId).session;
                if (
                  !sameQueuedModelTarget(row.modelTarget, {
                    harness: session.harness,
                    model: session.model,
                    modelSettings: session.modelSettings,
                  })
                )
                  throw new Error("Queued message model settings changed.");
              }
              const refs = parseRemoteAttachments(params.attachments);
              const queuedIntent =
                row.intent === "plan" || row.intent === "build" ? row.intent : "default";
              if (
                JSON.stringify(refs.map((file) => [file.id, file.size])) !==
                  JSON.stringify(row.attachments.map((file) => [file.id, file.size])) ||
                (params.type !== "compact" && (params.intent ?? "default") !== queuedIntent)
              )
                throw new Error("Queued message attachments or intent changed.");
            }
            if (
              (params.type === "steer" || params.type === "rewind") &&
              desktopWatch(sessionId)?.running
            )
              throw new Error(
                params.type === "rewind"
                  ? "This desktop-owned turn must finish before its conversation can be rewound."
                  : "This desktop-owned turn cannot be redirected through the host. Queue the message or stop it first.",
              );
            if (params.type === "rewind" && sessionQueues.get(sessionId).messages.length)
              throw new Error("Clear the queued messages before rewinding the conversation.");
            // Stopping or answering a turn the desktop app runs: leave it for
            // the app, which picks it up with its next heartbeat.
            if (params.type === "cancel" || params.type === "approve" || params.type === "answer") {
              const watch = desktopWatch(sessionId);
              if (watch?.running) {
                if (!desktop.live.alive())
                  throw new Error(
                    "The bycoda app on that computer isn't responding. Try again when it's open.",
                  );
                const command = parseCommand(params);
                if (
                  command.type === "cancel" ||
                  command.type === "approve" ||
                  command.type === "answer"
                )
                  desktop.live.enqueue(command);
                result = {
                  commandId: command.commandId,
                  sessionId,
                  revision: watch.revision,
                };
                break;
              }
            }
            if (params.type !== "create") adopt(sessionId);
            if (
              params.type === "send" &&
              typeof params.text === "string" &&
              isClearSessionCommand(params.text)
            ) {
              if (desktopWatch(sessionId)?.running || sessionQueues.get(sessionId).messages.length)
                throw new Error(
                  "Stop the current turn and clear queued messages before clearing the conversation.",
                );
              result = await engine.clearConversation(params);
              break;
            }
            if (params.type === "rewind") {
              result = await engine.rewind(params);
              break;
            }
            result = engine.store.transaction(() => {
              const receipt = engine.command(params);
              if (
                queued &&
                sessionQueues.get(sessionId).messages.some((row) => row.id === queued.id)
              )
                sessionQueues.consumed(sessionId, String(queued.id));
              crews.ownerDirective(params);
              return receipt;
            });
            break;
          }
          case "sync.pull": {
            const sinceRev = Number.isSafeInteger(params.sinceRev) ? Number(params.sinceRev) : 0;
            result = syncPull(
              engine.store.db,
              sinceRev,
              params.paginated === true
                ? {
                    untilRev:
                      Number.isSafeInteger(params.untilRev) && Number(params.untilRev) >= sinceRev
                        ? Number(params.untilRev)
                        : undefined,
                  }
                : undefined,
            );
            break;
          }
          case "sync.push": {
            if (!Array.isArray(params.ops)) throw new Error("Invalid sync ops");
            result = engine.store.transaction(() =>
              syncPush(engine.store.db, params.ops as SyncOp[]),
            );
            break;
          }
          case "notes.list":
            result = hostNotes.list(
              params.projectId === undefined
                ? undefined
                : engine.store.project(String(params.projectId)).cwd,
            );
            break;
          case "notes.get":
            result = hostNotes.get(params.id);
            break;
          case "notes.upsert":
            result = hostNotes.save(params.note, params.expectedUpdatedAt);
            break;
          case "notes.delete":
            result = hostNotes.delete(params.id, params.expectedUpdatedAt);
            break;
          case "inbox.provider.status":
            result = providerInbox.availability();
            break;
          case "inbox.provider.request": {
            const operation = parseRemoteInboxOperation(params, engine.store.projects());
            if (
              inboxOperationWrites(operation) &&
              params.confirm !==
                (operation.action === "comment" ? "SEND_COMMENT" : "CHANGE_PR_STATE")
            )
              throw new Error("This inbox write requires an explicit owner action.");
            result = providerInbox.request(
              createHash("sha256").update(token).digest("hex"),
              params.requestId,
              operation,
            );
            break;
          }
          case "inbox.provider.result":
            result = providerInbox.result(
              createHash("sha256").update(token).digest("hex"),
              params.requestId,
            );
            break;
          case "inbox.list": {
            const projectId = params.projectId === undefined ? undefined : String(params.projectId);
            const projects = projectId
              ? [engine.store.project(projectId)]
              : engine.store.projects();
            const sessions = (
              await Promise.all(projects.map((project) => projectSessionList(project.id)))
            ).flatMap((entry) => entry.list);
            result = hostInbox(
              {
                sessions,
                tasks: tasks.list(),
                goals: goals.list(),
                automations: automations.list(),
                threads: social.snapshot({ kind: "owner", actorId: "device", provider: "owner" })
                  .threads,
              },
              projectId,
            );
            break;
          }
          case "automations.list":
            result = automations.list();
            break;
          case "automations.preview":
            result = automations.preview(params.schedule);
            break;
          case "automations.save":
            result = automations.save(params.automation);
            break;
          case "automations.delete":
            automations.delete(String(params.automationId ?? ""));
            result = { deleted: true };
            break;
          case "automations.runs":
            result = automations.runs(String(params.automationId ?? ""));
            break;
          case "automations.runNow":
            result = automations.runNow(String(params.automationId ?? ""));
            break;
          case "crews.list":
          case "crews.schema":
          case "crews.inspect":
          case "crews.save":
          case "crews.delete":
          case "crews.agent.save":
          case "crews.agent.delete":
          case "crews.start":
          case "crews.get":
          case "crews.assign":
          case "crews.request":
          case "crews.resolve":
          case "crews.respond":
          case "crews.answer":
          case "crews.pause":
          case "crews.stop":
          case "crews.resume":
          case "crews.accept":
          case "crews.finish":
            result = await crews.call(input.method, params, String(params.projectId ?? ""));
            break;
          case "tasks.list":
            if (params.projectId !== undefined) engine.store.project(String(params.projectId));
            result = tasks.list(
              params.projectId === undefined ? undefined : String(params.projectId),
            );
            break;
          case "tasks.save":
            result = tasks.save(params.task);
            break;
          case "tasks.move":
            result = await tasks.move(String(params.taskId ?? ""), params.to);
            break;
          case "tasks.start":
            result = await tasks.startTask(String(params.taskId ?? ""));
            break;
          case "tasks.reorder":
            result = tasks.reorder(params.taskIds);
            break;
          case "tasks.retarget":
            result = await tasks.retarget(
              String(params.taskId ?? ""),
              params.workspace,
              params.autoMerge,
            );
            break;
          case "tasks.review.recheck":
            result = tasks.recheckReview(String(params.taskId ?? ""));
            break;
          case "tasks.notes.read":
            result = tasks.readNotes(String(params.taskId ?? ""), params.noteIds);
            break;
          case "tasks.notes.resolve":
            result = tasks.resolveNote(String(params.taskId ?? ""), params.noteId, params.resolved);
            break;
          case "tasks.delete":
            await tasks.delete(String(params.taskId ?? ""), params.discard === true);
            result = { deleted: true };
            break;
          case "goals.list":
            result = goals.list();
            break;
          case "goals.create":
            result = goals.create(params.goal);
            break;
          case "goals.approve":
            result = goals.approve(String(params.goalId ?? ""));
            break;
          case "goals.update":
            result = goals.update(
              String(params.goalId ?? ""),
              params.settings,
              params.expectedUpdatedAt,
            );
            break;
          case "goals.replan":
            result = goals.replan(String(params.goalId ?? ""), params.feedback);
            break;
          case "goals.cancel":
            result = await goals.cancel(String(params.goalId ?? ""));
            break;
          case "goals.delete":
            await goals.delete(String(params.goalId ?? ""), params.withTasks === true);
            result = { deleted: true };
            break;
          case "host.settings.get":
            result = tasks.limits.state();
            break;
          case "host.settings.save":
            tasks.limits.save(params.settings);
            result = tasks.limits.state();
            void tasks.tick();
            break;
          case "stewards.list":
            result = stewards.list();
            break;
          case "stewards.save":
            result = stewards.save(params.steward);
            break;
          case "stewards.delete":
            await stewards.delete(String(params.stewardId ?? ""));
            result = { deleted: true };
            break;
          case "stewards.runNow":
            result = await stewards.runNow(String(params.stewardId ?? ""));
            break;
          case "stewards.decline":
            await stewards.decline(String(params.taskId ?? ""));
            result = { declined: true };
            break;
          case "attachments.claim":
            attachmentOwnership.claim(token, params);
            result = { claimed: true };
            break;
          case "attachments.release":
            attachmentOwnership.release(token, params);
            result = { released: true };
            break;
          case "attachments.claims":
            result = attachmentOwnership.claims(token, params);
            break;
          case "attachments.status": {
            attachmentOwnership.touch(token, params);
            const status = await attachmentUploadStatus(engine.store, params);
            attachmentOwnership.uploaded(params, status.offset);
            result = status;
            break;
          }
          case "attachments.upload": {
            attachmentOwnership.touch(token, params);
            const uploaded = await writeAttachmentChunk(engine.store, params);
            attachmentOwnership.uploaded(params, uploaded.offset);
            result = uploaded;
            break;
          }
          case "attachments.read":
            result = await readAttachmentChunk(engine.store, params);
            break;
          case "mobile.pairing.create":
            result = mobilePairing.create(token, params);
            break;
          case "mobile.pairing.status":
            result = mobilePairing.status(token, params.pairingId);
            break;
          case "mobile.pairing.cancel":
            result = mobilePairing.cancel(token, params.pairingId);
            break;
          case "mobile.access.status":
            if (params.mode !== undefined && !["lan", "tailscale"].includes(String(params.mode)))
              throw new Error("Invalid phone connection mode.");
            result = params.mode === "lan" ? await mobileLan.status() : await mobileAccess.status();
            break;
          case "mobile.access.enable":
            if (params.mode !== undefined && !["lan", "tailscale"].includes(String(params.mode)))
              throw new Error("Invalid phone connection mode.");
            result =
              params.mode === "lan"
                ? await mobileLan.enable(params.address)
                : await mobileAccess.enable();
            break;
          case "mobile.access.disable":
            if (params.mode !== "lan")
              throw new Error("Only local network access can be disabled here.");
            result = await mobileLan.disable();
            break;
          case "tunnels.status":
            result = await tunnels.status();
            break;
          case "tunnels.start":
            result = await tunnels.start(params);
            break;
          case "tunnels.stop":
            result = await tunnels.stop(params);
            break;
          case "tunnels.credential":
            result = await tunnels.credential(params);
            break;
          case "devices.revokeSelf":
            diagnostics.revoke(token);
            sharedBrowser.revoke(token);
            // Only the caller's own credential. Sessions and other devices
            // are unaffected; the host keeps running.
            result = { revoked: engine.store.revokeToken(token) };
            break;
          case "git.diff": {
            const project = engine.store.project(String(params.projectId ?? ""));
            const diff = await exec(
              "git",
              ["-c", "core.pager=cat", "diff", "--no-ext-diff", "--no-textconv", "HEAD", "--"],
              {
                cwd: await resolveHostWorktreeAsync(project.cwd, params.cwd),
                timeout: 10_000,
                maxBuffer: 2 * 1024 * 1024,
              },
            );
            result = diff.stdout;
            break;
          }
          case "git.branches": {
            const project = engine.store.project(String(params.projectId ?? ""));
            result = await hostBranches(await resolveHostWorktreeAsync(project.cwd, params.cwd));
            break;
          }
          case "git.switch": {
            const project = engine.store.project(String(params.projectId ?? ""));
            const cwd = await resolveHostWorktreeAsync(project.cwd, params.cwd);
            result = await engine.withIdleProject(project.id, () =>
              switchHostBranch(cwd, params.branch, params.remote),
            );
            break;
          }
          case "git.createBranch": {
            const project = engine.store.project(String(params.projectId ?? ""));
            const cwd = await resolveHostWorktreeAsync(project.cwd, params.cwd);
            result = await engine.withIdleProject(project.id, () =>
              createHostBranch(cwd, params.branch),
            );
            break;
          }
          case "git.worktrees": {
            const project = engine.store.project(String(params.projectId ?? ""));
            result = await hostWorktrees(project.cwd);
            break;
          }
          case "git.worktreeCreate": {
            const project = engine.store.project(String(params.projectId ?? ""));
            const cwd = await resolveHostWorktreeAsync(project.cwd, params.cwd);
            result = await engine.withIdleProject(project.id, () =>
              createHostWorktree(project.cwd, params.branch, params.base, params.existing, cwd),
            );
            workspace.invalidateRoots();
            break;
          }
          case "files.read": {
            const project = engine.store.project(String(params.projectId ?? ""));
            result = await readHostFile(
              await resolveHostWorktreeAsync(project.cwd, params.cwd),
              params.path,
            );
            break;
          }
          case "files.list": {
            const project = engine.store.project(String(params.projectId ?? ""));
            result = await listHostFiles(
              await resolveHostWorktreeAsync(project.cwd, params.cwd),
              params.path,
            );
            break;
          }
          case "files.index": {
            const project = engine.store.project(String(params.projectId ?? ""));
            result = await indexHostFiles(await resolveHostWorktreeAsync(project.cwd, params.cwd));
            break;
          }
          case "workspace.run":
            result = (await workspace.run(params.command, params.args)) ?? null;
            break;
          case "files.search": {
            const project = engine.store.project(String(params.projectId ?? ""));
            result = await searchHostFiles(
              await resolveHostWorktreeAsync(project.cwd, params.cwd),
              params.query,
            );
            break;
          }
          case "files.searchContent": {
            const project = engine.store.project(String(params.projectId ?? ""));
            result = await searchHostContent(
              await resolveHostWorktreeAsync(project.cwd, params.cwd),
              params,
            );
            break;
          }
          case "files.create": {
            const project = engine.store.project(String(params.projectId ?? ""));
            result = await createHostPath(
              await resolveHostWorktreeAsync(project.cwd, params.cwd),
              params.parent,
              params.name,
              params.isDir,
            );
            break;
          }
          case "files.write": {
            const project = engine.store.project(String(params.projectId ?? ""));
            result =
              (await writeHostFile(
                await resolveHostWorktreeAsync(project.cwd, params.cwd),
                params.path,
                params.expected,
                params.content,
              )) ?? null;
            break;
          }
          case "git.index": {
            const project = engine.store.project(String(params.projectId ?? ""));
            result = await hostGitIndex(await resolveHostWorktreeAsync(project.cwd, params.cwd));
            break;
          }
          case "git.fileDiff": {
            const project = engine.store.project(String(params.projectId ?? ""));
            result = await hostFileDiff(
              await resolveHostWorktreeAsync(project.cwd, params.cwd),
              params.path,
              params.staged === true,
            );
            break;
          }
          case "git.action": {
            const project = engine.store.project(String(params.projectId ?? ""));
            const cwd = await resolveHostWorktreeAsync(project.cwd, params.cwd);
            result =
              (await engine.withIdleProject(project.id, () =>
                hostGitAction(
                  cwd,
                  params.action,
                  params.path,
                  params.message,
                  params.content,
                  params.expectedOriginal,
                ),
              )) ?? null;
            break;
          }
          default:
            throw new Error("Unsupported host method");
        }
        const inline = serializedResponse(result);
        response.end(inline === undefined ? JSON.stringify({ result }) : `{"result":${inline}}`);
      } catch (error) {
        if (!response.destroyed)
          response.writeHead(400).end(
            JSON.stringify({
              error: error instanceof Error ? error.message : "Host request failed",
            }),
          );
      } finally {
        if (dispatchStarted !== undefined)
          perfMetrics.recordDuration(dispatchMethod, performance.now() - dispatchStarted);
      }
    },
  );
  // Cached read-only desktop connections would keep the files locked.
  server.on("listening", () => {
    crews.start();
    perfMetrics.start();
    attachmentOwnership.start();
    void mobileLan.start().catch(() => {});
    social.start();
  });
  server.on("close", () => {
    crews.stop();
    attachmentOwnership.close();
    void terminals.close();
    devServerAccess.close();
    gitWatches.close();
    diagnostics.close();
    perfMetrics.close();
    devicePreviews.dispose();
    void deviceHost.dispose();
    void sharedBrowser.close();
    void logMonitors.close();
    void tunnels.close().catch(() => {});
    desktop.close();
    desktopDelete.close();
  });
  server.on("close", () => {
    xBrowser.workflows.stop(social);
    social.stop();
  });
  server.on("close", () => mobilePairing.close());
  server.on("close", () => {
    void mobileLan.close();
  });
  server.on("close", () => conversationDesktop.close());
  return Object.assign(server, {
    social,
    tunnels,
    terminals,
    runtimeLogAccess,
    conversationAccess,
  });
}
