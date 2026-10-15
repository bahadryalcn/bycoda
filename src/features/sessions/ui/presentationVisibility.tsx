import { createContext, useContext, useEffect, useState } from "react";
export const PresentationVisibility = createContext(true);
/** This gates display refreshes only; never use it for provider deadlines. */
export function usePresentationVisible(): boolean {
  const paneVisible = useContext(PresentationVisibility);
  const [documentVisible, setDocumentVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  useEffect(() => {
    const update = () => setDocumentVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return paneVisible && documentVisible;
}
