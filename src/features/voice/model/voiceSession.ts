import type { Session } from "../../sessions/model/session";

export function voiceTarget(
  activeId: string | undefined,
  pinnedId: string | null,
  sessions: Session[],
) {
  return sessions.find((session) => session.id === (pinnedId ?? activeId));
}

export function voiceContext(session: Session) {
  const redact = (text: string) =>
    text
      .replace(/\b(?:sk-|xai-)[\w-]{12,}/g, "[redacted]")
      .replace(/\b(Bearer\s+)\S+/gi, "$1[redacted]")
      .replace(/\b(password|token|api[_-]?key|secret)\s*[:=]\s*\S+/gi, "$1=[redacted]");
  return {
    title: redact(session.title),
    busy: Boolean(session.busy),
    historyLoading: Boolean(session.historyLoading || session.historyPartial),
    queued: session.queuedMessages?.length ?? 0,
    pendingApprovals: session.blocks.filter(
      (block) => block.role === "approval" && block.approval && !block.approval.decided,
    ).length,
    messages: session.blocks
      .filter((block) => block.role === "user" || block.role === "assistant")
      .slice(-8)
      .map((block) => ({ role: block.role, text: redact(block.text.slice(-1200)) })),
  };
}

export function clampVoicePosition(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  return {
    x: Math.max(8, Math.min(x, viewportWidth - width - 8)),
    y: Math.max(8, Math.min(y, viewportHeight - height - 8)),
  };
}
