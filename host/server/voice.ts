import { join } from "node:path";
import { OsSocialCredentials } from "../social/social-credentials";
import { VoiceCloudCredentials } from "../voice/voice-cloud-credentials";
import { LocalVoiceService } from "../voice/voice-local";
import { VoiceSetupService } from "../voice/voice-setup";
import { VoiceCallSettingsStore } from "../voice/voice-call-settings";
import { VoiceRealtimeRelays } from "../voice/voice-realtime-relay";
import { createRealtimeSecret } from "../voice/voice";
import { assistantDomain } from "../domains/assistant/service";
import { realtimeSignIns } from "./rpc-voice";
import type { ServerBindings } from "./bindings";
export function createVoiceRuntime(
  dependencies: Pick<ServerBindings, "featureDirectory" | "engine" | "assistant" | "projectsService">,
) {
  // Cloud voice keys (ElevenLabs) live in their own OS-encrypted vault.
  const voiceCloud = new VoiceCloudCredentials(
    new OsSocialCredentials(
      join(dependencies.featureDirectory, "voice", "credentials"),
      dependencies.engine.store.environmentId,
    ),
  );
  const localVoice = new LocalVoiceService({ cloudKey: (provider) => voiceCloud.get(provider) });
  const voiceSetup = new VoiceSetupService();
  const voiceCallSettings = new VoiceCallSettingsStore(
    join(dependencies.featureDirectory, "voice", "call-settings.json"),
    async () => {
      const { openai, xai } = await realtimeSignIns();
      return { grok: xai, openai };
    },
  );
  // The phone call's Grok Voice / OpenAI Realtime runs here; the phone is microphone and speaker.
  // Assistant and projects are composed later, so they are read when a call needs them.
  const voiceRelays = new VoiceRealtimeRelays({
    secret: (provider) => createRealtimeSecret(provider),
    settings: () => voiceCallSettings.read(),
    threadBinding: (id) => dependencies.assistant.threadBinding(id),
    assistantRequest: (raw, context) =>
      assistantDomain(dependencies.assistant, dependencies.engine.store)(raw, context),
    projectDirectory: (context) => dependencies.projectsService.directory({}, context),
  });
  return { voiceCloud, localVoice, voiceSetup, voiceCallSettings, voiceRelays };
}
