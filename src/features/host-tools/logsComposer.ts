type Receiver = (text: string) => boolean;

export const MAX_LOG_DRAFT_CHARACTERS = 32_000;
const receivers = new Map<string, Receiver>();
const key = (cwd: string, sessionId: string) => JSON.stringify([cwd, sessionId]);
const DRAFT_EVENT = "bycoda:logs-draft";
type DraftRequest = { id: string; cwd: string; sessionId: string; text: string; replyTo: string };

async function receiveWindowDrafts(cwd: string, sessionId: string, receive: Receiver) {
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const { emitTo } = await import("@tauri-apps/api/event");
  return getCurrentWebviewWindow().listen<DraftRequest>(DRAFT_EVENT, async ({ payload }) => {
    if (
      payload?.cwd !== cwd ||
      payload.sessionId !== sessionId ||
      typeof payload.id !== "string" ||
      typeof payload.replyTo !== "string"
    )
      return;
    const accepted =
      typeof payload.text === "string" &&
      !!payload.text.trim() &&
      payload.text.length <= MAX_LOG_DRAFT_CHARACTERS &&
      receive(payload.text);
    await emitTo(payload.replyTo, `${DRAFT_EVENT}-ack`, { id: payload.id, accepted });
  });
}

/** Only an explicit app action may add diagnostics to an existing draft. */
export function registerLogsComposer(cwd: string, sessionId: string, receive: Receiver) {
  const target = key(cwd, sessionId);
  receivers.set(target, receive);
  const listener =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
      ? receiveWindowDrafts(cwd, sessionId, receive).catch(() => undefined)
      : undefined;
  return () => {
    if (receivers.get(target) === receive) receivers.delete(target);
    if (listener) void listener.then((stop) => stop?.());
  };
}

/** Only an explicit click from a tools window targets the originating composer. */
export async function attachLogsToComposerAcrossWindows(
  cwd: string,
  sessionId: string,
  text: string,
  composerWindow?: string,
) {
  if (receivers.has(key(cwd, sessionId)) || !composerWindow)
    return attachLogsToComposer(cwd, sessionId, text);
  if (!text.trim() || text.length > MAX_LOG_DRAFT_CHARACTERS)
    throw new Error("Choose a smaller log selection before adding it to the draft.");
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const { emitTo } = await import("@tauri-apps/api/event");
  const sender = getCurrentWebviewWindow();
  const id = crypto.randomUUID();
  let unlisten: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("Open the target conversation composer before adding logs.")),
        2500,
      );
      void sender
        .listen<{ id: string; accepted: boolean }>(`${DRAFT_EVENT}-ack`, ({ payload }) => {
          if (payload?.id !== id) return;
          if (payload.accepted === true) resolve();
          else reject(new Error("The target composer cannot accept logs right now."));
        })
        .then((stop) => {
          if (finished) {
            stop();
            return;
          }
          unlisten = stop;
          return emitTo(composerWindow, DRAFT_EVENT, {
            id,
            cwd,
            sessionId,
            text,
            replyTo: sender.label,
          });
        })
        .catch(reject);
    });
  } finally {
    finished = true;
    clearTimeout(timer);
    unlisten?.();
  }
}

export function attachLogsToComposer(cwd: string, sessionId: string, text: string) {
  if (!text.trim() || text.length > MAX_LOG_DRAFT_CHARACTERS)
    throw new Error("Choose a smaller log selection before adding it to the draft.");
  const receiver = receivers.get(key(cwd, sessionId));
  if (!receiver) throw new Error("Open the target conversation composer before adding logs.");
  if (!receiver(text)) throw new Error("The target composer cannot accept logs right now.");
}
