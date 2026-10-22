import { useEffect, useRef, type MutableRefObject } from "react";
import { flushSync } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { handleAgentApp, type AppSessionListing } from "../../../features/agent-app/model/agentApp";
import { getGroupLockView } from "../../../features/group-lock/model/groupLock";
import { isProjectLockedIn } from "../../../features/group-lock/model/lockState";
import { NOTES_CHANGED_EVENT, upsertNote } from "../../../features/notes";
import { orchestrator } from "../../../features/orchestration/model/orchestration";
import { sameProjectPath } from "../../../features/projects/model/recents";
import { getSession, listSessionsByProject } from "../../../features/sessions/data/sessionStore";
import { sessionDraftBlock, sessionWorkCwd } from "../../../features/sessions/model/session";
import { useHistorySourceRegistration } from "./useHistorySourceRegistration";
import { sessionsRef } from "../../../features/sessions/model/sessionsStore";
import { createWorktree, listWorktrees } from "../../../features/source-control/model/worktrees";
import type { useQuickSessionLaunch } from "../bridges/useQuickSessionLaunch";
import type { useSessionDraftActions } from "../sessions/useSessionDraftActions";
import type { useSessionLoading } from "../sessions/useSessionLoading";
import type { useSubmitSession } from "../sessions/submit/useSubmitSession";

export interface AppControlRequestDeps {
  launchQuickSessionRef: MutableRefObject<
    ReturnType<typeof useQuickSessionLaunch>["launchQuickSession"]
  >;
  submitSessionRef: MutableRefObject<ReturnType<typeof useSubmitSession>["submitSession"]>;
  ensureOpenSessionRef: MutableRefObject<ReturnType<typeof useSessionLoading>["ensureOpenSession"]>;
  saveDraftRef: MutableRefObject<ReturnType<typeof useSessionDraftActions>["onSaveDraft"]>;
}

/** Listens for `bycoda-control-request` (app and conversation CLI relays) and answers over `control_reply`. */
export function useAppControlRequests({
  launchQuickSessionRef,
  submitSessionRef,
  ensureOpenSessionRef,
  saveDraftRef,
}: AppControlRequestDeps): void {
  useHistorySourceRegistration();
  const appReceipts = useRef(new Map<string, { signature: string; promise: Promise<unknown> }>());

  useEffect(() => {
    const listening = listen<{
      id: string;
      namespace: string;
      sessionId: string;
      requestId: string;
      action: string;
      input: Record<string, unknown>;
    }>("bycoda-control-request", ({ payload }) => {
      const receivedAt = Date.now();
      const handle = async () => {
        if (payload.namespace === "control") {
          return orchestrator.handle(
            payload.sessionId,
            payload.requestId,
            payload.action,
            payload.input,
          );
        }
        const conversationRead =
          payload.namespace === "conversation-ui" &&
          (payload.action === "sessions.list" || payload.action === "sessions.read");
        if (payload.namespace === "conversation-ui" && !conversationRead) {
          const source = sessionsRef.current.find((session) => session.id === payload.sessionId);
          if (!source) throw new Error("Conversation is not open in this window.");
          if (isProjectLockedIn(getGroupLockView().lock, source.cwd))
            throw new Error("Conversation project is locked.");
          if (["ssh.workspace.catalog.read", "ssh.workspace.review", "ssh.workspace.approve", "ssh.workspace.status", "ssh.workspace.close.review", "ssh.workspace.close.approve"].includes(payload.action)) {
            const { actorId, environmentId, projectCwd, sessionId, ...request } = payload.input;
            if (typeof actorId !== "string" || !actorId || actorId.length > 200 || typeof environmentId !== "string" || typeof projectCwd !== "string" || sessionId !== source.id || source.cwd.startsWith("remote://") || !sameProjectPath(sessionWorkCwd(source), projectCwd)) throw new Error("SSH workspace source identity mismatch");
            const valid = () => {
              const current = sessionsRef.current.find((session) => session.id === source.id);
              return !!current && !current.inboxAsk && !current.orchestrationLeadId && !orchestrator.run(current.id) && sameProjectPath(current.cwd, source.cwd) && sameProjectPath(sessionWorkCwd(current), projectCwd) && !isProjectLockedIn(getGroupLockView().lock, current.cwd) && !isProjectLockedIn(getGroupLockView().lock, sessionWorkCwd(current));
            };
            if (!valid()) throw new Error("SSH workspace source is unavailable or private");
            const { handleSshMobileWorkspace } = await import("../../../features/connections/model/sshMobileWorkspaceControl");
            return handleSshMobileWorkspace({ actorId, environmentId, sourceSessionId: source.id, projectCwd: source.cwd, workingCwd: projectCwd, valid,
              authorize: async () => {
                if (!valid()) return false;
                try { return await invoke<boolean>("control_desktop_authorize_effect", { id: payload.id, action: payload.action }) && valid(); } catch { return false; }
              },
            }, payload.action, request);
          }
          if (["worktrees.removal.review", "worktrees.removal.approve", "worktrees.removal.status"].includes(payload.action)) {
            const { environmentId, projectCwd, sessionId, ...request } = payload.input;
            if (typeof environmentId !== "string" || typeof projectCwd !== "string" || sessionId !== source.id || source.cwd.startsWith("remote://") || !sameProjectPath(sessionWorkCwd(source), projectCwd))
              throw new Error("Worktree removal source identity mismatch");
            const { handleWorktreeRemoval } = await import("../../../features/source-control/model/worktreeRemovalControl");
            return handleWorktreeRemoval({ environmentId, sourceSessionId: source.id, projectCwd: source.cwd, workingCwd: projectCwd, valid: () => {
              const current = sessionsRef.current.find((session) => session.id === source.id);
              return !!current && !current.inboxAsk && !current.orchestrationLeadId && !orchestrator.run(current.id) && sameProjectPath(current.cwd, source.cwd) && sameProjectPath(sessionWorkCwd(current), projectCwd) && !isProjectLockedIn(getGroupLockView().lock, current.cwd) && !isProjectLockedIn(getGroupLockView().lock, sessionWorkCwd(current));
            } }, payload.action, request);
          }
          if (["historyImport.discover", "historyImport.commit", "historyImport.status", "historyImport.cancel"].includes(payload.action)) {
            const { environmentId, projectCwd, sessionId, ...request } = payload.input;
            if (typeof environmentId !== "string" || typeof projectCwd !== "string" || sessionId !== source.id || source.cwd.startsWith("remote://") || !sameProjectPath(sessionWorkCwd(source), projectCwd))
              throw new Error("History import source identity mismatch");
            const { handleHistoryImport } = await import("../../../features/sessions/import/historyImportControl");
            return handleHistoryImport({ environmentId, projectCwd, sourceSessionId: source.id, valid: () => {
              const current = sessionsRef.current.find((session) => session.id === source.id);
              return !!current && !current.inboxAsk && !current.orchestrationLeadId && !orchestrator.run(current.id) && sameProjectPath(sessionWorkCwd(current), projectCwd) && !isProjectLockedIn(getGroupLockView().lock, current.cwd) && !isProjectLockedIn(getGroupLockView().lock, sessionWorkCwd(current));
            } }, payload.action, request);
          }
          if (payload.action.startsWith("ptyMobile.")) {
            const { environmentId, projectCwd, sessionId, actorId, ...request } = payload.input;
            if (typeof environmentId !== "string" || typeof projectCwd !== "string" || typeof actorId !== "string" || !actorId || sessionId !== source.id || source.cwd.startsWith("remote://") || !sameProjectPath(sessionWorkCwd(source), projectCwd)) throw new Error("Mobile PTY source identity mismatch");
            const { handleMobilePty } = await import("../../../features/terminal/model/mobilePtyControl");
            return handleMobilePty({environmentId,sourceSessionId:source.id,projectCwd:source.cwd,workingCwd:projectCwd,actorId,authorize:()=>invoke<boolean>("control_desktop_authorize_effect",{id:payload.id,action:payload.action}),valid:()=>{
              const current=sessionsRef.current.find(session=>session.id===source.id);
              return !!current&&!current.inboxAsk&&!current.orchestrationLeadId&&!orchestrator.run(current.id)&&sameProjectPath(current.cwd,source.cwd)&&sameProjectPath(sessionWorkCwd(current),projectCwd)&&!isProjectLockedIn(getGroupLockView().lock,current.cwd)&&!isProjectLockedIn(getGroupLockView().lock,sessionWorkCwd(current));
            }},payload.action,request);
          }
          if (["preferences.read", "preferences.templateRead", "preferences.patch", "preferences.status"].includes(payload.action)) {
            const { environmentId, projectCwd, sessionId, ...request } = payload.input;
            if (typeof environmentId !== "string" || typeof projectCwd !== "string" || sessionId !== source.id || source.cwd.startsWith("remote://") || !sameProjectPath(sessionWorkCwd(source), projectCwd))
              throw new Error("Desktop preference source identity mismatch");
            const { handleDesktopPreferences } = await import("../../../features/sessions/model/desktopPreferencesControl");
            return handleDesktopPreferences({ environmentId, sourceSessionId: source.id, projectCwd: source.cwd, workingCwd: projectCwd, valid: () => {
              const current = sessionsRef.current.find((session) => session.id === source.id);
              return !!current && !current.inboxAsk && !current.orchestrationLeadId && !orchestrator.run(current.id) && sameProjectPath(current.cwd, source.cwd) && sameProjectPath(sessionWorkCwd(current), projectCwd) && !isProjectLockedIn(getGroupLockView().lock, current.cwd) && !isProjectLockedIn(getGroupLockView().lock, sessionWorkCwd(current));
            } }, payload.action, request);
          }
          if (["providerManagement.read", "providerManagement.patch", "providerManagement.status", "providerManagement.quotaRefresh"].includes(payload.action)) {
            const { environmentId, projectCwd, sessionId, ...request } = payload.input;
            if (typeof environmentId !== "string" || typeof projectCwd !== "string" || sessionId !== source.id || source.cwd.startsWith("remote://") || !sameProjectPath(sessionWorkCwd(source), projectCwd))
              throw new Error("Provider management source identity mismatch");
            const { readProviderManagement } = await import("../../../features/providers/model/providerManagementControl");
            const context = { environmentId, sourceSessionId: source.id, projectCwd: source.cwd, workingCwd: projectCwd, valid: () => {
              const current = sessionsRef.current.find((session) => session.id === source.id);
              return !!current && !current.inboxAsk && !current.orchestrationLeadId && !orchestrator.run(current.id) && sameProjectPath(current.cwd, source.cwd) && sameProjectPath(sessionWorkCwd(current), projectCwd) && !isProjectLockedIn(getGroupLockView().lock, current.cwd) && !isProjectLockedIn(getGroupLockView().lock, sessionWorkCwd(current));
            } };
            if (payload.action === "providerManagement.read") return readProviderManagement(context, request);
            const { handleProviderAccountControl } = await import("../../../features/providers/model/providerAccountControl");
            return handleProviderAccountControl(context, payload.action, request);
          }
          if (["organization.read", "organization.patch", "organization.status"].includes(payload.action)) {
            const { environmentId, projectCwd, sessionId, ...request } = payload.input;
            if (typeof environmentId !== "string" || typeof projectCwd !== "string" || sessionId !== source.id || source.cwd.startsWith("remote://") || !sameProjectPath(sessionWorkCwd(source), projectCwd))
              throw new Error("Organization source identity mismatch");
            const { handleProjectOrganization } = await import("../../../features/projects/model/projectOrganizationControl");
            return handleProjectOrganization({ environmentId, sourceSessionId: source.id, projectCwd: source.cwd, workingCwd: projectCwd, valid: () => {
              const current = sessionsRef.current.find((session) => session.id === source.id);
              return !!current && !current.inboxAsk && !current.orchestrationLeadId && !orchestrator.run(current.id) && sameProjectPath(current.cwd, source.cwd) && sameProjectPath(sessionWorkCwd(current), projectCwd) && !isProjectLockedIn(getGroupLockView().lock, current.cwd) && !isProjectLockedIn(getGroupLockView().lock, sessionWorkCwd(current));
            } }, payload.action, request);
          }
          if (
            payload.action.startsWith("ui.workspace.") ||
            payload.action === "terminals.create" ||
            payload.action === "terminals.interrupt" ||
            payload.action === "terminals.close"
          ) {
            const { requestAppUi } = await import("../../model/appUiControl");
            return requestAppUi(
              {
                cwd: source.cwd,
                sessionId: source.id,
                title: source.title,
                deadline: receivedAt + (payload.action === "terminals.close" ? 110000 : 12000),
              },
              payload.action,
              payload.input,
            );
          }
          const { requestToolsUi } = await import("../../../features/host-tools/toolsUiControl");
          return requestToolsUi(
            { cwd: source.cwd, sessionId: source.id, title: source.title },
            payload.action,
            payload.input,
          );
        }
        if (payload.namespace !== "app" && !conversationRead)
          throw new Error("Unknown CLI namespace");
        const source = sessionsRef.current.find((session) => session.id === payload.sessionId);
        if (!source || source.inboxAsk || source.orchestrationLeadId || orchestrator.run(source.id))
          throw new Error("This session cannot use the bycoda app CLI");
        if (
          (payload.action === "sessions.list" || payload.action === "sessions.read") &&
          isProjectLockedIn(getGroupLockView().lock, source.cwd)
        )
          throw new Error("Conversation project is locked.");
        const key = `${source.id}:${payload.requestId}`;
        const signature = JSON.stringify([payload.action, payload.input]);
        const previous = appReceipts.current.get(key);
        if (previous) {
          if (previous.signature !== signature)
            throw new Error("Request ID was already used with different input");
          return previous.promise;
        }
        const promise = handleAgentApp(source, payload.requestId, payload.action, payload.input, {
          start: async (launch, id, placement) => {
            const open = sessionsRef.current.find((session) => session.id === id);
            const stored = open ? null : await getSession(id);
            const existing = open ?? stored;
            const previous = existing?.blocks.find((block) => block.appRequestId === id);
            if (previous) {
              if (previous.text !== launch.prompt || (!launch.draft && !!previous.draft))
                throw new Error("Request ID was already used for another session launch");
              return;
            }
            if (existing?.blocks.some((block) => block.role === "user" && !block.draft)) return;
            if (existing && sessionDraftBlock(existing))
              throw new Error("Session ID already has a different draft");
            await launchQuickSessionRef.current(launch, id, placement);
          },
          sessions: async (cwd): Promise<AppSessionListing[]> => {
            const stored = await listSessionsByProject(cwd);
            const byId = new Map<string, AppSessionListing>();
            for (const session of stored) {
              if (session.orchestrationLeadId) continue;
              byId.set(session.id, {
                id: session.id,
                title: session.title,
                harness: session.harness,
                model: session.model,
                busy: false,
                hasDraft: !!session.draft,
              });
            }
            for (const session of sessionsRef.current) {
              if (session.orchestrationLeadId || !sameProjectPath(session.cwd, cwd)) continue;
              byId.set(session.id, {
                id: session.id,
                title: session.title,
                harness: session.harness,
                model: session.model,
                busy: !!session.busy,
                hasDraft: !!sessionDraftBlock(session),
              });
            }
            return [...byId.values()];
          },
          session: async (id) => {
            const target =
              sessionsRef.current.find((session) => session.id === id) ?? (await getSession(id));
            return target && !target.orchestrationLeadId && sameProjectPath(target.cwd, source.cwd)
              ? target
              : null;
          },
          send: async (id, prompt, requestId) => {
            const target = await ensureOpenSessionRef.current(id);
            if (
              !target ||
              target.orchestrationLeadId ||
              !sameProjectPath(target.cwd, source.cwd) ||
              orchestrator.run(id)
            )
              throw new Error("Session is unavailable in this project");
            const previous = target.blocks.find((block) => block.appRequestId === requestId);
            if (previous) {
              if (previous.text !== prompt)
                throw new Error("Request ID was already used with another prompt");
              if (previous.draft) throw new Error("Request ID belongs to an unsent draft");
              return { alreadySubmitted: true };
            }
            if (target.busy) throw new Error("Session is busy; try again when it finishes");
            if (sessionDraftBlock(target))
              throw new Error("Session already has a draft; send or remove it first");
            const accepted = await submitSessionRef.current(id, prompt, [], {
              appRequestId: requestId,
            });
            if (!accepted) throw new Error("Session could not accept the follow-up");
            return { alreadySubmitted: false };
          },
          draft: async (id, prompt, requestId) => {
            const target = await ensureOpenSessionRef.current(id);
            if (
              !target ||
              target.orchestrationLeadId ||
              !sameProjectPath(target.cwd, source.cwd) ||
              orchestrator.run(id)
            )
              throw new Error("Session is unavailable in this project");
            const previous = target.blocks.find((block) => block.appRequestId === requestId);
            if (previous) {
              if (previous.text !== prompt)
                throw new Error("Request ID was already used with another prompt");
              return { alreadySaved: true, draft: !!previous.draft };
            }
            if (target.busy) throw new Error("Session is busy; try again when it finishes");
            if (sessionDraftBlock(target))
              throw new Error("Session already has a draft; send or remove it first");
            const saved = flushSync(() => saveDraftRef.current(id, prompt, [], requestId));
            if (!saved) throw new Error("Session could not accept a draft");
            return { alreadySaved: false, draft: true };
          },
          worktrees: (cwd) => listWorktrees(cwd),
          createWorktree: (cwd, branch, base, existing) =>
            createWorktree(cwd, branch, base, existing),
          notes: () => invoke("notes_list"),
          note: (id) => invoke("notes_get", { id }),
          saveNote: async (note) => {
            const saved = await upsertNote(note);
            window.dispatchEvent(new Event(NOTES_CHANGED_EVENT));
            return saved;
          },
        });
        appReceipts.current.set(key, { signature, promise });
        void promise.catch(() => {
          if (appReceipts.current.get(key)?.promise === promise) appReceipts.current.delete(key);
        });
        if (appReceipts.current.size > 256) {
          const first = appReceipts.current.keys().next().value;
          if (first) appReceipts.current.delete(first);
        }
        return promise;
      };
      void handle()
        .then(
          (result) =>
            invoke("control_reply", {
              id: payload.id,
              response: { ok: true, result },
            }),
          (error: unknown) =>
            invoke("control_reply", {
              id: payload.id,
              response: {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              },
            }),
        )
        .catch(console.error);
    });
    return () => {
      void listening.then((unlisten) => unlisten());
    };
  }, []);
}
