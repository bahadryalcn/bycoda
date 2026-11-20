import { createContext, useContext, useSyncExternalStore } from "react";
export const PresentationVisibility = createContext(true);

const subscribeVisibility = (listener: () => void) => {
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
};
const subscribeIdle = () => () => {};
const readDocumentVisible = () => document.visibilityState !== "hidden";
const serverVisible = () => true;

/** This gates display refreshes only; never use it for provider deadlines. */
export function usePresentationVisible(observeDocument = true): boolean {
  const paneVisible = useContext(PresentationVisibility);
  // Idle consumers still read the current snapshot when they render for new content.
  const documentVisible = useSyncExternalStore(
    observeDocument ? subscribeVisibility : subscribeIdle,
    readDocumentVisible,
    serverVisible,
  );
  return paneVisible && documentVisible;
}
