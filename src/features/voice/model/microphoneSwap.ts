import { openMicrophone, stopMicrophone } from "./microphoneAccess";

/** The capture constraints every voice conversation opens its microphone with. */
export function voiceMicrophoneConstraints(deviceId?: string): MediaStreamConstraints {
  return {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
    video: false,
  };
}

export type SwappedMicrophone = {
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  /** The device actually open: the requested one, or the previous one after a failure. */
  deviceId?: string;
};

/**
 * Moves a live capture to another microphone and keeps its audio graph, so the conversation
 * continues. Microphone ownership is exclusive, so the old stream closes before the new one
 * opens. When the new device fails, the previous one is reopened; only when both fail does
 * this reject.
 */
export async function swapMicrophone(options: {
  context: AudioContext;
  capture: AudioNode;
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  deviceId?: string;
  previousDeviceId?: string;
  muted: () => boolean;
  signal: AbortSignal;
  onEnded?: () => void;
}): Promise<SwappedMicrophone> {
  options.source.disconnect();
  for (const track of options.stream.getAudioTracks()) track.onended = null;
  stopMicrophone(options.stream);
  let deviceId = options.deviceId;
  let stream: MediaStream;
  try {
    stream = await openMicrophone(voiceMicrophoneConstraints(deviceId), {
      signal: options.signal,
    });
  } catch (cause) {
    if (options.signal.aborted || deviceId === options.previousDeviceId) throw cause;
    deviceId = options.previousDeviceId;
    stream = await openMicrophone(voiceMicrophoneConstraints(deviceId), {
      signal: options.signal,
    });
  }
  for (const track of stream.getAudioTracks()) {
    track.enabled = !options.muted();
    if (options.onEnded) track.onended = options.onEnded;
  }
  const source = options.context.createMediaStreamSource(stream);
  source.connect(options.capture);
  return { stream, source, deviceId };
}
