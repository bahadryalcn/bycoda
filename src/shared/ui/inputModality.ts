export type InputModality = "keyboard" | "pointer";

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "Fn"]);

/**
 * Publishes the last input device as `html[data-input-modality]`. The focus tokens in
 * src/styles/arc.css draw nothing under `pointer` (and before any input) and draw the keyboard cue
 * under `keyboard`. Call once from the app bootstrap; returns the disposer.
 */
export function installInputModality(target: Document = document): () => void {
  const root = target.documentElement;
  const set = (modality: InputModality) => {
    if (root.dataset.inputModality !== modality) root.dataset.inputModality = modality;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (MODIFIER_KEYS.has(event.key)) return;
    set("keyboard");
  };
  const onPointerDown = () => set("pointer");
  const view = target.defaultView ?? window;
  view.addEventListener("keydown", onKeyDown, { capture: true });
  view.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
  return () => {
    view.removeEventListener("keydown", onKeyDown, { capture: true });
    view.removeEventListener("pointerdown", onPointerDown, { capture: true });
    delete root.dataset.inputModality;
  };
}
