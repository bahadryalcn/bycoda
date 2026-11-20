import { useSyncExternalStore } from "react";
import { voiceHearingStore } from "../../model/voicePresentationTimers";

const never = () => () => {};
const silent = () => false;

/**
 * Whether the microphone is receiving sound, read from the shared level sampler. The component
 * re-renders only when this flips, never for each level value. While `active` is false nothing is
 * sampled. `keepWhenHidden` keeps sampling in a hidden window, for the detached voice window that
 * mirrors the status text.
 */
export function useVoiceHearing(
  level: { readonly current: number },
  active: boolean,
  keepWhenHidden = false,
): boolean {
  const store = voiceHearingStore(level);
  return useSyncExternalStore(
    active ? (keepWhenHidden ? store.subscribeAlways : store.subscribe) : never,
    active ? store.get : silent,
    silent,
  );
}
