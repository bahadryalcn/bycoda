import { useEffect, useRef } from "react";

/** Route mouse side buttons through the same navigation as the shell arrows. */
export function useMouseNavigation(onBack: () => void, onForward: () => void) {
  const actions = useRef({ onBack, onForward });
  actions.current = { onBack, onForward };

  useEffect(() => {
    const onMouse = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      // Consume the whole click sequence, including Chromium's native history
      // action, but navigate only once, on press. Capture also covers editors
      // and terminals that stop bubbling mouse events.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === "mousedown") {
        if (event.button === 3) actions.current.onBack();
        else actions.current.onForward();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      // Some mouse drivers expose their side buttons as browser keys instead.
      if (event.key !== "BrowserBack" && event.key !== "BrowserForward") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (event.key === "BrowserBack") actions.current.onBack();
      else actions.current.onForward();
    };
    const mouseEvents = ["mousedown", "mouseup", "auxclick"] as const;
    for (const type of mouseEvents) window.addEventListener(type, onMouse, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      for (const type of mouseEvents) window.removeEventListener(type, onMouse, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);
}
