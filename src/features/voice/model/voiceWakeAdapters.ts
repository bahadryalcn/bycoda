import captureUrl from "./voiceCapture.js?url&no-inline";
import { t } from "../../../shared/i18n";
import { localVoiceBackend, type VoiceRuntimeConfig } from "./localVoiceClient";
import { openMicrophone } from "./microphoneAccess";
import type { WakeCapture, WakeDeps } from "./voiceWakeListener";

const noop = () => {};

/** Microphone through the same capture worklet as dictation; closing releases every track. */
async function openWakeCapture(
  onFrame: (frame: Int16Array) => void,
  microphoneId?: string,
): Promise<WakeCapture> {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error(t("Microphone access requires the desktop app or a secure browser context."));
  const stream = await openMicrophone({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      ...(microphoneId ? { deviceId: { exact: microphoneId } } : {}),
    },
    video: false,
  });
  const release = (...nodes: { disconnect: () => void }[]) => {
    stream.getTracks().forEach((track) => track.stop());
    for (const node of nodes) node.disconnect();
  };
  let audio: AudioContext | undefined;
  try {
    audio = new AudioContext({ sampleRate: 16000 });
    const context = audio;
    await audio.resume();
    await audio.audioWorklet.addModule(captureUrl);
    const source = audio.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(audio, "bycoda-voice-capture");
    node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => onFrame(new Int16Array(event.data));
    source.connect(node);
    node.connect(audio.destination);
    return {
      rate: audio.sampleRate,
      close: () => {
        node.port.onmessage = null;
        release(source, node);
        if (context.state !== "closed") void context.close().catch(noop);
      },
    };
  } catch (cause) {
    release();
    if (audio && audio.state !== "closed") void audio.close().catch(noop);
    throw cause;
  }
}

/**
 * Wake listener inputs on this computer only: the microphone and the shared recognition-only
 * Whisper lease (the same call dictation uses). Cloud transcription is never reachable here.
 */
export function localWakeDeps(options: {
  config: VoiceRuntimeConfig;
  language?: string;
  microphoneId?: string;
}): WakeDeps {
  let lease: Promise<string> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const drop = () => {
    clearInterval(heartbeat);
    heartbeat = undefined;
    const pending = lease;
    lease = undefined;
    void pending?.then((id) => localVoiceBackend.release(id)).catch(noop);
  };
  return {
    openCapture: (onFrame) => openWakeCapture(onFrame, options.microphoneId),
    recognize: async (pcm) => {
      closed = false;
      lease ??= localVoiceBackend.start(options.config, true).then(({ lease: id }) => {
        if (closed || lease !== pending) {
          return id;
        }
        heartbeat ??= setInterval(() => {
          void localVoiceBackend.keepAlive(id).catch(noop);
        }, 30_000);
        return id;
      });
      const pending = lease;
      try {
        const id = await pending;
        if (closed || lease !== pending) throw new Error("Wake listening stopped.");
        return (await localVoiceBackend.transcribe(id, pcm, options.language)).text;
      } catch (cause) {
        if (lease === pending) drop();
        throw cause;
      }
    },
    closeRecognizer: () => {
      closed = true;
      drop();
    },
  };
}
