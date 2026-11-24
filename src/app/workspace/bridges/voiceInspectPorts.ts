import {
  conversationRowsFrom,
  hitsFromSessionSearch,
  searchConversationTitles,
  searchRecentProjects,
  type AppSearchHit,
} from "../../../features/search/model/appSearch";
import { cancelSessionSearch, searchSessions } from "../../../features/sessions/data/sessionStore";
import type { Session } from "../../../features/sessions/model/session";
import { fetchTodaySources, summarizeTodaySources } from "../../../features/today";
import { getGroupLockView } from "../../../features/group-lock/model/groupLock";
import {
  type McpSettingsSnapshot,
  getCachedMcpSettings,
  loadMcpSettings,
} from "../../../features/settings/model/mcpSettingsCache";
import { MCP_PROVIDER_LABELS } from "../../../features/settings/model/mcp";
import { sameProjectPath } from "../../../features/projects/model/recents";
import {
  voiceInspectDeadline,
  type VoiceInspectSearchHit,
  VoiceWorkspaceInspectDeps,
} from "../../../features/voice/model/voiceWorkspaceInspect";
import {
  openUsageDashboard,
  readUsageReport,
  usageIntentFor,
  usageIntentForRequest,
} from "../../../features/usage/public/usageReport";
import { requestAppUi, type AppUiInput, type AppUiRequestContext } from "../../model/appUiControl";

const SEARCH_OWNER = "voice-workspace-search";

type Latest = () => {
  projects: readonly { path: string }[];
  sessions: readonly Session[];
  projectPath: string;
  activeId?: string;
};

const toHit = (hit: AppSearchHit): VoiceInspectSearchHit | null => {
  if (hit.kind === "conversation")
    return {
      kind: "session",
      title: hit.title,
      projectPath: hit.cwd,
      sessionId: hit.sessionId,
      score: hit.score,
    };
  if (hit.kind === "message")
    return {
      kind: "message",
      title: hit.title,
      subtitle: hit.preview,
      projectPath: hit.cwd,
      sessionId: hit.sessionId,
      score: hit.score,
    };
  if (hit.kind === "project")
    return {
      kind: "project",
      title: hit.name,
      subtitle: hit.path,
      projectPath: hit.path,
      score: hit.score,
    };
  return null;
};

/** Real sources behind the voice navigation and read tools; lock filtering happens in the tools. */
export function createVoiceInspectPorts(latest: Latest): VoiceWorkspaceInspectDeps {
  const visible = (path: string) =>
    latest().projects.some((item) => sameProjectPath(item.path, path));
  // Reuses the `ui.workspace.*` navigator. An active conversation supplies its own window context;
  // with none, the window's visible project does (no session identity); with no unlocked project
  // either, the projectless global Room reaches only the global views and never a locked project.
  const scope = (): AppUiRequestContext => {
    const current = latest();
    const source = current.sessions.find((entry) => entry.id === current.activeId);
    if (source) {
      if (!visible(source.cwd))
        throw new Error("Open a conversation in an unlocked project to navigate.");
      return { cwd: source.cwd, sessionId: source.id, title: source.title };
    }
    if (!visible(current.projectPath)) return { global: true, title: "Voice navigation" };
    return { cwd: current.projectPath, window: true, title: "Voice navigation" };
  };
  const navigate: NonNullable<VoiceWorkspaceInspectDeps["navigate"]> = (view, section) =>
    requestAppUi(scope(), "ui.workspace.open", {
      view,
      ...(section ? { section } : {}),
    } as AppUiInput);
  const close: NonNullable<VoiceWorkspaceInspectDeps["close"]> = (view) =>
    requestAppUi(scope(), "ui.workspace.close", { view } as AppUiInput);
  const status: NonNullable<VoiceWorkspaceInspectDeps["status"]> = () =>
    requestAppUi(scope(), "ui.workspace.status", {});
  return {
    navigate,
    close,
    status,
    usage: {
      read: (request) => readUsageReport(request),
      // Settings opens through the workspace opener, so no conversation is borrowed; filters follow confirmation.
      open: async ({ request, report }) => {
        const fallback = report ? undefined : usageIntentForRequest(request, Date.now());
        const { filtersApplied } = await openUsageDashboard(
          report ? usageIntentFor(report) : fallback?.intent,
        );
        return { filtersApplied, skipped: fallback?.skipped ?? [] };
      },
    },
    search: async (query) => {
      const current = latest();
      const local = [
        ...searchConversationTitles(
          conversationRowsFrom(
            [],
            current.sessions.filter((entry) => visible(entry.cwd)),
          ),
          query,
        ),
        ...searchRecentProjects(
          current.projects.map((item) => ({ path: item.path, openedAt: 0 })),
          query,
        ),
      ];
      let partial = false;
      let stored: AppSearchHit[] = [];
      try {
        const result = await voiceInspectDeadline(
          searchSessions({ query, searchOwner: SEARCH_OWNER }),
          6000,
        );
        if (result) {
          stored = hitsFromSessionSearch(result.hits);
          partial = result.truncated;
        } else {
          // Abandon the stored-history search and answer from loaded sessions and projects.
          partial = true;
          cancelSessionSearch(SEARCH_OWNER).catch(() => undefined);
        }
      } catch {
        partial = true;
      }
      const hits = [...local, ...stored]
        .map(toHit)
        .filter((hit): hit is VoiceInspectSearchHit => hit !== null);
      return { hits, partial };
    },
    today: async () => {
      const { value, failed } = await fetchTodaySources("today");
      return {
        data: summarizeTodaySources(value, getGroupLockView().lock, "today"),
        partial: failed,
      };
    },
    mcp: async () => {
      const cwd = latest().projectPath;
      if (!visible(cwd)) throw new Error("The current project is locked or unavailable.");
      const snapshot = await loadMcpSettings(cwd);
      const current: McpSettingsSnapshot = getCachedMcpSettings(cwd) ?? {
        ...snapshot,
        claudeError: "",
      };
      return {
        servers: current.servers.map((server) => ({
          provider: MCP_PROVIDER_LABELS[server.provider] ?? server.provider,
          name: server.name,
          scope: server.scope,
          transport: server.transport,
          enabled: server.enabled,
          status: server.status,
          auth: server.auth,
        })),
        error: current.error ? "MCP configuration could not be read for this project." : undefined,
        partial: current.claudeChecking === true || current.claudePartial === true,
      };
    },
  };
}
