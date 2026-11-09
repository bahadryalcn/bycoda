import { join } from "node:path";
import { OsSocialCredentials } from "../social/social-credentials";
import { VoiceCloudCredentials } from "../voice/voice-cloud-credentials";
import { LocalVoiceService } from "../voice/voice-local";
import { VoiceSetupService } from "../voice/voice-setup";
import type { ServerBindings } from "./bindings";
export function createVoiceRuntime(
  dependencies: Pick<ServerBindings, "featureDirectory" | "engine">,
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
  return { voiceCloud, localVoice, voiceSetup };
}
