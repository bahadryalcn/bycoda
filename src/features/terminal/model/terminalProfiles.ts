import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState, useSyncExternalStore } from "react";

/** A shell this computer can open a terminal in (src-tauri terminal_profiles.rs). */
export type ShellProfile = {
  id: string;
  name: string;
  path: string;
  kind: string;
};

export type ShellProfiles = {
  profiles: ShellProfile[];
  /** What a terminal opens with when the user has not picked one. */
  defaultId: string | null;
  /** The pick saved for that machine, shared by its desktop app and host. */
  chosenId?: string | null;
};

const KEY = "bycoda.terminalProfile";
const CHANGE = "bycoda:terminal-profile";

/** The profile the user chose for new terminals and `!commands`; undefined
 * leaves the choice to the system default. */
export function loadTerminalProfile(): string | undefined {
  try {
    return localStorage.getItem(KEY) || undefined;
  } catch {
    return undefined;
  }
}

function remember(id: string | undefined): void {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    // private mode / quota
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE));
}

/** Saves the shell for this computer. The Bycoda Host here reads the same
 * choice, so `!commands` sent from another machine run in it too. */
export async function saveTerminalProfile(id: string | undefined): Promise<void> {
  await invoke("set_terminal_profile", { id: id ?? null });
  remember(id);
}

function subscribe(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) listener();
  };
  window.addEventListener(CHANGE, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useTerminalProfile(): string | undefined {
  return useSyncExternalStore(subscribe, loadTerminalProfile, () => undefined);
}

let listing: Promise<ShellProfiles> | null = null;

/** Asks the system once per launch; `refresh` looks again (a shell installed since). */
export function listTerminalProfiles(refresh = false): Promise<ShellProfiles> {
  if (!listing || refresh) {
    listing = invoke<ShellProfiles | null>("terminal_profiles").then(
      (value) => {
        const listed = {
          profiles: Array.isArray(value?.profiles) ? value.profiles : [],
          defaultId: value?.defaultId ?? null,
          chosenId: value?.chosenId ?? null,
        };
        // The machine's file is the record: it may have been changed from
        // another machine through this computer's host.
        if (value && (listed.chosenId ?? undefined) !== loadTerminalProfile())
          remember(listed.chosenId ?? undefined);
        return listed;
      },
      (error) => {
        listing = null;
        throw error;
      },
    );
  }
  return listing;
}

export function useTerminalProfiles():
  | (ShellProfiles & { error?: string; retry: () => void })
  | null {
  const [value, setValue] = useState<ShellProfiles | null>(null);
  const [error, setError] = useState<string>();
  const [retryTick, setRetryTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setValue(null);
    setError(undefined);
    void listTerminalProfiles(retryTick > 0)
      .then((next) => {
        if (alive) setValue(next);
      })
      .catch((reason: unknown) => {
        if (alive) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setValue({ profiles: [], defaultId: null });
        }
      });
    return () => {
      alive = false;
    };
  }, [retryTick]);
  return value ? { ...value, error, retry: () => setRetryTick((tick) => tick + 1) } : null;
}

/** The profile a new terminal opens with: the user's choice while that shell
 * is still installed, otherwise the system default. */
export function effectiveProfileId(
  listed: ShellProfiles | null,
  chosen: string | undefined,
): string | undefined {
  if (!listed) return chosen;
  if (chosen && listed.profiles.some((profile) => profile.id === chosen)) return chosen;
  return listed.defaultId ?? undefined;
}
