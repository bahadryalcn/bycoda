import { useState } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import type { SessionPanelTarget } from "../../../features/sessions/public/SessionPanelTargets";
import { isRemoteProjectPath } from "../../../features/projects/public/recents";
import {
  createRoomSession,
  getSession,
  isSessionDeleted,
} from "../../../features/sessions/data/sessionStore";
import { newDefaultSession } from "../../../features/sessions/model/session";
import { getSessions, setSessions } from "../../../features/sessions/model/sessionsStore";
import {
  openPanelSession,
  type PanelSessionPortal,
  type PanelSessionScope,
} from "../../../features/sessions/model/scopedPanelSession";

const remembered = new Map<string, string>();
const preferenceKey = (key: string) => `bycoda.session-panel.v1:${key}`;
const socialContext = (target: PanelSessionScope) =>
  `This conversation manages Social Media. Use the existing bycoda-social tools for social operations and their account-bound live view. Account grants, sending approvals, autonomy, limits and global stops remain authoritative. This context grants no additional access. Selected workspace: ${JSON.stringify({ scope: target.key, cwd: target.cwd })}`;

/** App adapter for real Social conversations. Existing session dispatch and tool grants stay authoritative. */
export function useSocialSessionPanel() {
  const [portal, setPortal] = useState<PanelSessionPortal | null>(null);
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  const [workspaceTargets, setWorkspaceTargets] = useState<Record<string, SessionPanelTarget>>({});
  const registerTarget = useStableCallback((target: SessionPanelTarget) => {
    setWorkspaceTargets((current) => ({ ...current, [target.sessionId]: target }));
    return () =>
      setWorkspaceTargets((current) => {
        if (current[target.sessionId] !== target) return current;
        const next = { ...current };
        delete next[target.sessionId];
        return next;
      });
  });
  const open = useStableCallback(async (scope: PanelSessionScope) => {
    const id = await openPanelSession(scope, {
      read: (key) => {
        if (remembered.has(key)) return remembered.get(key)!;
        try {
          return localStorage.getItem(preferenceKey(key));
        } catch {
          return null;
        }
      },
      write: (key, sessionId) => {
        remembered.set(key, sessionId);
        try {
          localStorage.setItem(preferenceKey(key), sessionId);
        } catch {
          /* The current window still retains the session. */
        }
      },
      find: (sessionId) => getSessions().find((session) => session.id === sessionId),
      load: async (id) => {
        const stored = await getSession(id);
        if (stored || !isRemoteProjectPath(scope.cwd) || isSessionDeleted(id)) return stored;
        // Before the first remote turn there is no Host record. Keep its scoped shell ID so its composer draft survives even without a workspace tab.
        return { ...newDefaultSession(scope.cwd), id, title: scope.title };
      },
      create: async (target) => {
        const session = {
          ...newDefaultSession(target.cwd),
          title: target.title,
        };
        // Local empty creation forbids replay context; attach adds it after persistence. Remote execution persists on the owning Host after its first turn.
        if (!isRemoteProjectPath(target.cwd)) await createRoomSession(session);
        return session;
      },
      attach: (session) =>
        setSessions((current) => {
          const existing = current.find((entry) => entry.id === session.id);
          const active = existing ?? session;
          // Empty remote shells restored from a workspace snapshot have no pending context yet.
          const next =
            active.blocks.length || active.pendingContextReplay
              ? active
              : { ...active, pendingContextReplay: socialContext(scope) };
          return existing
            ? next === existing
              ? current
              : current.map((entry) => (entry.id === next.id ? next : entry))
            : [...current, next];
        }),
    });
    setSessionIds((current) => (current.includes(id) ? current : [...current, id]));
    return id;
  });
  return { portal, setPortal, sessionIds, open, workspaceTargets, registerTarget };
}
