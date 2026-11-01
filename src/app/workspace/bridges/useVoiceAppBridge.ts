import { useMemo, useRef, useState } from "react";
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
import {
  getSession,
  listSessionsByProject,
  upsertSession,
} from "../../../features/sessions/data/sessionStore";
import { isRemoteProjectPath, sameProjectPath } from "../../../features/projects/model/recents";
import { isHarnessAvailable } from "../../../integrations/harness/core/availability";
import type { QuickLaunch } from "../../../features/quick-composer/model/quickComposer";
import { featureHost } from "../../../features/connections/model/hostFeatureClient";
import {
  remoteShellBoundTo,
  rememberRemoteSession,
  sessionAccessForMachine,
} from "../../../features/connections/model/connections";
import {
  sessionsRef as currentSessions,
  setSessions,
} from "../../../features/sessions/model/sessionsStore";
import { isRemoteProvider } from "../../../features/connections/model/protocol";
import type { VoiceWorkspaceSession } from "../../../features/voice/model/voiceWorkspaceActions";
import { t } from "../../../shared/i18n";
import { pathKey } from "../../../shared/lib/paths";

type Deps = {
  projects: readonly VoiceWorkspaceProject[];
  sessions: Session[];
  projectPath: string;
  activeId?: string;
  launch: (launch: QuickLaunch, id: string) => Promise<void>;
  appendEmpty: (session: Session) => void;
  onOpenRemote?: (projectPath: string, sessionId: string) => void;
} & Pick<
  VoiceWorkspaceActionsDeps,
  | "onSelectProject"
  | "onOpen"
  | "onClose"
  | "onRename"
  | "onArchive"
  | "onDelete"
  | "onSubmit"
  | "onStop"
>;

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

function withSources(sessions: readonly Session[], sources: readonly Session[]): Session[] {
  const ids = new Set(sessions.map((session) => session.id));
  return [...sessions, ...sources.filter((session) => !ids.has(session.id))];
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

export function useVoiceAppBridge(deps: Deps) {
  const latest = useRef(deps);
  latest.current = deps;
  const [sources, setSources] = useState<Session[]>([]);
  const sourceRefs = useRef<Session[]>(sources);
  const listedSessions = useRef(new Map<string, VoiceWorkspaceSession>());
  sourceRefs.current = sources;
  const assistantSession = useMemo(() => newDefaultSession(deps.projectPath), [deps.projectPath]);
  const visible = (path: string) =>
    latest.current.projects.some((entry) => sameProjectPath(entry.path, path));
  const assertVisible = (path: string) => {
    if (!visible(path)) throw new Error("Voice project is locked or unavailable.");
  };
  const owner = useRef<ReturnType<typeof createVoiceToolSessionOwner> | null>(null);
  if (!owner.current)
    owner.current = createVoiceToolSessionOwner({
      visible,
      create: async (path, id) => {
        assertVisible(path);
        const session = newDefaultSession(path);
        session.id = id;
        session.title = t("Voice companion");
        if (isRemoteProjectPath(path)) {
          const { machine, projectId } = await featureHost(path, "voice.tools.v1");
          assertVisible(path);
          if (!isRemoteProvider(session.harness))
            throw new Error("Voice provider is unavailable on this Host.");
          const access = sessionAccessForMachine(machine.id);
          const receipt = await access.dispatch({
            type: "create",
            commandId: id,
            sessionId: id,
            projectId,
            workspaceMode: "current",
            harness: session.harness,
            model: session.model,
            modelSettings: session.modelSettings,
            runtimeMode: session.runtimeMode,
          });
          const sync = await access.sync(receipt.sessionId);
          assertVisible(path);
          if (!("kind" in sync) || sync.kind !== "snapshot")
            throw new Error("Voice management session could not be verified.");
          // This is the normal remote shell binding, not a writable Native copy.
          rememberRemoteSession(receipt.sessionId, receipt.sessionId);
          return { ...sync.value.session, cwd: path };
        }
        // A draft user record makes the source durable without submitting any message.
        session.blocks = [{ id: crypto.randomUUID(), role: "user", text: "", draft: true }];
        const saved = await upsertSession(session);
        if (!saved) throw new Error("Voice management session could not be saved.");
        return session;
      },
      created: (session) => {
        registerVoiceToolSessionSource(session);
        sourceRefs.current = [
          ...sourceRefs.current.filter((entry) => entry.id !== session.id),
          session,
        ];
        setSources(sourceRefs.current);
      },
    });
  const onCreate = async (request: VoiceSessionCreate) => {
    assertVisible(request.projectPath);
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
    if (!request.prompt.trim() && !request.submit) {
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
    getProjects: () => latest.current.projects,
    getSessions: () => withSources(currentSessions.current, sourceRefs.current),
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
    onOpen: async (id) => {
      const remote = listedSessions.current.get(id);
      if (remote && isRemoteProjectPath(remote.cwd) && latest.current.onOpenRemote) {
        assertVisible(remote.cwd);
        latest.current.onOpenRemote(remote.cwd, id);
      } else await latest.current.onOpen?.(id);
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
  });
  return {
    workspace,
    projects: deps.projects,
    projectPath: deps.projectPath,
    sessions: withSources(
      deps.sessions,
      sources.filter((entry) => visible(entry.cwd)),
    ),
    ensureToolSession: owner.current,
    assistantSession,
  };
}
