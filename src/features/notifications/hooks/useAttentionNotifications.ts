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
import { attentionRulesFor, subscribeAttentionRules } from "../model/attentionRules";
import {
  announceBackgroundFinish,
  announceSessionIssue,
  isWindowFocused,
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
  // The native call failed, so the next sync must resend even an unchanged count.
  const nativeRetry = useRef(false);
  const nativeSeq = useRef(0);

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
    const next = taskbarAttention(
      sessions,
      unseenAttentionSessions(),
      activeSessionId,
      focused,
      attentionRulesFor("taskbar"),
    );
    const flash = flashFor(shownCount.current, next, focused);
    if (next.count === shownCount.current && flash === "none" && !nativeRetry.current) return;
    const previousCount = shownCount.current;
    const seq = ++nativeSeq.current;
    shownCount.current = next.count;
    nativeRetry.current = false;
    void invoke("set_taskbar_attention", { count: next.count, flash }).catch(() => {
      // Only the latest call may roll back; an older failure is already superseded.
      if (seq !== nativeSeq.current) return;
      shownCount.current = previousCount;
      nativeRetry.current = true;
    });
  });
  useEffect(() => {
    syncAttention();
  }, [sessions, activeSessionId]);
  useEffect(() => {
    // Badge, event and project preferences (including mute expiry) change what
    // the taskbar may show without any session changing.
    const sync = () => syncAttention();
    const unsubscribe = [subscribeAttention(sync), subscribeAttentionRules(sync)];
    return () => unsubscribe.forEach((off) => off());
  }, []);
}
