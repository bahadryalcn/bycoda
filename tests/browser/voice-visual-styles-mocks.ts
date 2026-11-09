// Synthetic transport for the voice fixture. No device, Host, provider or audio access.
export const fixtureVoice = {
  callbacks: null as any,
  connects: 0,
  speakerMuted: false,
  audioLevel: { current: 0 },
  finishTool: null as null | ((value: unknown) => void),
  pushToTalkStarts: 0,
  pushToTalkEnds: 0,
  closes: 0,
  submits: 0,
  stops: 0,
  actions: [] as string[],
  observations: [] as unknown[],
  ownerRequests: [] as { input: any; expectedEnvironmentId?: string }[],
  captureHostRead: captureAssistantHostRead,
  transcripts: [] as unknown[],
  remoteTranscripts: [] as any[],
  remoteAttempts: [] as any[],
  remoteAvailable: true,
  remoteAckLost: false,
  jobs: [] as any[],
  finishes: 0,
  turnPolicies: [] as unknown[],
  ruleAckLost: new URLSearchParams(location.search).has("rule-ack-lost"),
  memories: [] as any[],
  projectLists: 0,
  speech(text: string) {
    const onset = this.callbacks.start();
    if (this.callbacks.interceptTranscript?.({ text }, onset)) return;
    const binding = this.callbacks.accept?.(onset) ?? onset;
    this.callbacks.transcript({ text }, binding);
  },
};
export class LocalVoice {
  async retire() {}
  readonly level = { current: 0.55 };
  constructor(callbacks: any, _language?: string, _config?: unknown, level = this.level) {
    this.level = level;
    fixtureVoice.audioLevel = level;
    this.level.current = 0.55;
    fixtureVoice.callbacks = callbacks;
  }
  async connect() {
    fixtureVoice.connects++;
    if (new URLSearchParams(location.search).get("state") === "connecting")
      await new Promise(() => {});
  }
  close() {
    fixtureVoice.closes++;
  }
  speak(_text: string, _append?: boolean, delivered?: () => void) {
    delivered?.();
    return true;
  }
  mute(value: boolean) {
    this.level.current = value ? 0 : 0.55;
  }
  beginPushToTalk() {
    fixtureVoice.pushToTalkStarts++;
    this.level.current = 0.55;
    return true;
  }
  endPushToTalk() {
    fixtureVoice.pushToTalkEnds++;
    this.level.current = 0;
  }
  setOutputMuted(value: boolean) {
    fixtureVoice.speakerMuted = value;
  }
  finishTurn() {
    fixtureVoice.finishes++;
  }
  configureConversation(options: unknown) {
    fixtureVoice.turnPolicies.push(options);
  }
  silence() {
    fixtureVoice.callbacks?.playback(false);
  }
}
export const sessionsRef = { current: [] };
export const getSessions = () => sessionsRef.current;
export const subscribeSessionCommits = () => () => {};
export const useSession = () => undefined;
export const converseWithSession = () =>
  new URLSearchParams(location.search).has("remote")
    ? Promise.resolve({ action: "reply", reply: "Here is the remote status." })
    : new Promise(() => {});
export const warmVoiceReply = async () => {};
export const immediateVoiceDecision = () => undefined;
export function captureVoiceHistorySession(session: any, path: string, global = false) {
  return session && path.startsWith("remote://") && !global ? "remote-fixture-session" : undefined;
}
export function captureLocalVoiceHistory() {
  return {
    key: "fixture-local",
    remote: false,
    environmentId: async () => "fixture-host",
    request: assistantRequest,
  };
}
export function captureRemoteVoiceHistory(path: string) {
  const request = async (input: any): Promise<any> => {
    if (!fixtureVoice.remoteAvailable) throw new Error("Synthetic remote offline");
    if (input.op === "projects.list")
      return { projects: [{ id: "remote-fixture-project", path, name: "Remote project" }] };
    if (input.op === "threads.open")
      return {
        thread: {
          id: "remote-fixture-thread",
          projectId: "remote-fixture-project",
          summary: "Prior discussion on the remote Host.",
        },
      };
    if (input.op === "threads.messages") return { messages: [] };
    if (input.op === "threads.append") {
      fixtureVoice.remoteAttempts.push(structuredClone(input));
      if (
        !fixtureVoice.remoteTranscripts.some(
          (message) => message.idempotencyKey === input.idempotencyKey,
        )
      )
        fixtureVoice.remoteTranscripts.push(structuredClone(input));
      if (fixtureVoice.remoteAckLost) {
        fixtureVoice.remoteAckLost = false;
        throw new Error("Synthetic remote acknowledgement lost");
      }
      return { message: { id: input.idempotencyKey, threadId: input.threadId } };
    }
    throw new Error("Unexpected remote fixture history operation");
  };
  return { key: `remote-fixture:${path}`, remote: true, request };
}
/** Only the focused global-voice fixture aliases this assistant transport. */
export async function converseWithAssistant(input: {
  transcript: string;
  execute: (name: string, args: Record<string, unknown>) => Promise<any>;
}) {
  if (input.transcript === "give jobs") {
    const result = await input.execute("give_jobs", {
      jobs: [
        {
          title: "Review recovery",
          request: "Review session recovery and report remaining failures.",
          projectPath: "/fixture",
        },
        {
          title: "Improve the help page",
          request: "Make the help page easier to scan.",
          projectPath: "/fixture",
        },
      ],
    });
    fixtureVoice.observations.push(result);
    return { action: "reply", reply: "The reviewed jobs were accepted." };
  }
  if (input.transcript === "delete recovery job") {
    const result = await input.execute("assistant_job_control", {
      id: "control-job",
      expectedVersion: 1,
      action: "delete",
    });
    fixtureVoice.observations.push(result);
    return { action: "reply", reply: "The selected assistant job was deleted." };
  }
  if (input.transcript === "show choices") {
    const selected = await input.execute("present_choices", {
      question: "Which project should I follow?",
      options: [
        { id: "upstream", label: "upstream", description: "Desktop and Host work" },
        { id: "clinic", label: "Clinic", description: "Customer portal tasks" },
      ],
      kind: "disambiguation",
    });
    fixtureVoice.observations.push(selected);
    return { action: "reply", reply: "Your project choice has been recorded." };
  }
  if (input.transcript === "read draft") {
    const draft = await input.execute("composer_context", { sessionId: "fixture" });
    fixtureVoice.observations.push(draft);
    return { action: "reply", reply: `Unsent draft: ${draft.text}` };
  }
  if (input.transcript === "read file") {
    const file = await input.execute("composer_attachment", {
      sessionId: "fixture",
      attachmentId: "fixture-text",
    });
    fixtureVoice.observations.push(file);
    return { action: "reply", reply: `Attached text: ${file.text}` };
  }
  const result = await input.execute("app_tool_call", {
    family: "workspace",
    action: "workspace.projects.list",
    input: {},
    requestId: new URLSearchParams(location.search).has("navigation")
      ? `fixture-project-list-${fixtureVoice.projectLists++}`
      : "fixture-project-list",
  });
  fixtureVoice.observations.push(result);
  return { action: "reply", reply: "The fixture project is available." };
}
export const voiceModelSettings = () => ({});
export async function discoverVoiceTools() {
  throw new Error("This fixture does not connect to a Host.");
}
export async function callVoiceTool() {
  throw new Error("This fixture does not execute Host tools.");
}
export const localVoiceBackend = {
  inspect: async () => ({
    ready: true,
    missing: [],
    python: "/fixture/python",
    whisperPath: "/fixture/whisper",
    ttsPath: "/fixture/tts",
  }),
  setupStatus: async () => ({ state: "idle" }),
  cloudStatus: async () => ({ elevenlabs: false }),
};

export const fixtureAssistant = {
  profile: {
    name: "Arif",
    showTitle: true,
    setupComplete: true,
    voiceSetupComplete: true,
    language: "auto",
    addressAs: "",
    proactiveSpeech: "never",
    quietStart: 22,
    quietEnd: 8,
  },
  memory: fixtureVoice.memories,
  notes: [],
  presence: { state: "present" },
  briefing: null,
};
if (new URLSearchParams(location.search).has("availability-away"))
  fixtureAssistant.presence.state = "away";
// Job review before starting is opt-in through the profile; scenarios ask with ?confirm-jobs.
if (new URLSearchParams(location.search).has("confirm-jobs"))
  Object.assign(fixtureAssistant.profile, { confirmJobs: true });
export const useAssistantSnapshot = () => ({
  snapshot: fixtureAssistant,
  error: "",
  loading: false,
  refresh: async () => {},
});
export const assistantIdentity = () => ({
  title: "Assistant Arif",
  name: "Arif",
  setupComplete: true,
  voiceSetupComplete: true,
});
export async function captureAssistantHostRead(expectedEnvironmentId?: string) {
  const environmentId = "fixture-host";
  if (expectedEnvironmentId && expectedEnvironmentId !== environmentId)
    throw new Error("Synthetic captured Host changed");
  const unavailable = async () => {
    throw new Error("This fixture does not provide that Host metadata read.");
  };
  return Object.freeze({
    environmentId,
    goals: unavailable,
    automations: unavailable,
    session: unavailable,
    projects: async () => (await assistantRequest({ op: "projects.list" }, environmentId)).projects,
    snapshot: async () =>
      (await assistantRequest({ op: "snapshot", limit: 100 }, environmentId)).snapshot,
  });
}
// Finite synthetic storage for the navigation fixture. The production transcript
// and causal-context validators consume these exact receipts without bypasses.
const navigationThreads = new Map<string, any>(),
  navigationMessages = new Map<string, { input: string; message: any }>(),
  navigationContexts = new Map<string, any>();
function navigationHistoryRequest(input: any): any | undefined {
  const now = Date.now();
  const knownProjects = ["fixture-project", "fixture-next-project"];
  if (input.op === "threads.open") {
    if (input.projectId && !knownProjects.includes(input.projectId))
      throw new Error("Unknown synthetic project");
    const id = `fixture-thread-${input.projectId ?? "global"}`;
    if (!navigationThreads.has(id))
      navigationThreads.set(id, {
        id,
        version: 1,
        title: "Voice",
        projectId: input.projectId ?? null,
        summary: "",
        createdAt: now,
        updatedAt: now,
      });
    return {
      thread: structuredClone(navigationThreads.get(id)),
      messages: [...navigationMessages.values()]
        .map((entry) => entry.message)
        .filter((message) => message.threadId === id),
    };
  }
  if (input.op === "threads.messages") {
    const thread = navigationThreads.get(input.threadId);
    if (!thread) throw new Error("Unknown synthetic thread");
    return {
      thread: structuredClone(thread),
      messages: [...navigationMessages.values()]
        .map((entry) => structuredClone(entry.message))
        .filter((message) => message.threadId === input.threadId)
        .slice(-input.limit),
    };
  }
  if (input.op === "threads.append") {
    const thread = navigationThreads.get(input.threadId);
    if (!thread) throw new Error("Unknown synthetic thread");
    const encoded = JSON.stringify(input),
      existing = navigationMessages.get(input.idempotencyKey);
    if (existing) {
      if (existing.input !== encoded) throw new Error("Synthetic transcript retry changed");
      return { message: structuredClone(existing.message) };
    }
    const causal = input.causalContextId
      ? navigationContexts.get(input.causalContextId)
      : undefined;
    const scope =
      input.role === "user"
        ? thread.projectId
          ? [thread.projectId]
          : []
        : causal?.status === "known"
          ? causal.projectIds
          : undefined;
    const message = {
      id: input.idempotencyKey,
      version: 1,
      threadId: input.threadId,
      role: input.role,
      via: input.via,
      text: input.text,
      jobIds: input.jobIds ?? [],
      createdAt: now,
      updatedAt: now,
      ...(scope ? { projectIds: scope } : {}),
    };
    navigationMessages.set(input.idempotencyKey, { input: encoded, message });
    fixtureVoice.transcripts.push(input);
    return { message: structuredClone(message) };
  }
  if (input.op === "voice.context.open") {
    const previous = navigationContexts.get(input.previousContextId),
      owner = [...navigationMessages.values()]
        .map((entry) => entry.message)
        .find((message) => message.id === input.ownerMessageId);
    if (
      !owner ||
      owner.threadId !== input.threadId ||
      owner.role !== "user" ||
      input.contextProjectIds.some((id: string) => !knownProjects.includes(id))
    )
      throw new Error("Synthetic voice source changed");
    const id = `context-${input.requestId}`,
      existing = navigationContexts.get(id);
    if (existing) return { voiceContext: structuredClone(existing) };
    const unknown = previous?.status === "unknown";
    const context = {
      id,
      version: 1,
      environmentId: "fixture-host",
      threadId: input.threadId,
      generationKey: input.generationKey,
      ownerMessageId: input.ownerMessageId,
      status: unknown ? "unknown" : "known",
      ...(unknown ? {} : { projectIds: input.contextProjectIds }),
      createdAt: now,
      updatedAt: now,
    };
    navigationContexts.set(id, context);
    return { voiceContext: structuredClone(context) };
  }
  if (input.op === "voice.context.invalidate") {
    const current = navigationContexts.get(input.id);
    if (!current) throw new Error("Unknown synthetic voice context");
    const context = {
      ...current,
      status: "unknown",
      reason: input.reason,
      version: current.version + 1,
      updatedAt: now,
    };
    delete context.projectIds;
    navigationContexts.set(input.id, context);
    return { voiceContext: structuredClone(context) };
  }
}
export async function assistantRequest(input: any, expectedEnvironmentId?: string): Promise<any> {
  if (expectedEnvironmentId && expectedEnvironmentId !== "fixture-host")
    throw new Error("Synthetic captured Host changed");
  fixtureVoice.ownerRequests.push({ input: structuredClone(input), expectedEnvironmentId });
  if (new URLSearchParams(location.search).has("navigation")) {
    const result = navigationHistoryRequest(input);
    if (result !== undefined) return result;
  }
  if (input.op === "snapshot")
    return { snapshot: { ...fixtureAssistant, jobs: fixtureVoice.jobs } };
  if (input.op === "projects.list")
    return {
      projects: [
        { id: "fixture-project", path: "/fixture", name: "Fixture project" },
        ...(new URLSearchParams(location.search).has("navigation")
          ? [{ id: "fixture-next-project", path: "/fixture-next", name: "Second fixture project" }]
          : []),
      ],
    };
  if (input.op === "threads.open") return { thread: { id: "fixture-thread", summary: "" } };
  if (input.op === "threads.messages") return { messages: [] };
  if (input.op === "threads.append") {
    fixtureVoice.transcripts.push(input);
    return { message: { id: input.idempotencyKey } };
  }
  if (input.op === "jobs.create") {
    const job = { ...input, id: input.idempotencyKey, status: "queued", version: 1 };
    fixtureVoice.jobs.push(job);
    return { job };
  }
  if (input.op === "jobs.control") {
    const job = fixtureVoice.jobs.find((job) => job.id === input.id);
    if (!job || job.version !== input.expectedVersion) throw new Error("Synthetic changed job");
    fixtureVoice.actions.push(`assistant.${input.action}`);
    job.version++;
    job.status = "cancelled";
    return { job };
  }
  if (input.op === "profile.get") return { profile: fixtureAssistant.profile };
  if (input.op === "memory.search") return { entries: fixtureVoice.memories };
  if (input.op === "memory.save") {
    const memory = { ...input, id: "owner-rule", version: 1, createdAt: 1, updatedAt: 1 };
    fixtureVoice.memories.push(memory);
    if (fixtureVoice.ruleAckLost) throw new Error("Synthetic lost acknowledgement");
    return { memory };
  }
  if (
    input.op === "voice.language.record" ||
    input.op === "voice.runtime.register" ||
    input.op === "pauseAll"
  )
    return { ok: true };
  throw new Error(`This fixture does not mutate assistant state (${String(input.op)}).`);
}
