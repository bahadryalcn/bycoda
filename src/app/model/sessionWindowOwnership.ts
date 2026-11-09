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

const restored = new Map<string, (retain?: boolean) => Promise<void>>();
/** Hold bootstrap claims until a mounted tab confirms ownership. */
export async function claimRestoredSession(id: string): Promise<boolean> {
  if (restored.has(id)) return true;
  const finish = await reserve([id], false);
  if (!finish) return false;
  restored.set(id, finish);
  return true;
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
async function reserve(
  ids: readonly string[],
  focusRequested: boolean,
  inspectSessionId?: string,
): Promise<((retain?: boolean) => Promise<void>) | null> {
  const unique = [...new Set(ids)];
  for (const id of unique) reservations.set(id, (reservations.get(id) ?? 0) + 1);
  let finished = false;
  const finish = async (retain = false) => {
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
  try {
    const result = await serialized(async () => {
      const claim = await invoke<ClaimResult>("claim_session_windows", { sessionIds: unique });
      if (claim.status === "owned")
        for (const [id, token] of Object.entries(claim.tokens)) tokens.set(id, token);
      return claim;
    });
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
