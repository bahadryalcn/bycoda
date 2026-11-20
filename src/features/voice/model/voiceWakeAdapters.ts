import captureUrl from "./voiceCapture.js?url&no-inline";
import { t } from "../../../shared/i18n";
import { localVoiceBackend, type VoiceRuntimeConfig } from "./localVoiceClient";
import { openMicrophone, stopMicrophone } from "./microphoneAccess";
import { withTimeout } from "../../../shared/lib/withTimeout";
import type { WakeCapture, WakeDeps } from "./voiceWakeListener";

const noop = () => {};

/** Microphone through the same capture worklet as dictation; closing releases every track. */
async function openWakeCapture(
  onFrame: (frame: Int16Array) => void,
  signal: AbortSignal,
  microphoneId?: string,
): Promise<WakeCapture> {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error(t("Microphone access requires the desktop app or a secure browser context."));
  const stream = await openMicrophone(
    {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(microphoneId ? { deviceId: { exact: microphoneId } } : {}),
      },
      video: false,
    },
    { signal, wake: true },
  );
  let audio: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let node: AudioWorkletNode | undefined;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    signal.removeEventListener("abort", close);
    stopMicrophone(stream);
    if (node) node.port.onmessage = null;
    source?.disconnect();
    node?.disconnect();
    if (audio && audio.state !== "closed") void audio.close().catch(noop);
  };
  signal.addEventListener("abort", close, { once: true });
  try {
    signal.throwIfAborted();
    audio = new AudioContext({ sampleRate: 16000 });
    await withTimeout(audio.resume(), 5_000, "Wake microphone");
    signal.throwIfAborted();
    await withTimeout(audio.audioWorklet.addModule(captureUrl), 5_000, "Wake capture worklet");
    signal.throwIfAborted();
    source = audio.createMediaStreamSource(stream);
    node = new AudioWorkletNode(audio, "bycoda-voice-capture");
    node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => onFrame(new Int16Array(event.data));
    source.connect(node);
    node.connect(audio.destination);
    signal.removeEventListener("abort", close);
    return { rate: audio.sampleRate, close };
  } catch (cause) {
    close();
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
    openCapture: (onFrame, signal) => openWakeCapture(onFrame, signal, options.microphoneId),
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
