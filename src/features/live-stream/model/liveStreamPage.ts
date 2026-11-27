import { useSyncExternalStore } from "react";
import { createStore } from "../../../shared/lib/store";

export const OPEN_LIVE_STREAM_EVENT = "bycoda:open-live-stream";

const store = createStore();
let open = false;

export function liveStreamPageOpen() {
  return open;
}

export function setLiveStreamPageOpen(next: boolean) {
  if (open === next) return;
  open = next;
  store.notify();
}

export function useLiveStreamPageOpen() {
  return useSyncExternalStore(store.subscribe, liveStreamPageOpen, liveStreamPageOpen);
}

export function requestOpenLiveStreamPage() {
  window.dispatchEvent(new Event(OPEN_LIVE_STREAM_EVENT));
}
