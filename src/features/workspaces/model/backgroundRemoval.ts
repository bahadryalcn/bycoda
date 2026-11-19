import { errorText } from "../../../shared/lib/errors";
import { t } from "../../../shared/i18n";
import { pathKey } from "../../../shared/lib/paths";
import { toast } from "../../../shared/ui/ToastRegion";

/** Folders whose removal is still running, keyed by `pathKey`. Survives dialog and page unmount. */
let running: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function publish(next: ReadonlySet<string>) {
  running = next;
  for (const listener of listeners) listener();
}

/** Subscribes to running removals; `backgroundRemovals()` reads the current set. */
export function subscribeBackgroundRemovals(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Runs a slow worktree removal after its dialog closes. The row shows progress through
 * `useBackgroundRemovals`; only the result raises a dismissible toast, so a long removal
 * never leaves a notice covering the window.
 * Resolves false when the folder is already being removed or the work fails.
 */
export async function runBackgroundRemoval(
  path: string,
  label: string,
  work: () => Promise<void>,
): Promise<boolean> {
  const key = pathKey(path);
  if (running.has(key)) return false;
  publish(new Set([...running, key]));
  const id = `background-removal:${key}`;
  try {
    await work();
    return true;
  } catch (error) {
    toast.show({
      id,
      tone: "danger",
      title: t("Couldn't delete {p0}", { p0: label }),
      message: errorText(error),
    });
    return false;
  } finally {
    publish(new Set([...running].filter((item) => item !== key)));
  }
}

export const backgroundRemovals = () => running;

export function isBackgroundRemoval(removals: ReadonlySet<string>, path: string) {
  return removals.has(pathKey(path));
}
