import type { Attachment } from "../sessions/model/session";
import {
  parseBrowserAnnotation,
  type BrowserAnnotationCapture,
} from "../../shared/lib/browserAnnotation";

type Receiver = (file: Attachment) => boolean;
const receivers = new Map<string, Receiver>();
const key = (cwd: string, sessionId: string) => JSON.stringify([cwd, sessionId]);
const DRAFT_EVENT = "bycoda:browser-selection-draft";
export const MAX_BROWSER_SCREENSHOT_BYTES = 2 * 1024 * 1024;
type DraftRequest = {
  id: string;
  cwd: string;
  sessionId: string;
  hostSessionId: string;
  capture: BrowserAnnotationCapture;
  comment: string;
  replyTo: string;
};

const validIdentity = (value: unknown, max = 512): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= max;

function selectionAttachment(
  hostSessionId: string,
  capture: BrowserAnnotationCapture,
  comment: string,
): Attachment {
  if (
    !validIdentity(hostSessionId) ||
    capture?.sessionId !== hostSessionId ||
    capture?.trust !== "untrusted-page-data"
  )
    throw new Error("Browser selection belongs to another conversation");
  const screenshot = capture.screenshot;
  if (
    !screenshot ||
    screenshot.mimeType !== "image/jpeg" ||
    typeof screenshot.data !== "string" ||
    !screenshot.data.length ||
    screenshot.data.length > Math.ceil(MAX_BROWSER_SCREENSHOT_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(screenshot.data) ||
    !Number.isFinite(screenshot.width) ||
    !Number.isFinite(screenshot.height) ||
    screenshot.width <= 0 ||
    screenshot.height <= 0 ||
    screenshot.width > 16_384 ||
    screenshot.height > 16_384 ||
    typeof comment !== "string"
  )
    throw new Error("Invalid browser screenshot");
  const size = atob(screenshot.data).length;
  if (size > MAX_BROWSER_SCREENSHOT_BYTES) throw new Error("Invalid browser screenshot");
  const { screenshot: _screenshot, ...annotation } = capture;
  const parsed = parseBrowserAnnotation({ ...annotation, comment: comment.slice(0, 4000) });
  return {
    id: crypto.randomUUID(),
    name: "browser-element.jpg",
    kind: "image",
    mimeType: screenshot.mimeType,
    size,
    data: screenshot.data,
    browserAnnotation: parsed,
  };
}

async function receiveWindowSelections(cwd: string, sessionId: string, receive: Receiver) {
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const { emitTo } = await import("@tauri-apps/api/event");
  return getCurrentWebviewWindow().listen<DraftRequest>(DRAFT_EVENT, async ({ payload }) => {
    if (
      receivers.get(key(cwd, sessionId)) !== receive ||
      payload?.cwd !== cwd ||
      payload.sessionId !== sessionId ||
      !validIdentity(payload.id, 128) ||
      !validIdentity(payload.replyTo, 128)
    )
      return;
    let accepted = false;
    try {
      if (typeof payload.comment !== "string" || payload.comment.length > 4000)
        throw new Error("Invalid browser annotation text");
      accepted = receive(
        selectionAttachment(payload.hostSessionId, payload.capture, payload.comment),
      );
    } catch {
      // Page content and cross-window data never grant attachment authority.
    }
    await emitTo(payload.replyTo, `${DRAFT_EVENT}-ack`, { id: payload.id, accepted });
  });
}

/** App-owned bridge; neither page scripts nor host tools send a prompt here. */
export function registerBrowserComposer(cwd: string, sessionId: string, receive: Receiver) {
  const target = key(cwd, sessionId);
  receivers.set(target, receive);
  const listener =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
      ? receiveWindowSelections(cwd, sessionId, receive).catch(() => undefined)
      : undefined;
  return () => {
    if (receivers.get(target) === receive) receivers.delete(target);
    if (listener) void listener.then((stop) => stop?.());
  };
}

/** An explicit tools action targets only the originating conversation's draft. */
export async function attachBrowserSelectionAcrossWindows(
  cwd: string,
  composerSessionId: string,
  hostSessionId: string,
  capture: BrowserAnnotationCapture,
  comment: string,
  composerWindow?: string,
) {
  if (receivers.has(key(cwd, composerSessionId)) || !composerWindow)
    return attachBrowserSelection(cwd, composerSessionId, hostSessionId, capture, comment);
  if (
    !validIdentity(cwd, 16_384) ||
    !validIdentity(composerSessionId) ||
    !validIdentity(composerWindow, 128)
  )
    throw new Error("Browser selection belongs to another conversation");
  const attachment = selectionAttachment(hostSessionId, capture, comment);
  const { comment: boundedComment, ...annotation } = attachment.browserAnnotation!;
  const boundedCapture: BrowserAnnotationCapture = {
    ...annotation,
    screenshot: {
      data: capture.screenshot.data,
      mimeType: capture.screenshot.mimeType,
      width: capture.screenshot.width,
      height: capture.screenshot.height,
    },
  };
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
        () =>
          reject(new Error("Open the target conversation composer before adding the selection")),
        2500,
      );
      void sender
        .listen<{ id: string; accepted: boolean }>(`${DRAFT_EVENT}-ack`, ({ payload }) => {
          if (payload?.id !== id) return;
          if (payload.accepted === true) resolve();
          else reject(new Error("The target composer cannot accept this attachment"));
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
            sessionId: composerSessionId,
            hostSessionId,
            capture: boundedCapture,
            comment: boundedComment,
            replyTo: sender.label,
          } satisfies DraftRequest);
        })
        .catch(reject);
    });
  } finally {
    finished = true;
    clearTimeout(timer);
    unlisten?.();
  }
}

export function attachBrowserSelection(
  cwd: string,
  composerSessionId: string,
  hostSessionId: string,
  capture: BrowserAnnotationCapture,
  comment: string,
) {
  const file = selectionAttachment(hostSessionId, capture, comment);
  const receiver = receivers.get(key(cwd, composerSessionId));
  if (!receiver)
    throw new Error("Open the target conversation composer before adding the selection");
  if (!receiver(file)) throw new Error("The target composer cannot accept this attachment");
}
