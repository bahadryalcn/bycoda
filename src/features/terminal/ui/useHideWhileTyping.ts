import { useEffect, useRef, useState } from "react";

/**
 * Reports whether the user is typing into the pane that hosts the returned element,
 * so floating chrome can step aside instead of covering the prompt. Keys pressed
 * inside the element itself never count; any pointer movement over the pane resets it.
 */
export function useHideWhileTyping<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const element = ref.current;
    const pane = element?.parentElement;
    if (!element || !pane) return;
    const hide = (event: KeyboardEvent) => {
      if (!element.contains(event.target as Node)) setTyping(true);
    };
    const reveal = () => setTyping(false);
    pane.addEventListener("keydown", hide);
    pane.addEventListener("pointermove", reveal);
    return () => {
      pane.removeEventListener("keydown", hide);
      pane.removeEventListener("pointermove", reveal);
    };
  }, []);
  return [ref, typing] as const;
}
