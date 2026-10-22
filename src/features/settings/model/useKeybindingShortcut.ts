import { useCallback, useSyncExternalStore } from "react";
import { KEYBINDINGS, keybindingShortcutLabel, subscribeKeybindings } from "./settings";

const noSubscription = () => () => {};

/** The same default/override/disabled binding used by the command handlers. */
export function useKeybindingShortcut(command: string): string | null {
  const getSnapshot = useCallback(
    () =>
      command
        ? keybindingShortcutLabel(
            command,
            KEYBINDINGS.find((row) => row.command === command)?.keys ?? "",
          ) || null
        : null,
    [command],
  );
  return useSyncExternalStore(
    command ? subscribeKeybindings : noSubscription,
    getSnapshot,
    () => null,
  );
}
