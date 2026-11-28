/** Display labels for the Bycoda conversation server's actions, keyed `group.action`. */
export const BYCODA_ACTION_LABELS: Record<string, string> = {
  "models.list": "List models",
  "sessions.list": "List sessions",
  "sessions.read": "Read a session",
  "sessions.send": "Continue a session",
  "sessions.wait": "Wait for a session",
  "sessions.draft": "Save a draft",
  "sessions.start": "Start a session",
  "folders.list": "List folders",
  "folders.move": "Move a session",
  "notes.list": "List notes",
  "notes.read": "Read a note",
  "notes.write": "Write a note",
  "agents.options": "List delegate models",
  "agents.delegate": "Start a subagent",
  "agents.consult": "Ask the advisor",
  "agents.reply": "Continue a session",
  "agents.wait": "Wait for a subagent",
  "agents.cancel": "Cancel a subagent",
  "agents.list": "Subagents",
  "agents.send": "Send message",
};

/** Known MCP titles from the Bycoda conversation server. Keep other tool names intact. */
export function bycodaConversationLabel(title: string | undefined): string | undefined {
  const match = title?.match(/^bycoda-conversation:(?:conversation_)?agents[_.](\w+)$/);
  return match ? BYCODA_ACTION_LABELS[`agents.${match[1]}`] : undefined;
}
