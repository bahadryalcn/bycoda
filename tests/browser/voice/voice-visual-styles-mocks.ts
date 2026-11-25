// Synthetic transport for the voice fixture. No device, Host, provider or audio access.
import {
  AssistantOwnerQuestionAnswerSchema,
  AssistantOwnerQuestionPresentSchema,
  AssistantOwnerQuestionSchema,
  type AssistantOwnerQuestion,
  type AssistantOwnerQuestionReceipt,
} from "../../../src/shared/model/assistantOwnerQuestions";

const ownerQuestions = new Map<string, AssistantOwnerQuestion>();

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
export const useSessionsSelector = <T>(select: (sessions: typeof sessionsRef.current) => T): T =>
  select(sessionsRef.current);
export const getShellSessions = () => sessionsRef.current;
export const useShellSessionsSelector = <T>(
  select: (sessions: typeof sessionsRef.current) => T,
): T => select(sessionsRef.current);
export const selectSessionById = (sessions: readonly { id: string }[], id: string | undefined) =>
  id === undefined ? undefined : sessions.find((session) => session.id === id);
export const subscribeSessionCommits = () => () => {};
export const useSession = () => undefined;
export * from "../../../src/features/sessions/model/sessionsStore.ts";
export * from "../../../src/features/assistant/model/assistantClient.ts";
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
    environmentId: new URLSearchParams(location.search).has("local-choice")
      ? undefined
      : async () => "fixture-host",
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
      return { message: fixtureTranscriptReceipt(input) };
    }
    throw new Error("Unexpected remote fixture history operation");
  };
  return { key: `remote-fixture:${path}`, remote: true, request };
}
function fixtureTranscriptReceipt(input: {
  idempotencyKey: string;
  threadId: string;
  role: string;
  via: string;
  text: string;
}) {
  return {
    id: input.idempotencyKey,
    threadId: input.threadId,
    role: input.role,
    via: input.via,
    text: input.text,
  };
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
  if (
    input.transcript === "Show this month's usage." ||
    input.transcript === "Show the last 30 days of usage."
  ) {
    const result = await input.execute("app_tool_call", {
      family: "workspace",
      action: "workspace.usage.report",
      input: {
        period: input.transcript.startsWith("Show this") ? "month-to-date" : "last-30-days",
        metric: "cost",
      },
      requestId: input.transcript.startsWith("Show this")
        ? "fixture-usage-month"
        : "fixture-usage-empty",
    });
    fixtureVoice.observations.push(result);
    return { action: "reply", reply: "The usage report is ready." };
  }
  if (
    input.transcript === "Open the second project's session beside Arif." ||
    input.transcript === "Open the second project's session in the project workspace."
  ) {
    const surface = input.transcript.endsWith("beside Arif.") ? "voice" : "project";
    const result = await input.execute("app_tool_call", {
      family: "workspace",
      action: "workspace.sessions.open",
      input: { projectPath: "/fixture-next", sessionId: "fixture-next", surface },
      requestId: `fixture-explicit-project-session-${surface}`,
    });
    fixtureVoice.observations.push(result);
    return { action: "reply", reply: "The second project's session is open." };
  }
  const presentInFullScreen = input.transcript === "show live results full screen";
  const view = presentInFullScreen
    ? "fullscreen"
    : /^switch voice view to (fullscreen|window|mini)$/.exec(input.transcript)?.[1];
  if (view) {
    const result = await input.execute("app_tool_call", {
      family: "workspace",
      action: "workspace.voice.set_view",
      input: { mode: view },
      requestId: `fixture-view-${view}`,
    });
    fixtureVoice.observations.push(result);
    if (!presentInFullScreen) return { action: "reply", reply: "The view has changed." };
  }
  if (presentInFullScreen || input.transcript === "show live results") {
    const result = await input.execute("app_tool_call", {
      family: "workspace",
      action: "workspace.live_work.present",
      input: {
        title: "Test results",
        summary: "Two packages finished.",
        content: {
          kind: "chart",
          items: [
            { label: "Web", value: 5 },
            { label: "Host", value: 3 },
          ],
        },
      },
      requestId: "fixture-live-results",
    });
    fixtureVoice.observations.push(result);
    return { action: "reply", reply: "Two packages finished." };
  }
  if (input.transcript === "show usage form") {
    // Composed from shared controls; the button reads the owner's choices through `$bind`.
    const result = await input.execute("app_tool_call", {
      family: "workspace",
      action: "workspace.live_work.present",
      input: {
        title: "Usage report",
        summary: "Pick what to read, then press the button.",
        blocks: [
          {
            type: "Card",
            title: "Report",
            children: [
              {
                type: "Stack",
                direction: "row",
                children: [
                  {
                    type: "Select",
                    id: "period",
                    label: "Period",
                    options: [
                      { value: "month-to-date", label: "This month" },
                      { value: "last-30-days", label: "Last 30 days" },
                    ],
                  },
                  {
                    type: "SegmentedControl",
                    id: "metric",
                    label: "Metric",
                    options: [
                      { value: "cost", label: "Cost" },
                      { value: "tokens", label: "Tokens" },
                    ],
                  },
                ],
              },
              { type: "TextField", id: "note", label: "Note", placeholder: "Optional" },
              {
                type: "Button",
                label: "Read usage",
                variant: "primary",
                requires: ["period"],
                action: {
                  action: "workspace.usage.report",
                  input: { period: { $bind: "period" }, metric: { $bind: "metric" } },
                },
              },
            ],
          },
          { type: "DescriptionList", items: [{ label: "Source", value: "Usage dashboard" }] },
        ],
      },
      requestId: "fixture-usage-form",
    });
    fixtureVoice.observations.push(result);
    return { action: "reply", reply: "The form is on screen." };
  }
  if (input.transcript === "prepare project session") {
    await input.execute("app_tool_call", {
      family: "workspace",
      action: "workspace.live_work.present",
      requestId: "fixture-session-form",
      input: {
        title: "Session draft",
        summary: "Choose project and draft.",
        blocks: [
          {
            type: "Select",
            id: "project",
            label: "Destination",
            options: [
              { label: "Current", value: "/fixture" },
              { label: "Bycoda", value: "/fixture-next" },
            ],
          },
          { type: "TextareaField", id: "draft", label: "Draft text" },
          {
            type: "Button",
            label: "Create session",
            requires: ["project", "draft"],
            action: {
              action: "workspace.sessions.create",
              input: {
                projectPath: { $bind: "project" },
                prompt: { $bind: "draft" },
                submit: false,
                harness: "codex",
              },
            },
          },
        ],
      },
    });
    return { action: "reply", reply: "Choose the destination." };
  }
  if (input.transcript === "show composed report") {
    const result = await input.execute("app_tool_call", {
      family: "workspace",
      action: "workspace.live_work.present",
      input: {
        title: "Release report",
        summary: "Everything composed from the shared catalog.",
        blocks: [
          { type: "Alert", tone: "warning", title: "One check failed", text: "Lint needs a look." },
          {
            type: "Grid",
            columns: 2,
            children: [
              {
                type: "Card",
                title: "Totals",
                children: [
                  {
                    type: "StatRow",
                    label: "Tests",
                    items: [
                      { label: "Passed", value: "41" },
                      { label: "Failed", value: "1" },
                    ],
                  },
                  { type: "Progress", value: 41, max: 42, label: "Passing" },
                  { type: "StatusText", tone: "failed", text: "Lint failed" },
                ],
              },
              {
                type: "Card",
                title: "Share",
                children: [
                  {
                    type: "DonutChart",
                    label: "Tests by package",
                    items: [
                      { label: "Web", value: 30 },
                      { label: "Host", value: 12 },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: "Tabs",
            children: [
              {
                type: "Tab",
                label: "Trend",
                children: [
                  {
                    type: "LineChart",
                    label: "Failures",
                    series: [{ key: "failed", label: "Failed" }],
                    points: [
                      { label: "Mon", values: { failed: 3 } },
                      { label: "Tue", values: { failed: 1 } },
                      { label: "Wed", values: { failed: 2 } },
                    ],
                  },
                ],
              },
              {
                type: "Tab",
                label: "Packages",
                children: [
                  {
                    type: "Table",
                    caption: "Packages",
                    columns: ["Name", "Status"],
                    rows: [
                      ["web", "passed"],
                      ["host", "failed"],
                    ],
                  },
                ],
              },
              {
                type: "Tab",
                label: "Options",
                children: [
                  { type: "Switch", id: "notify", label: "Notify me", value: true },
                  { type: "Checkbox", id: "draft", label: "Create draft" },
                  {
                    type: "Slider",
                    id: "retries",
                    label: "Retries",
                    min: 0,
                    max: 5,
                    step: 1,
                    value: 2,
                  },
                  { type: "TagInput", id: "labels", label: "Labels", value: ["release"] },
                  {
                    type: "RadioGroup",
                    id: "channel",
                    label: "Channel",
                    options: [
                      { value: "stable", label: "Stable", description: "Everyone" },
                      { value: "beta", label: "Beta" },
                    ],
                  },
                  { type: "DatePicker", id: "day", label: "Ship on", value: "2026-11-30" },
                ],
              },
            ],
          },
          { type: "TestResult" },
          {
            type: "Disclosure",
            summary: "Details",
            children: [{ type: "Code", text: "pnpm check:web", block: true }],
          },
        ],
      },
      requestId: "fixture-composed-report",
    });
    fixtureVoice.observations.push(result);
    return { action: "reply", reply: "The report is on screen." };
  }
  const copyDraft = /^(show|shorten) copyable draft$/.exec(input.transcript)?.[1];
  if (copyDraft) {
    const result = await input.execute("app_tool_call", {
      family: "workspace",
      action: "workspace.live_work.present",
      input: {
        title: "Release note",
        blocks: [
          { kind: "text", text: "Here is the draft you asked for." },
          {
            kind: "copy",
            label: "Draft",
            text:
              copyDraft === "show"
                ? "Voice results can now show text you copy.\n  Press Copy to take it with you."
                : "Voice results now show copyable text.",
          },
          {
            kind: "actions",
            items: [
              {
                label: "Open next session",
                action: "workspace.sessions.open",
                input: {
                  projectPath: "/fixture-next",
                  sessionId: "fixture-next",
                  surface: "project",
                },
              },
            ],
          },
        ],
      },
      requestId: `fixture-${copyDraft}-copyable-draft`,
    });
    fixtureVoice.observations.push(result);
    return { action: "reply", reply: "The draft is on screen." };
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
const wakeScenario = new URLSearchParams(location.search).get("wake-quick-settings");
export const localVoiceBackend = {
  inspect: async () => {
    if (wakeScenario === "error") throw new Error("Fixture wake listener failure");
    return {
      ready: wakeScenario !== "pack",
      missing: wakeScenario === "pack" ? ["faster-whisper"] : [],
      python: "/fixture/python",
      whisperPath: "/fixture/whisper",
      ttsPath: "/fixture/tts",
    };
  },
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
  jobs: fixtureVoice.jobs,
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
  environmentId: "fixture-host",
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
export const useAssistantIdentity = assistantIdentity;
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
// Finite synthetic storage for local voice fixtures. The production transcript
// and causal-context validators consume these exact receipts without bypasses.
const navigationThreads = new Map<string, any>(),
  navigationMessages = new Map<string, { input: string; message: any }>(),
  navigationContexts = new Map<string, any>();
function fixtureHistoryRequest(input: any): any | undefined {
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
  if (input.op === "profile.update" && new URLSearchParams(location.search).has("setup-wizard")) {
    return { profile: { ...fixtureAssistant.profile, ...input.patch } };
  }
  const history = fixtureHistoryRequest(input);
  if (history !== undefined) return history;
  if (input.op === "questions.present") {
    const proposal = AssistantOwnerQuestionPresentSchema.parse(input);
    const id = `fixture-question-${proposal.requestId}`;
    const existing = ownerQuestions.get(id);
    if (existing) return { ownerQuestion: structuredClone(existing) };
    const now = Date.now();
    const ownerQuestion = AssistantOwnerQuestionSchema.parse({
      id,
      version: 1,
      jobId: null,
      threadId: proposal.threadId,
      ownerMessageId: proposal.ownerMessageId,
      projectIds: proposal.contextProjectIds,
      origin: "voice-proposal",
      sourceToken: "d".repeat(64),
      sourceCurrent: true,
      status: "open",
      createdAt: now,
      updatedAt: now,
      prompt: {
        requestId: ownerQuestions.size + 1,
        occurrenceId: id,
        behavior: "nonBlocking",
        questions: proposal.questions.map((question, index) => ({
          ...question,
          id: `question-${index}`,
          options: question.options.map((option, index) => ({ ...option, id: `option-${index}` })),
        })),
      },
    });
    ownerQuestions.set(id, ownerQuestion);
    if (new URLSearchParams(location.search).has("choice-ack-lost"))
      throw new Error("Synthetic lost question acknowledgement");
    return { ownerQuestion: structuredClone(ownerQuestion) };
  }
  if (input.op === "questions.get")
    return { ownerQuestion: structuredClone(ownerQuestions.get(input.id) ?? null) };
  if (input.op === "questions.answer") {
    const answer = AssistantOwnerQuestionAnswerSchema.parse(input);
    const question = ownerQuestions.get(answer.id);
    if (!question || question.status !== "open" || question.version !== answer.expectedVersion)
      throw new Error("Synthetic changed question");
    const receipt: AssistantOwnerQuestionReceipt = {
      requestId: answer.requestId,
      kind: "answer",
      version: question.version + 1,
      at: Date.now(),
      input: answer,
    };
    const ownerQuestion: AssistantOwnerQuestion = {
      ...question,
      status: "answered",
      version: receipt.version,
      updatedAt: receipt.at,
      lastOwnerAction: receipt,
      answer: {
        requestId: answer.requestId,
        answers: answer.answers,
        custom: answer.custom,
        notes: answer.notes,
        answeredAt: receipt.at,
        version: receipt.version,
      },
    };
    ownerQuestions.set(ownerQuestion.id, ownerQuestion);
    return { ownerQuestion: structuredClone(ownerQuestion), ownerQuestionReceipt: receipt };
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
  if (input.op === "jobs.create") {
    const job = { ...input, id: input.idempotencyKey, status: "queued", version: 1 };
    fixtureVoice.jobs.push(job);
    return { job };
  }
  if (input.op === "messages.linkJob") {
    const record = navigationMessages.get(input.id);
    const job = fixtureVoice.jobs.find(
      (job) => job.id === input.jobId && job.idempotencyKey === input.jobKey,
    );
    if (!record || !job) throw new Error("Synthetic job or conversation message is missing");
    if (!record.message.jobIds.includes(job.id)) {
      record.message.jobIds.push(job.id);
      record.message.version++;
      record.message.updatedAt = Date.now();
    }
    return { message: structuredClone(record.message) };
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
