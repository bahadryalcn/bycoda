import { useSyncExternalStore } from "react";
import { createStore } from "../../../shared/lib/store";

export const OPEN_LIVE_GAMES_EVENT = "bycoda:open-live-games";

const store = createStore();
let open = false;

export function liveGamesPageOpen() {
  return open;
}

export function setLiveGamesPageOpen(next: boolean) {
  if (open === next) return;
  open = next;
  store.notify();
}

export function useLiveGamesPageOpen() {
  return useSyncExternalStore(store.subscribe, liveGamesPageOpen, liveGamesPageOpen);
}

export function requestOpenLiveGamesPage() {
  window.dispatchEvent(new Event(OPEN_LIVE_GAMES_EVENT));
}
