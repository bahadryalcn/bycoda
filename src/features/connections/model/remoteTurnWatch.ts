/**
 * The host runs a turn on another machine, so closing the app does not stop it
 * and nothing local says whether it was running when the app went away. This
 * remembers, per host conversation, the run this app last saw running, so that
 * on the next launch (or after a reconnect) a run the host now reports as
 * interrupted can be told apart from a conversation that was never watched.
 */
const KEY = "bycoda.remote-watched-runs.v1";
const MAX_ENTRIES = 100;

type Store = Pick<Storage, "getItem" | "setItem">;

const store = (): Store | undefined =>
  typeof localStorage === "undefined" ? undefined : localStorage;

export const watchKey = (environmentId: string, sessionId: string) =>
  `${environmentId}:${sessionId}`;

function read(storage: Store | undefined): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

/** The run last seen running for this conversation, if any. */
export function watchedRun(key: string, storage: Store | undefined = store()): string | undefined {
  return read(storage)[key];
}

/** Remember that `runId` was running. Oldest entries go first past the cap. */
export function watchRun(key: string, runId: string, storage: Store | undefined = store()): void {
  const all = read(storage);
  if (all[key] === runId) return;
  delete all[key];
  all[key] = runId;
  const keys = Object.keys(all);
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete all[old];
  try {
    storage?.setItem(KEY, JSON.stringify(all));
  } catch {
    /* losing a hint only means a lost turn is not continued on its own */
  }
}

/** The run ended or was dealt with: stop remembering it. */
export function unwatchRun(key: string, storage: Store | undefined = store()): void {
  const all = read(storage);
  if (!(key in all)) return;
  delete all[key];
  try {
    storage?.setItem(KEY, JSON.stringify(all));
  } catch {
    /* see watchRun */
  }
}
