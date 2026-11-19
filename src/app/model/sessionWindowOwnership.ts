import { parseRemotePath } from "../../features/connections/model/remoteProjects";
import { invoke } from "@tauri-apps/api/core";

export function remoteSessionOwnershipKey(project: string, sessionId: string): string {
  const environmentId = parseRemotePath(project)?.environmentId;
  if (!environmentId) throw new Error("Remote conversation machine identity is unavailable.");
  return `remote-session:${JSON.stringify([environmentId, sessionId])}`;
}

type ClaimResult =
  | { status: "owned"; tokens: Record<string, string> }
  | { status: "other"; sessionId: string; ownerWindowLabel: string };

let focusOwner: ((owner: string, session: string, inspect?: string) => Promise<void>) | undefined;
export function configureSessionWindowFocus(
  focus: (owner: string, session: string, inspect?: string) => Promise<void>,
): void {
  focusOwner = focus;
}

const tokens = new Map<string, string>();
const reservations = new Map<string, number>();
let queue: Promise<void> = Promise.resolve();
let visible = new Set<string>();

function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work);
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
async function releaseUnused() {
  const released: Record<string, string> = {};
  for (const [id, token] of tokens) {
    if (!visible.has(id) && !reservations.has(id)) released[id] = token;
  }
  if (!Object.keys(released).length) return;
  await invoke("release_session_windows", { tokens: released });
  for (const [id, token] of Object.entries(released)) {
    if (tokens.get(id) === token) tokens.delete(id);
  }
}

function claimNative(ids: readonly string[]): Promise<ClaimResult> {
  return serialized(async () => {
    const claim = await invoke<ClaimResult>("claim_session_windows", { sessionIds: ids });
    if (claim.status === "owned")
      for (const [id, token] of Object.entries(claim.tokens)) tokens.set(id, token);
    return claim;
  });
}

const restored = new Map<string, (retain?: boolean) => Promise<void>>();
/** The native command takes at most this many ids and claims all or none of them. */
const CLAIM_BATCH_SIZE = 128;
/**
 * Holds bootstrap claims until a mounted tab confirms ownership. Claims the ids
 * in order in as few native calls as possible and returns those another window
 * owns; each owned id keeps its own release, so `abortRestoredSession` and the
 * mount-time sync treat it exactly like a single claim. A conflict names one id,
 * so that id is set aside and the rest are claimed again. On any failure every
 * claim made by this call is released before the error is rethrown.
 */
export async function claimRestoredSessions(ids: Iterable<string>): Promise<Set<string>> {
  const foreign = new Set<string>();
  const fresh = [...new Set(ids)].filter((id) => !restored.has(id));
  const finishers = new Map(fresh.map((id) => [id, holdReservations([id])] as const));
  try {
    for (let offset = 0; offset < fresh.length; offset += CLAIM_BATCH_SIZE) {
      let pending = fresh.slice(offset, offset + CLAIM_BATCH_SIZE);
      while (pending.length) {
        const claim = await claimNative(pending);
        if (claim.status === "owned") {
          for (const id of pending) restored.set(id, finishers.get(id)!);
          break;
        }
        const next = pending.filter((id) => id !== claim.sessionId);
        if (next.length === pending.length)
          throw new Error("Conversation ownership named an unrequested conversation.");
        foreign.add(claim.sessionId);
        await finishers.get(claim.sessionId)!();
        pending = next;
      }
    }
  } catch (error) {
    // Every reservation drops before the first release runs, so one call frees all.
    await Promise.all(
      [...finishers].map(([id, finish]) => {
        if (restored.get(id) === finish) restored.delete(id);
        return finish().catch(() => {});
      }),
    );
    throw error;
  }
  return foreign;
}
export async function abortRestoredSession(id: string): Promise<void> {
  const finish = restored.get(id);
  if (!finish) return;
  restored.delete(id);
  await finish(false);
}

/** Keeps native claims for every mounted pane, including idle tabs. */
export function syncSessionWindowOwnership(ids: readonly string[]): Promise<void> {
  visible = new Set(ids);
  const operation = serialized(async () => {
    const missing = [...visible].filter((id) => !tokens.has(id));
    for (let offset = 0; offset < missing.length; offset += 128) {
      const result = await invoke<ClaimResult>("claim_session_windows", {
        sessionIds: missing.slice(offset, offset + 128),
      });
      if (result.status !== "owned")
        throw new Error("A conversation is already open in another window.");
      for (const [id, token] of Object.entries(result.tokens)) tokens.set(id, token);
    }
    await releaseUnused();
  });
  return operation.then(async () => {
    for (const id of ids) {
      const finish = restored.get(id);
      if (!finish) continue;
      restored.delete(id);
      await finish(visible.has(id));
    }
  });
}

/** Reserves the whole open operation before any local pane is created. */
export function reserveSessionWindow(
  ids: readonly string[],
  inspectSessionId?: string,
): Promise<((retain?: boolean) => Promise<void>) | null> {
  return reserve(ids, true, inspectSessionId);
}
/** Protects ids from `releaseUnused` until the returned release runs once. */
function holdReservations(ids: readonly string[]): (retain?: boolean) => Promise<void> {
  const unique = [...new Set(ids)];
  for (const id of unique) reservations.set(id, (reservations.get(id) ?? 0) + 1);
  let finished = false;
  return async (retain = false) => {
    if (finished) return;
    finished = true;
    if (retain) for (const id of unique) visible.add(id);
    for (const id of unique) {
      const count = reservations.get(id) ?? 0;
      if (count <= 1) reservations.delete(id);
      else reservations.set(id, count - 1);
    }
    await serialized(releaseUnused);
  };
}
async function reserve(
  ids: readonly string[],
  focusRequested: boolean,
  inspectSessionId?: string,
): Promise<((retain?: boolean) => Promise<void>) | null> {
  const unique = [...new Set(ids)];
  const finish = holdReservations(unique);
  try {
    const result = await claimNative(unique);
    if (result.status === "other") {
      if (focusRequested) {
        if (!focusOwner) throw new Error("Conversation window focus is unavailable.");
        await focusOwner(result.ownerWindowLabel, result.sessionId, inspectSessionId);
      }
      await finish();
      return null;
    }
    return finish;
  } catch (error) {
    await finish().catch(() => {});
    throw error;
  }
}
