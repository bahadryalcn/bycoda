import { useSyncExternalStore } from "react";
import { createStore } from "../../../shared/lib/store";

/** Ask the workspace to open the Crews page; the surface openers own closing the other views. */
export const OPEN_CREWS_PAGE_EVENT = "bycoda:open-crews-page";

let open = false;
const store = createStore();

/** Whether the full-page Crews view is showing. The workspace shell owns when it closes. */
export function crewsPageOpen() {
  return open;
}

export function setCrewsPageOpen(next: boolean) {
  if (open === next) return;
  open = next;
  store.notify();
}

export function useCrewsPageOpen() {
  return useSyncExternalStore(store.subscribe, crewsPageOpen, crewsPageOpen);
}

export function requestOpenCrewsPage() {
  window.dispatchEvent(new Event(OPEN_CREWS_PAGE_EVENT));
}

/** Where the Crews page should land; every field is optional. */
export type CrewsPageTarget = {
  tab?: "active" | "teams" | "members" | "work";
  /** Work tab: the crew whose work to list. */
  definitionId?: string;
  /** Work tab: the run to show. */
  runId?: string;
};
export type CrewsPageRequest = CrewsPageTarget & { nonce: number };

let request: CrewsPageRequest | null = null;
let nonce = 0;
const requestStore = createStore();

/** The landing request the page has not applied yet. */
export function pendingCrewsPageRequest() {
  return request;
}

/** Called by the page once it has applied the request. */
export function consumeCrewsPageRequest(handled: CrewsPageRequest) {
  if (request !== handled) return;
  request = null;
  requestStore.notify();
}

export function usePendingCrewsPageRequest() {
  return useSyncExternalStore(
    requestStore.subscribe,
    pendingCrewsPageRequest,
    pendingCrewsPageRequest,
  );
}

/** Opens the page on `target`; the page applies it as soon as it shows, even when it was closed. */
export function openCrewsPageAt(target: CrewsPageTarget) {
  request = { ...target, nonce: ++nonce };
  requestStore.notify();
  requestOpenCrewsPage();
}
