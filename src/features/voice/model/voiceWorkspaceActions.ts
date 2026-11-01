/** Desktop-owned actions. These are deliberately separate from project agent grants. */
export type VoiceWorkspaceProject = { path: string; name?: string };

export type VoiceWorkspaceSession = {
  id: string;
  cwd: string;
  title: string;
  harness: string;
  model: string;
  busy?: boolean;
  historyLoading?: boolean;
  historyLoadError?: string;
  worktreeRemoved?: boolean;
  orchestrationLeadId?: string;
  inboxAsk?: unknown;
};

export type VoiceWorkspaceResult = {
  status: "completed" | "accepted" | "cancelled" | "rejected";
  action: string;
  sessionId?: string;
  projectPath?: string;
  error?: string;
  [key: string]: unknown;
};

export type VoiceSessionCreate = {
  projectPath: string;
  requestId: string;
  harness?: string;
  model?: string;
  prompt: string;
  /** Creating a session never submits work unless explicitly requested. */
  submit: boolean;
};

export type VoiceWorkspaceActionsDeps = {
  /** Supply only projects currently visible and unlocked for this owner/window. */
  getProjects: () => readonly VoiceWorkspaceProject[];
  getSessions: () => readonly VoiceWorkspaceSession[];
  getActiveSessionId: () => string | undefined;
  getProjectPath: () => string;
  resolveSession?: (id: string) => Promise<VoiceWorkspaceSession | null>;
  listSessions?: (projectPath: string) => Promise<readonly VoiceWorkspaceSession[]>;
  onSelectProject?: (path: string) => void | Promise<void>;
  onCreate?: (request: VoiceSessionCreate) => Promise<string>;
  onOpen?: (sessionId: string) => void | Promise<void>;
  /** Must delegate the existing close action, including dirty-file/terminal prompts. */
  onClose?: (sessionId: string) => void | boolean | Promise<void | boolean>;
  onRename?: (sessionId: string, title: string) => void | Promise<void>;
  onArchive?: (sessionId: string, archived: boolean) => boolean | Promise<boolean>;
  /** Must open the existing owner deletion flow; never wire the confirmed/Now variant. */
  onDelete?: (sessionId: string) => void | boolean | Promise<void | boolean>;
  onSubmit?: (sessionId: string, text: string) => boolean | Promise<boolean>;
  onStop?: (sessionId: string) => void | Promise<void>;
};

const text = { type: "string", minLength: 1, maxLength: 4096 };
const target = { sessionId: text, projectPath: text };
const mutation = { ...target, requestId: text };

export const voiceWorkspaceTools = [
  ["workspace.projects.list", "List currently visible, unlocked projects.", {}, []],
  [
    "workspace.projects.select",
    "Show a listed project in this workspace.",
    { projectPath: text, requestId: text },
    ["projectPath", "requestId"],
  ],
  [
    "workspace.sessions.list",
    "List loaded or stored sessions in a visible project. Returns bounded metadata, not transcript contents.",
    {
      projectPath: text,
      offset: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 100 },
    },
    ["projectPath"],
  ],
  [
    "workspace.sessions.create",
    "Create a session in a listed project. Set submit only when the user explicitly requests starting the supplied work.",
    {
      projectPath: text,
      requestId: text,
      harness: text,
      model: text,
      prompt: { type: "string", maxLength: 16000 },
      submit: { type: "boolean" },
    },
    ["projectPath", "requestId"],
  ],
  [
    "workspace.sessions.open",
    "Open or focus the exact session. Does not submit its draft.",
    mutation,
    ["sessionId", "projectPath", "requestId"],
  ],
  [
    "workspace.sessions.close",
    "Request closing the exact session through the existing workspace close flow. Acceptance is not verified closure.",
    mutation,
    ["sessionId", "projectPath", "requestId"],
  ],
  [
    "workspace.sessions.rename",
    "Rename the exact session without changing its contents.",
    { ...mutation, title: { type: "string", minLength: 1, maxLength: 200 } },
    ["sessionId", "projectPath", "requestId", "title"],
  ],
  [
    "workspace.sessions.archive",
    "Archive or restore the exact session through the existing lifecycle, preserving its safeguards.",
    { ...mutation, archived: { type: "boolean" } },
    ["sessionId", "projectPath", "requestId", "archived"],
  ],
  [
    "workspace.sessions.delete",
    "Request the existing owner-confirmed deletion flow for one exact session. A request is not completed deletion.",
    mutation,
    ["sessionId", "projectPath", "requestId"],
  ],
  [
    "workspace.sessions.submit",
    "Submit the user's exact requested work to an explicit session; acceptance is not completion.",
    { ...mutation, text: { type: "string", minLength: 1, maxLength: 16000 } },
    ["sessionId", "projectPath", "requestId", "text"],
  ],
  [
    "workspace.sessions.stop",
    "Request stopping work in one exact session only on the user's explicit request. Silencing voice is a separate action.",
    mutation,
    ["sessionId", "projectPath", "requestId"],
  ],
].map(([name, description, properties, required]) => ({
  type: "function" as const,
  name: name as string,
  description: description as string,
  parameters: {
    type: "object",
    properties: properties as Record<string, unknown>,
    required: required as string[],
    additionalProperties: false,
  },
}));
