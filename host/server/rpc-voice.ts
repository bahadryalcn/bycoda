import { createRealtimeSecret, createVoiceClientSecret } from "../voice/voice";
import { inspectVoiceRuntime } from "../voice/voice-runtime";
import { cloudDictationCredential, transcribeCloudDictation } from "../voice/voice-cloud-dictation";
import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
export async function handleVoiceRpc(
  dependencies: Pick<ServerBindings, "engine" | "voiceCloud" | "localVoice" | "voiceSetup">,
  request: OwnerRpcRequest,
): Promise<void> {
  switch (request.input.method) {
    case "voice.clientSecret":
      await dependencies.engine.store.project(String(request.params.projectId ?? ""));
      request.result = await createVoiceClientSecret();
      break;

    case "voice.local.inspect":
      request.result = await inspectVoiceRuntime(request.params.config, {
        cloudKey: async (provider) => Boolean(await dependencies.voiceCloud.get(provider)),
      });
      break;

    case "voice.realtime.secret":

    case "voice.cloud.status":

    case "voice.cloud.setKey":

    case "voice.cloud.transcribe":
      // Sign-ins and keys stay on this computer: no browser or remote caller.
      if (
        request.request.headers.origin ||
        !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
          request.request.socket.remoteAddress ?? "",
        )
      )
        throw new Error("Cloud voice is available only on this computer.");
      if (request.input.method === "voice.cloud.transcribe") {
        request.result = await transcribeCloudDictation(
          request.params.provider,
          request.params.audio,
          request.params.language,
          {
            credential: cloudDictationCredential(() => dependencies.voiceCloud.get("openrouter")),
          },
          request.params.model,
        );
        break;
      }
      request.result =
        request.input.method === "voice.realtime.secret"
          ? await createRealtimeSecret(request.params.provider)
          : request.input.method === "voice.cloud.status"
            ? await dependencies.voiceCloud.status()
            : await dependencies.voiceCloud.setKey(
                request.params.provider,
                request.params.key ?? null,
              );
      break;

    case "voice.local.setup":

    case "voice.local.setupStatus":
      if (
        request.request.headers.origin ||
        !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
          request.request.socket.remoteAddress ?? "",
        )
      )
        throw new Error("Voice installation is available only on this computer.");
      if (request.input.method === "voice.local.setup") {
        if (dependencies.localVoice.isActive)
          throw new Error("Disconnect voice before installing.");
        // Unload a recognizer kept warm after dictation before replacing it.
        dependencies.localVoice.close();
      }
      request.result =
        request.input.method === "voice.local.setup"
          ? dependencies.voiceSetup.start(request.params.config)
          : dependencies.voiceSetup.status();
      break;

    case "voice.local.speak":
      request.result = dependencies.localVoice.speak(
        request.params.lease,
        request.params.text,
        request.params.language,
      );
      break;

    case "voice.local.speechNext":
      request.result = await dependencies.localVoice.nextSpeech(
        request.params.lease,
        request.params.id,
      );
      break;

    case "voice.local.speechCancel":
      request.result = dependencies.localVoice.cancelSpeech(
        request.params.lease,
        request.params.id,
      );
      break;

    case "voice.local.start":
      if (dependencies.voiceSetup.status().state === "installing")
        throw new Error("Voice setup is still running.");
      request.result = await dependencies.localVoice.start(
        request.params.config,
        request.params.recognitionOnly === true,
      );
      break;

    case "voice.local.transcribe":
      request.result = await dependencies.localVoice.transcribe(
        request.params.lease,
        request.params.audio,
        request.params.language,
        request.params.endpoint,
      );
      break;

    case "voice.local.keepAlive":
      request.result = dependencies.localVoice.keepAlive(request.params.lease);
      break;

    case "voice.local.release":
      request.result = dependencies.localVoice.release(request.params.lease);
      break;
  }
}
