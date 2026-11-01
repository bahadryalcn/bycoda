// Synthetic transport for the voice fixture. No device, Host, provider or audio access.
export const fixtureVoice = {
  callbacks: null as any,
  connects: 0,
  closes: 0,
  submits: 0,
  stops: 0,
  actions: [] as string[],
  observations: [] as unknown[],
  speech(text: string) {
    const onset = this.callbacks.start();
    const binding = this.callbacks.accept?.(onset) ?? onset;
    this.callbacks.transcript({ text }, binding);
  },
};
export class LocalVoice {
  readonly level = { current: 0.55 };
  constructor(callbacks: any, _language?: string, _config?: unknown, level = this.level) {
    this.level = level;
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
  speak() {
    return true;
  }
  mute() {}
  silence() {
    fixtureVoice.callbacks?.playback(false);
  }
}
export const sessionsRef = { current: [] };
export const useSession = () => undefined;
export const converseWithSession = () => new Promise(() => {});
export const warmVoiceReply = async () => {};
export const immediateVoiceDecision = () => undefined;
/** Only the focused global-voice fixture aliases this assistant transport. */
export async function converseWithAssistant(input: {
  transcript: string;
  execute: (name: string, args: Record<string, unknown>) => Promise<any>;
}) {
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
    requestId: "fixture-project-list",
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
