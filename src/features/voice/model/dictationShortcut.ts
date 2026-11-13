export const DICTATION_COMMAND = "Voice: Dictate";
export type DictationShortcutMode = "auto" | "hold" | "toggle";

/** Key ownership is frozen at onset; releasing a modifier first still finishes held capture. */
export function bindDictationShortcut(
  target: Window,
  options: {
    mode: () => DictationShortcutMode;
    matches: (event: KeyboardEvent) => boolean;
    focused: () => boolean;
    active: () => boolean;
    start: () => void;
    stop: () => void;
    cancel: () => void;
  },
) {
  let held: { code: string; mode: DictationShortcutMode; started: number } | undefined;
  const down = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.repeat ||
      held ||
      !options.focused() ||
      !options.matches(event)
    )
      return;
    event.preventDefault();
    if (options.active()) {
      options.stop();
      return;
    }
    held = { code: event.code || event.key, mode: options.mode(), started: performance.now() };
    options.start();
  };
  const up = (event: KeyboardEvent) => {
    if (!held || (event.code || event.key) !== held.code) return;
    const press = held;
    held = undefined;
    event.preventDefault();
    if (
      press.mode === "hold" ||
      (press.mode === "auto" && performance.now() - press.started >= 300)
    )
      options.stop();
  };
  const blur = () => {
    if (!held) return;
    held = undefined;
    options.cancel();
  };
  target.addEventListener("keydown", down);
  target.addEventListener("keyup", up);
  target.addEventListener("blur", blur);
  return () => {
    target.removeEventListener("keydown", down);
    target.removeEventListener("keyup", up);
    target.removeEventListener("blur", blur);
    blur();
  };
}
