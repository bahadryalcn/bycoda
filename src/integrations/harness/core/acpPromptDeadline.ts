/**
 * Response deadline for an ACP `session/prompt` turn: none. A turn is a whole
 * agentic run that may wait on tool calls and owner approvals for any length of
 * time, so a wall-clock cap would fail work that is still streaming. Silence is
 * handled by the registry inactivity watchdog, Stop by `rejectPending`, and a
 * dead process by `close`. Every ACP adapter passes this to its turn
 * `session/prompt`; a mid-turn steer keeps its own bounded control deadline.
 */
export const ACP_PROMPT_TIMEOUT_MS = 0;
