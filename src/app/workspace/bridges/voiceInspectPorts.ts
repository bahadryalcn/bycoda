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
import { requestAppUi, type AppUiInput } from "../../model/appUiControl";

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
  return {
    // Reuses the `ui.workspace.open` navigator with the calling window's active conversation.
    navigate: async (view, section) => {
      const current = latest();
      const source = current.sessions.find((entry) => entry.id === current.activeId);
      if (!source || !visible(source.cwd))
        throw new Error("Open a conversation in an unlocked project to navigate.");
      await requestAppUi(
        { cwd: source.cwd, sessionId: source.id, title: source.title },
        "ui.workspace.open",
        { view, ...(section ? { section } : {}) } as AppUiInput,
      );
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
