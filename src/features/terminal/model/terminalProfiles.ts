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

function remember(id: string | undefined): boolean {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    // private mode / quota
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE));
  return loadTerminalProfile() === id;
}

/** Result of a save: the machine's file is authoritative; `mirrored` says whether
 * this window's cached copy now agrees with it. */
export type TerminalProfileSave = { mirrored: boolean };

/** Bumped when a save starts and when it settles, so a discovery that overlapped a
 * save never rehydrates an older choice. */
let saveEpoch = 0;
/** Newest choice the machine's file confirmed from this window. */
let confirmedChoice: { id: string | null } | undefined;

/** Saves the shell for this computer. The Bycoda Host here reads the same
 * choice, so `!commands` sent from another machine run in it too. The native
 * write is authoritative; a cache failure afterwards is reported, not thrown, so
 * the caller never retries a write that already succeeded. */
export async function saveTerminalProfile(id: string | undefined): Promise<TerminalProfileSave> {
  saveEpoch++;
  try {
    await invoke("set_terminal_profile", { id: id ?? null });
  } catch (error) {
    saveEpoch++;
    throw error;
  }
  saveEpoch++;
  confirmedChoice = { id: id ?? null };
  // Cached discovery predates this choice.
  listing = null;
  return { mirrored: remember(id) };
}

/** Retries only this window's cached copy of an already saved choice. */
export function syncTerminalProfileMirror(id: string | undefined): boolean {
  return remember(id);
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
let discoveryEpoch = 0;

/** Asks the system once per launch; `refresh` looks again (a shell installed since). */
export function listTerminalProfiles(refresh = false): Promise<ShellProfiles> {
  if (!listing || refresh) {
    const discovery = ++discoveryEpoch;
    const savesAtStart = saveEpoch;
    const request: Promise<ShellProfiles> = invoke<ShellProfiles | null>("terminal_profiles").then(
      (value) => {
        const listed: ShellProfiles = {
          profiles: Array.isArray(value?.profiles) ? value.profiles : [],
          defaultId: value?.defaultId ?? null,
          chosenId: value?.chosenId ?? null,
        };
        // A newer discovery superseded this one, which must not rehydrate state.
        if (discovery !== discoveryEpoch) return listed;
        // A save overlapped this request, so its choice may predate the saved one:
        // keep what this window confirmed and let the next call read again.
        if (savesAtStart !== saveEpoch) {
          if (confirmedChoice) listed.chosenId = confirmedChoice.id;
          if (listing === request) listing = null;
          return listed;
        }
        // The machine's file is the record: it may have been changed from
        // another machine through this computer's host.
        if (value && (listed.chosenId ?? undefined) !== loadTerminalProfile())
          remember(listed.chosenId ?? undefined);
        return listed;
      },
      (error) => {
        // An older failure must not discard a newer discovery's cache.
        if (listing === request) listing = null;
        throw error;
      },
    );
    listing = request;
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
