import { VOICE_RPC_SCHEMAS, type VoiceMethod } from "../../src/shared/model/host-contracts/voice";
import {
  assertDomainAuthority,
  HostDomainOutcomeError,
  type HostDomainContext,
} from "../domains/context";
import { cloudDictationCredential, transcribeCloudDictation } from "./voice-cloud-dictation";
import type { VoiceCloudCredentials } from "./voice-cloud-credentials";
import type { LocalVoiceService } from "./voice-local";
import type { VoiceSetupService } from "./voice-setup";
import type { VoiceRealtimeRelays } from "./voice-realtime-relay";
import type { VoiceCallSettingsStore } from "./voice-call-settings";
import type { z } from "zod";

type VoiceOperation = (
  params: Record<string, unknown>,
  context: HostDomainContext,
) => Promise<unknown>;

/**
 * The paired phone's voice call on its native socket. The dispatcher admits only an authorized
 * device; each call re-checks that grant, and a voice failure keeps its message (nothing was
 * applied elsewhere, so the outcome is known).
 */
export function voiceSocketOperations(dependencies: {
  localVoice: LocalVoiceService;
  voiceCloud: VoiceCloudCredentials;
  voiceSetup: VoiceSetupService;
  voiceRelays: VoiceRealtimeRelays;
  voiceCallSettings: VoiceCallSettingsStore;
}): Record<VoiceMethod, VoiceOperation> {
  const { localVoice, voiceRelays } = dependencies;
  const handlers: {
    [M in VoiceMethod]: (
      params: z.infer<(typeof VOICE_RPC_SCHEMAS)[M]["params"]>,
      context: HostDomainContext,
    ) => unknown;
  } = {
    "voice.local.start": (params) => {
      if (dependencies.voiceSetup.models.status().state === "working")
        throw new Error("A voice model action is running.");
      if (dependencies.voiceSetup.status().state === "installing")
        throw new Error("Voice setup is still running.");
      // The phone cannot disconnect the computer's own voice, so it joins a runtime already
      // loaded with other settings instead of being refused.
      return localVoice.start(params.config, params.recognitionOnly === true, {
        joinLoaded: true,
      });
    },
    "voice.local.transcribe": (params) =>
      localVoice.transcribe(params.lease, params.audio, params.language, params.endpoint),
    "voice.cloud.transcribe": (params) =>
      transcribeCloudDictation(
        params.provider,
        params.audio,
        params.language,
        { credential: cloudDictationCredential(() => dependencies.voiceCloud.get("openrouter")) },
        params.model,
      ),
    "voice.local.speak": (params) => localVoice.speak(params.lease, params.text, params.language),
    "voice.local.speechNext": (params) => localVoice.nextSpeech(params.lease, params.id),
    "voice.local.keepAlive": (params) => localVoice.keepAlive(params.lease),
    "voice.local.release": (params) => localVoice.release(params.lease),
    // The phone's realtime call: the provider socket and its credential stay on this computer.
    "voice.realtime.start": (params, context) => voiceRelays.start(params, context),
    "voice.realtime.audio": (params, context) => voiceRelays.audio(params, context),
    "voice.realtime.next": (params, context) => voiceRelays.next(params, context),
    "voice.realtime.interrupt": (params, context) => voiceRelays.interrupt(params, context),
    "voice.realtime.text": (params, context) => voiceRelays.text(params, context),
    "voice.realtime.end": (params, context) => voiceRelays.end(params, context),
    "voice.call.settings.get": () => dependencies.voiceCallSettings.get(),
    "voice.call.settings.set": (params) => dependencies.voiceCallSettings.set(params),
  };
  const operation =
    <M extends VoiceMethod>(method: M): VoiceOperation =>
    async (params, context) => {
      await assertDomainAuthority(context);
      const parsed = VOICE_RPC_SCHEMAS[method].params.parse(params);
      try {
        return await handlers[method](parsed as never, context);
      } catch (error) {
        throw new HostDomainOutcomeError(
          error instanceof Error ? error.message : "Voice is unavailable on this computer.",
          "not-sent",
          { cause: error },
        );
      }
    };
  return {
    "voice.local.start": operation("voice.local.start"),
    "voice.local.transcribe": operation("voice.local.transcribe"),
    "voice.cloud.transcribe": operation("voice.cloud.transcribe"),
    "voice.local.speak": operation("voice.local.speak"),
    "voice.local.speechNext": operation("voice.local.speechNext"),
    "voice.local.keepAlive": operation("voice.local.keepAlive"),
    "voice.local.release": operation("voice.local.release"),
    "voice.realtime.start": operation("voice.realtime.start"),
    "voice.realtime.audio": operation("voice.realtime.audio"),
    "voice.realtime.next": operation("voice.realtime.next"),
    "voice.realtime.interrupt": operation("voice.realtime.interrupt"),
    "voice.realtime.text": operation("voice.realtime.text"),
    "voice.realtime.end": operation("voice.realtime.end"),
    "voice.call.settings.get": operation("voice.call.settings.get"),
    "voice.call.settings.set": operation("voice.call.settings.set"),
  };
}
