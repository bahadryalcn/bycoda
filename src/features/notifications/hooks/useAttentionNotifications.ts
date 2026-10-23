import { invoke } from "@tauri-apps/api/core";
import { useEffect, useEffectEvent, useRef } from "react";
import { sessionIssue } from "../../sessions/model/sessionIssue";
import type { Session } from "../../sessions/model/session";
import {
  enteredBackgroundFinish,
  flashFor,
  pruneUnseen,
  sessionPhase,
  taskbarAttention,
  type SessionPhase,
} from "../model/attention";
import { loadNotificationEvents } from "../model/notificationEvents";
import { allowsProjectNotificationIndicator } from "../model/notificationPreferences";
import { knownNotificationProject } from "../model/notificationProjects";
import {
  announceBackgroundFinish,
  announceSessionIssue,
  isWindowFocused,
  loadNotificationsEnabled,
  replaceUnseenAttention,
  subscribeAttention,
  unseenAttentionSessions,
} from "../model/notifications";

/**
 * Two things the turn-end hook in App cannot see:
 * - an agent that finished while background commands keep the turn open, and
 * - the taskbar badge/flash for sessions that want the user.
 */
export function useAttentionNotifications(
  sessions: Session[],
  activeSessionId: string | undefined,
) {
  const phases = useRef(new Map<string, SessionPhase>());
  const shownCount = useRef(0);

  useEffect(() => {
    const previous = phases.current;
    const next = new Map<string, SessionPhase>();
    for (const session of sessions) {
      const issue = sessionIssue(session);
      if (issue) void announceSessionIssue(session, issue, session.id === activeSessionId);
      const phase = sessionPhase(session);
      next.set(session.id, phase);
      if (
        !issue &&
        previous.has(session.id) &&
        enteredBackgroundFinish(previous.get(session.id), phase)
      ) {
        void announceBackgroundFinish(session, session.id === activeSessionId);
      }
    }
    phases.current = next;
  }, [sessions, activeSessionId]);

  const syncAttention = useEffectEvent(() => {
    const focused = isWindowFocused();
    replaceUnseenAttention(
      pruneUnseen(unseenAttentionSessions(), sessions, activeSessionId, focused),
    );
    const events = loadNotificationEvents();
    const next =
      loadNotificationsEnabled() && events.taskbar
        ? taskbarAttention(
            sessions,
            unseenAttentionSessions(),
            activeSessionId,
            focused,
            (session) => {
              const project = knownNotificationProject(session.cwd);
              return (
                !!project &&
                events.input &&
                allowsProjectNotificationIndicator({
                  projectId: project.id,
                  category: "agentInput",
                })
              );
            },
          )
        : { count: 0, hasInput: false };
    const flash = flashFor(shownCount.current, next, focused);
    if (next.count === shownCount.current && flash === "none") return;
    shownCount.current = next.count;
    void invoke("set_taskbar_attention", { count: next.count, flash }).catch(() => {});
  });
  useEffect(() => {
    syncAttention();
  }, [sessions, activeSessionId]);
  useEffect(() => subscribeAttention(() => syncAttention()), []);
}
