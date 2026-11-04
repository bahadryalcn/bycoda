import { useMemo, useRef, useSyncExternalStore } from "react";
import {
  loadTabGroupLabels,
  subscribeTabGroupLabels,
} from "../../../features/workspace/model/tabGroups";
import { voiceProjectNames } from "../../../features/voice/model/voiceProjectNames";
import { useVoiceWorkspaceActions } from "./useVoiceWorkspaceActions";
import type {
  VoiceSessionCreate,
  VoiceWorkspaceActionsDeps,
  VoiceWorkspaceProject,
} from "../../../features/voice/model/voiceWorkspaceActions";
import {
  newDefaultSession,
  newSession,
  HARNESSES,
  type Session,
} from "../../../features/sessions/model/session";
import { getSession, listSessionsByProject } from "../../../features/sessions/data/sessionStore";
import {
  collectRailProjects,
  isRemoteProjectPath,
  sameProjectPath,
  type RecentProject,
} from "../../../features/projects/model/recents";
import { visibleProjects, type LockSnapshot } from "../../../features/group-lock/model/lockState";
import { isHarnessAvailable } from "../../../integrations/harness/core/availability";
import type { QuickLaunch } from "../../../features/quick-composer/model/quickComposer";
import { featureHost } from "../../../features/connections/model/hostFeatureClient";
import {
  remoteShellBoundTo,
  sessionAccessForMachine,
} from "../../../features/connections/model/connections";
import {
  sessionsRef as currentSessions,
  setSessions,
} from "../../../features/sessions/model/sessionsStore";
import type { VoiceWorkspaceSession } from "../../../features/voice/model/voiceWorkspaceActions";
import { pathKey } from "../../../shared/lib/paths";

type Deps = {
  projects: readonly VoiceWorkspaceProject[];
  sessions: Session[];
  projectPath: string;
  activeId?: string;
  launch: (launch: QuickLaunch, id: string) => Promise<void>;
  appendEmpty: (session: Session) => void;
  onOpenRemote?: (projectPath: string, sessionId: string) => void;
  onOpen?: (sessionId: string, options?: { workspaceRequestId?: string }) => void | Promise<void>;
} & Pick<
  VoiceWorkspaceActionsDeps,
  | "onSelectProject"
  | "onClose"
  | "onRename"
  | "onArchive"
  | "onDelete"
  | "onSubmit"
  | "onStop"
  | "onStopForRoom"
>;

/** Match the rail's project directory, including a not-yet-remembered current folder. */
export function voiceRailProjects(recents: RecentProject[], current: string, locks: LockSnapshot) {
  return visibleProjects(
    locks,
    [...collectRailProjects(recents, current).values()],
    (item) => item.path,
  );
}

/** Register the persisted source for native desktop relays without opening or focusing a tab. */
export function registerVoiceToolSessionSource(source: Session): void {
  setSessions((current) => {
    const previous = current.find((entry) => entry.id === source.id);
    if (previous) {
      if (!sameProjectPath(previous.cwd, source.cwd) || previous.harness !== source.harness)
        throw new Error("The voice management source identity changed.");
      return current;
    }
    return [...current, source];
  });
}

/** These sources are ordinary unsent records, never running coding turns. */
export function createVoiceToolSessionOwner(ports: {
  visible(path: string): boolean;
  create(path: string, id: string): Promise<Session>;
  created(session: Session): void;
  id?: () => string;
}) {
  const pending = new Map<string, { id: string; result?: Promise<string> }>();
  return (path: string) => {
    if (!ports.visible(path))
      return Promise.reject(new Error("Voice project is locked or unavailable."));
    const key = pathKey(path);
    let entry = pending.get(key);
    if (!entry) {
      entry = { id: (ports.id ?? (() => crypto.randomUUID()))() };
      pending.set(key, entry);
    }
    if (!entry.result) {
      const current = entry;
      current.result = (async () => {
        const session = await ports.create(path, current.id);
        if (!ports.visible(path)) throw new Error("Voice project became locked or unavailable.");
        ports.created(session);
        return session.id;
      })();
      // Retry only with the same creation identity after an uncertain result.
      current.result.catch(() => {
        current.result = undefined;
      });
    }
    return entry.result!;
  };
}

const projectLabelSnapshot = () => JSON.stringify(loadTabGroupLabels());

export function useVoiceAppBridge(deps: Deps) {
  const labelSnapshot = useSyncExternalStore(
    subscribeTabGroupLabels,
    projectLabelSnapshot,
    projectLabelSnapshot,
  );
  const projects = useMemo(() => voiceProjectNames(deps.projects), [deps.projects, labelSnapshot]);
  const latest = useRef(deps);
  latest.current = deps;
  const listedSessions = useRef(new Map<string, VoiceWorkspaceSession>());
  const assistantSession = useMemo(() => newDefaultSession(deps.projectPath), [deps.projectPath]);
  const visible = (path: string) =>
    latest.current.projects.some((entry) => sameProjectPath(entry.path, path));
  const assertVisible = (path: string) => {
    if (!visible(path)) throw new Error("Voice project is locked or unavailable.");
  };
  const onCreate = async (request: VoiceSessionCreate) => {
    assertVisible(request.projectPath);
    if (request.workspaceRequestId && request.submit) throw new Error("Room desktop session creation cannot submit work.");
    const choice = newDefaultSession(request.projectPath);
    if (request.harness !== undefined && !HARNESSES.includes(request.harness as Session["harness"]))
      throw new Error("Unknown voice session provider.");
    const harness = (request.harness ?? choice.harness) as Session["harness"];
    if (!isHarnessAvailable(harness))
      throw new Error("The requested voice session provider is unavailable.");
    const session = newSession(
      harness,
      request.projectPath,
      request.model ?? (harness === choice.harness ? choice.model : undefined),
    );
    if (request.workspaceRequestId) {
      const { createRoomSession } = await import("../../../features/sessions/data/sessionStore");
      const created = request.prompt.trim() ? (await import("../sessions/useSessionDraftActions")).addSessionDraft(session, request.prompt, [], request.requestId) : session;
      await createRoomSession(created);
      assertVisible(request.projectPath);
      latest.current.appendEmpty(created);
    } else if (!request.prompt.trim() && !request.submit) {
      latest.current.appendEmpty(session);
    } else {
      await latest.current.launch(
        {
          cwd: request.projectPath,
          harness,
          model: session.model,
          runtimeMode: session.runtimeMode,
          prompt: request.prompt,
          draft: !request.submit,
          reveal: true,
        },
        session.id,
      );
    }
    assertVisible(request.projectPath);
    return session.id;
  };
  const listSessions = async (path: string): Promise<VoiceWorkspaceSession[]> => {
    assertVisible(path);
    if (!isRemoteProjectPath(path)) {
      const entries = await listSessionsByProject(path);
      assertVisible(path);
      return entries.map((entry) => ({ ...entry, busy: false }));
    }
    const { machine, projectId } = await featureHost(path, "voice.tools.v1");
    const list = await sessionAccessForMachine(machine.id).list(projectId);
    assertVisible(path);
    if (!Array.isArray(list) && "unchanged" in list)
      throw new Error("Voice session list is unavailable.");
    const entries = Array.isArray(list) ? list : list.sessions;
    const rows = entries.map((entry) => ({
      id: entry.id,
      cwd: path,
      title: entry.title,
      harness: entry.harness,
      model: entry.model ?? "",
      busy: entry.status === "running",
      archived: entry.archived,
      updatedAt: entry.updatedAt,
    }));
    for (const row of rows) listedSessions.current.set(row.id, row);
    return rows;
  };
  const actionId = (id: string) => {
    if (currentSessions.current.some((entry) => entry.id === id)) return id;
    const shell = remoteShellBoundTo(id);
    if (shell) return shell;
    if (isRemoteProjectPath(listedSessions.current.get(id)?.cwd ?? ""))
      throw new Error("Open this remote session before changing it.");
    return id;
  };
  const workspace = useVoiceWorkspaceActions({
    getProjects: () => voiceProjectNames(latest.current.projects),
    getSessions: () => currentSessions.current,
    getActiveSessionId: () => latest.current.activeId,
    getProjectPath: () => latest.current.projectPath,
    resolveSession: async (id) => {
      const stored = (await getSession(id)) ?? listedSessions.current.get(id) ?? null;
      if (stored) assertVisible(stored.cwd);
      return stored;
    },
    listSessions,
    onCreate,
    onSelectProject: deps.onSelectProject,
    onOpen: async (id, workspaceRequestId) => {
      const remote = listedSessions.current.get(id);
      if (remote && isRemoteProjectPath(remote.cwd) && latest.current.onOpenRemote) {
        if (workspaceRequestId) throw new Error("Room desktop session must belong to the native workspace.");
        assertVisible(remote.cwd);
        latest.current.onOpenRemote(remote.cwd, id);
      } else if (workspaceRequestId) await latest.current.onOpen?.(id, { workspaceRequestId });
      else await latest.current.onOpen?.(id);
    },
    onClose: deps.onClose ? (id) => latest.current.onClose!(actionId(id)) : undefined,
    onRename: deps.onRename
      ? (id, title) => latest.current.onRename!(actionId(id), title)
      : undefined,
    onArchive: deps.onArchive
      ? (id, archived) => latest.current.onArchive!(actionId(id), archived)
      : undefined,
    onDelete: deps.onDelete ? (id) => latest.current.onDelete!(actionId(id)) : undefined,
    onSubmit: deps.onSubmit
      ? (id, prompt) => latest.current.onSubmit!(actionId(id), prompt)
      : undefined,
    onStop: deps.onStop ? (id) => latest.current.onStop!(actionId(id)) : undefined,
    onStopForRoom: deps.onStopForRoom ? (id) => latest.current.onStopForRoom!(actionId(id)) : undefined,
  });
  return {
    workspace,
    projects,
    projectPath: deps.projectPath,
    sessions: deps.sessions,
    assistantSession,
  };
}
