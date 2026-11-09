import { useRef } from "react";
import { sameProjectPath } from "../../../features/projects/model/recents";
import {
  resolveVoiceProjects,
  voiceNameKey,
} from "../../../features/voice/model/voiceProjectNames";
import {
  voiceWorkspaceTools,
  type VoiceWorkspaceActionsDeps,
  type VoiceWorkspaceResult,
  type VoiceWorkspaceSession,
} from "../../../features/voice/model/voiceWorkspaceActions";

const clean = (value: unknown, field: string, max = 4096) => {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`Invalid ${field}.`);
  return value;
};

/** Reuses owner actions; this bridge grants no new provider or project authority. */
export function createVoiceWorkspaceActions(read: () => VoiceWorkspaceActionsDeps) {
  const receipts = new Map<string, { signature: string; result: Promise<VoiceWorkspaceResult> }>();
  const project = (path: string) => {
    const found = read()
      .getProjects()
      .find((entry) => sameProjectPath(entry.path, path));
    if (!found) throw new Error("Project is not currently available or is locked.");
    return found.path;
  };
  const visible = (session: VoiceWorkspaceSession) =>
    !session.orchestrationLeadId && !session.inboxAsk;
  const session = async (id: string, path: string) => {
    project(path);
    const before = read();
    const value =
      before.getSessions().find((entry) => entry.id === id) ?? (await before.resolveSession?.(id));
    project(path);
    const current =
      read()
        .getSessions()
        .find((entry) => entry.id === id) ?? value;
    if (!current || !visible(current) || !sameProjectPath(current.cwd, path))
      throw new Error("Session is unavailable in the requested project.");
    return current;
  };
  const unsupported = () => {
    throw new Error("This workspace action is not available in the current window.");
  };
  async function perform(
    action: string,
    args: Record<string, unknown>,
    workspaceRequestId?: string,
  ): Promise<VoiceWorkspaceResult> {
    if (action === "workspace.projects.list") {
      const projects = read()
        .getProjects()
        .slice(0, 200)
        .map(({ path, name, folderName, aliases }) => ({
          path,
          name,
          ...(folderName ? { folderName } : {}),
          ...(aliases ? { aliases } : {}),
        }));
      return {
        action,
        status: "completed",
        projects,
        activeProjectPath: read().getProjectPath(),
        activeSessionId: read().getActiveSessionId(),
        truncated: read().getProjects().length > projects.length,
      };
    }
    if (action === "workspace.projects.resolve")
      return {
        action,
        status: "completed",
        ...resolveVoiceProjects(read().getProjects(), clean(args.query, "query")),
      };
    const path = project(clean(args.projectPath, "projectPath"));
    if (action === "workspace.sessions.list") {
      const rawLimit = args.limit ?? 50;
      const rawOffset = args.offset ?? 0;
      const state = args.state ?? "all";
      const query = args.query === undefined ? "" : voiceNameKey(clean(args.query, "query", 200));
      if (typeof state !== "string" || !["all", "running", "archived"].includes(state))
        throw new Error("Invalid session state.");
      if (
        !Number.isInteger(rawLimit) ||
        Number(rawLimit) < 1 ||
        Number(rawLimit) > 100 ||
        !Number.isInteger(rawOffset) ||
        Number(rawOffset) < 0
      )
        throw new Error("Invalid session pagination.");
      const stored = (await read().listSessions?.(path)) ?? [];
      project(path);
      const byId = new Map<string, VoiceWorkspaceSession>();
      const loaded = read().getSessions();
      const loadedIds = new Set(loaded.map((item) => item.id));
      for (const item of [...stored, ...loaded])
        if (visible(item) && sameProjectPath(item.cwd, path))
          byId.set(item.id, { ...byId.get(item.id), ...item });
      const all = [...byId.values()].filter(
        (item) =>
          (state !== "running" || item.busy === true) &&
          (state !== "archived" || item.archived === true) &&
          (!query ||
            [item.title, item.model, item.harness].some((value) =>
              voiceNameKey(value).includes(query),
            )),
      );
      const offset = Number(rawOffset);
      const items = all
        .slice(offset, offset + Number(rawLimit))
        .map(({ id, title, cwd, harness, model, busy, archived, updatedAt }) => ({
          id,
          title,
          projectPath: cwd,
          harness,
          model,
          busy: Boolean(busy),
          loaded: loadedIds.has(id),
          active: read().getActiveSessionId() === id,
          archived: Boolean(archived),
          ...(typeof updatedAt === "number" ? { updatedAt } : {}),
        }));
      return {
        action,
        status: "completed",
        projectPath: path,
        sessions: items,
        total: all.length,
        nextOffset: offset + items.length < all.length ? offset + items.length : null,
        coverage: read().listSessions ? "stored-and-loaded" : "loaded-only",
      };
    }
    if (action === "workspace.projects.select") {
      const fn = read().onSelectProject ?? unsupported;
      await fn(path, workspaceRequestId);
      return {
        action,
        status: sameProjectPath(read().getProjectPath(), path) ? "completed" : "accepted",
        projectPath: path,
      };
    }
    if (action === "workspace.sessions.create") {
      const fn = read().onCreate ?? unsupported;
      if (
        args.prompt !== undefined &&
        (typeof args.prompt !== "string" || args.prompt.length > 16000)
      )
        throw new Error("Invalid prompt.");
      if (args.submit !== undefined && typeof args.submit !== "boolean")
        throw new Error("Invalid submit.");
      const prompt = typeof args.prompt === "string" ? args.prompt : "";
      if (args.submit === true && !prompt.trim())
        throw new Error("Work cannot be submitted without a prompt.");
      const id = await fn({
        projectPath: path,
        requestId: clean(args.requestId, "requestId"),
        prompt,
        submit: args.submit === true,
        ...(workspaceRequestId ? { workspaceRequestId } : {}),
        ...(args.harness === undefined ? {} : { harness: clean(args.harness, "harness", 200) }),
        ...(args.model === undefined ? {} : { model: clean(args.model, "model", 200) }),
      });
      return {
        action,
        status: "accepted",
        projectPath: path,
        sessionId: clean(id, "created session ID"),
        submitted: args.submit === true,
      };
    }
    const id = clean(args.sessionId, "sessionId");
    const target = await session(id, path);
    const deps = read();
    const base = { action, sessionId: id, projectPath: path };
    switch (action) {
      case "workspace.sessions.open":
        await (deps.onOpen ?? unsupported)(id, workspaceRequestId);
        return { ...base, status: read().getActiveSessionId() === id ? "completed" : "accepted" };
      case "workspace.sessions.close": {
        const result = await (deps.onClose ?? unsupported)(id);
        return { ...base, status: result === false ? "cancelled" : "accepted" };
      }
      case "workspace.sessions.rename":
        await (deps.onRename ?? unsupported)(id, clean(args.title, "title", 200));
        return { ...base, status: "accepted" };
      case "workspace.sessions.archive": {
        if (typeof args.archived !== "boolean") throw new Error("Invalid archived.");
        const result = await (deps.onArchive ?? unsupported)(id, args.archived);
        return {
          ...base,
          status: result === false ? "cancelled" : "accepted",
          archived: args.archived,
        };
      }
      case "workspace.sessions.delete": {
        const result = await (deps.onDelete ?? unsupported)(id);
        return {
          ...base,
          status: result === false ? "cancelled" : "accepted",
          verification: "Read session state after the existing owner confirmation flow completes.",
        };
      }
      case "workspace.sessions.submit": {
        if (target.historyLoading || target.historyLoadError || target.worktreeRemoved)
          throw new Error("The session is not ready for work.");
        const accepted = await (deps.onSubmit ?? unsupported)(id, clean(args.text, "text", 16000));
        return { ...base, status: accepted ? "accepted" : "rejected", accepted };
      }
      case "workspace.sessions.stop":
        await (
          workspaceRequestId ? (deps.onStopForRoom ?? unsupported) : (deps.onStop ?? unsupported)
        )(id);
        return {
          ...base,
          status: "accepted",
          verification: "Read session status to verify the running work stopped.",
        };
      default:
        throw new Error("Unknown workspace action.");
    }
  }
  const execute = async (
    action: string,
    args: Record<string, unknown> = {},
    workspaceRequestId?: string,
  ): Promise<VoiceWorkspaceResult> => {
    try {
      const tool = voiceWorkspaceTools.find((entry) => entry.name === action);
      if (!tool) throw new Error("Unknown workspace action.");
      for (const key of Object.keys(args))
        if (!(key in tool.parameters.properties)) throw new Error(`Unknown argument: ${key}.`);
      for (const key of tool.parameters.required)
        if (args[key] === undefined) throw new Error(`Missing ${key}.`);
      if (action.endsWith(".list") || action === "workspace.projects.resolve")
        return await perform(action, args);
      const requestId = clean(args.requestId, "requestId");
      const signature = JSON.stringify([
        action,
        Object.entries(args).sort(([a], [b]) => a.localeCompare(b)),
      ]);
      const old = receipts.get(requestId);
      if (old) {
        if (old.signature !== signature)
          throw new Error("Request ID was already used with different input.");
        return await old.result;
      }
      if (receipts.size >= 500)
        throw new Error(
          "Voice action history is full. Reopen the voice controller before starting another action.",
        );
      const result = perform(action, { ...args }, workspaceRequestId);
      receipts.set(requestId, { signature, result });
      return await result;
    } catch (error) {
      return {
        action,
        status: "rejected",
        error: error instanceof Error ? error.message : "Workspace action failed.",
      };
    }
  };
  return { tools: voiceWorkspaceTools, execute };
}

export function useVoiceWorkspaceActions(deps: VoiceWorkspaceActionsDeps) {
  const latest = useRef(deps);
  latest.current = deps;
  const actions = useRef<ReturnType<typeof createVoiceWorkspaceActions> | null>(null);
  actions.current ??= createVoiceWorkspaceActions(() => latest.current);
  return actions.current;
}
