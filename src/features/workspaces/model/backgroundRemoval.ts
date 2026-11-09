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
 * `useBackgroundRemovals` and one toast follows the operation from start to result.
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
  toast.show({
    id,
    tone: "info",
    title: t("Deleting {p0}", { p0: label }),
    message: t("You can keep working. A notification follows when it finishes."),
    dismissible: false,
  });
  try {
    await work();
    toast.show({ id, tone: "success", message: t("Deleted {p0}", { p0: label }) });
    return true;
  } catch (error) {
    toast.show({
      id,
      tone: "danger",
      title: t("Couldn't delete {p0}", { p0: label }),
      message: error instanceof Error ? error.message : String(error),
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
