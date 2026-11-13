import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

/** Navigation occurrences are consumed once. A prompt never replaces text already being written. */
export function useCommandTarget(
  target: unknown,
  active: boolean,
  text: string,
  setText: Dispatch<SetStateAction<string>>,
  scopeKey = "",
) {
  const consumed = useRef(new WeakSet<object>());
  const [prompts, setPrompts] = useState<Record<string, string | undefined>>({});
  const prompt = prompts[scopeKey];
  const setPrompt = (value: string | undefined) =>
    setPrompts((all) => ({ ...all, [scopeKey]: value }));
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Synchronize the retained composer with shell navigation occurrences delivered after mount.
  useEffect(() => {
    if (!active || !target || typeof target !== "object" || consumed.current.has(target)) return;
    if (!("prompt" in target) || typeof target.prompt !== "string" || !target.prompt.trim()) return;
    consumed.current.add(target);
    if (!text.trim() && target.prompt.trim().length <= 2000) {
      setText(target.prompt.trim());
      setPrompt(undefined);
    } else setPrompt(target.prompt.trim());
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- Prompt ownership follows the current Host/project; setter only addresses that scope.
  }, [target, active, text, setText, scopeKey]);
  return {
    prompt,
    apply: () => {
      if (!prompt || text.length + prompt.length + (text.trim() ? 2 : 0) > 2000) return;
      setText((text) => (text.trim() ? `${text}\n\n${prompt}` : prompt));
      setPrompt(undefined);
    },
    dismiss: () => setPrompt(undefined),
  };
}
