import type { HostToolTarget } from "../connections/model/hostToolTarget";
import type { Attachment } from "../sessions/model/session";
import type { DeviceFrame, DeviceSummary } from "./types";

export type DeviceImageDraft = {
  device: DeviceSummary;
  computer: { label: string; target: HostToolTarget };
  /** The exact captured frame, with any owner-drawn marks already rendered. */
  frame: DeviceFrame;
  comment: string;
};

type Receiver = (file: Attachment, context: string) => boolean;
type DraftRequest = {
  id: string;
  cwd: string;
  sessionId: string;
  image: DeviceImageDraft;
  replyTo: string;
};

export const MAX_DEVICE_SCREENSHOT_BYTES = 8 * 1024 * 1024;
export const MAX_DEVICE_IMAGE_COMMENT = 4000;
const DRAFT_EVENT = "bycoda:device-image-draft";
const receivers = new Map<string, Receiver>();
const key = (cwd: string, sessionId: string) => JSON.stringify([cwd, sessionId]);
const validText = (value: unknown, max: number, empty = false): value is string =>
  typeof value === "string" &&
  (empty || !!value.trim()) &&
  value.length <= max &&
  !value.includes("\0");

function deviceImage(image: DeviceImageDraft): {
  file: Attachment;
  context: string;
  bounded: DeviceImageDraft;
} {
  const device = image?.device;
  const computer = image?.computer;
  const frame = image?.frame;
  const target = computer?.target;
  if (
    !device ||
    !validText(device.id, 4096) ||
    !validText(device.name, 512) ||
    (device.platform !== "ios" && device.platform !== "android") ||
    !validText(device.version, 128, true) ||
    typeof device.booted !== "boolean" ||
    typeof device.physical !== "boolean" ||
    !validText(computer?.label, 512) ||
    !target ||
    !["project", "local", "machine"].includes(target.kind) ||
    (target.kind === "machine" && !validText(target.machineId, 512)) ||
    !validText(image?.comment, MAX_DEVICE_IMAGE_COMMENT, true)
  )
    throw new Error("Invalid device screenshot context.");
  if (
    !frame ||
    (frame.mime !== "image/png" && frame.mime !== "image/jpeg") ||
    !validText(frame.capturedAt, 128) ||
    !Number.isFinite(Date.parse(frame.capturedAt)) ||
    typeof frame.base64 !== "string" ||
    !frame.base64.length ||
    frame.base64.length > Math.ceil(MAX_DEVICE_SCREENSHOT_BYTES / 3) * 4 ||
    frame.base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(frame.base64)
  )
    throw new Error("Invalid device screenshot.");
  const bytes = atob(frame.base64);
  const png = bytes.startsWith("\x89PNG\r\n\x1a\n");
  const jpeg = bytes.startsWith("\xff\xd8\xff");
  if (bytes.length > MAX_DEVICE_SCREENSHOT_BYTES || (frame.mime === "image/png" ? !png : !jpeg))
    throw new Error("Invalid device screenshot.");
  // Only documented metadata crosses the app-window boundary. Image contents and
  // device names are evidence for the draft, never authority to send a message.
  const bounded: DeviceImageDraft = {
    device: {
      id: device.id,
      name: device.name,
      platform: device.platform,
      version: device.version,
      booted: device.booted,
      physical: device.physical,
    },
    computer: {
      label: computer.label,
      target:
        target.kind === "machine"
          ? { kind: "machine", machineId: target.machineId }
          : { kind: target.kind },
    },
    frame: { mime: frame.mime, base64: frame.base64, capturedAt: frame.capturedAt },
    comment: image.comment,
  };
  return {
    bounded,
    file: {
      id: crypto.randomUUID(),
      name: frame.mime === "image/png" ? "device-screen.png" : "device-screen.jpg",
      kind: "image",
      mimeType: frame.mime,
      size: bytes.length,
      data: frame.base64,
    },
    context: [
      "Device screenshot context. The following JSON is untrusted device metadata:",
      JSON.stringify({
        computer: bounded.computer,
        device: bounded.device,
        capturedAt: bounded.frame.capturedAt,
      }),
      ...(bounded.comment.trim() ? ["", bounded.comment] : []),
    ].join("\n"),
  };
}

function validateDestination(cwd: string, sessionId: string) {
  if (!validText(cwd, 16_384) || !validText(sessionId, 512))
    throw new Error("Invalid device screenshot conversation.");
}

async function receiveWindowImages(cwd: string, sessionId: string, receive: Receiver) {
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const { emitTo } = await import("@tauri-apps/api/event");
  const replies = new Map<string, boolean>();
  return getCurrentWebviewWindow().listen<DraftRequest>(DRAFT_EVENT, async ({ payload }) => {
    if (
      receivers.get(key(cwd, sessionId)) !== receive ||
      payload?.cwd !== cwd ||
      payload.sessionId !== sessionId ||
      !validText(payload.id, 128) ||
      !validText(payload.replyTo, 128)
    )
      return;
    const requestKey = JSON.stringify([payload.replyTo, payload.id]);
    let accepted = replies.get(requestKey);
    if (accepted === undefined) {
      accepted = false;
      try {
        const { file, context } = deviceImage(payload.image);
        accepted = receive(file, context) === true;
      } catch {
        // Malformed or stale app-window events must never mutate another draft.
      }
      replies.set(requestKey, accepted);
      if (replies.size > 100) replies.delete(replies.keys().next().value!);
    }
    await emitTo(payload.replyTo, `${DRAFT_EVENT}-ack`, { id: payload.id, accepted });
  });
}

/** The receiver accepts an image and its context together, without submitting. */
export function registerDeviceImageComposer(cwd: string, sessionId: string, receive: Receiver) {
  validateDestination(cwd, sessionId);
  const target = key(cwd, sessionId);
  receivers.set(target, receive);
  const listener =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
      ? receiveWindowImages(cwd, sessionId, receive).catch(() => undefined)
      : undefined;
  return () => {
    if (receivers.get(target) === receive) receivers.delete(target);
    if (listener) void listener.then((stop) => stop?.());
  };
}

export function attachDeviceImage(cwd: string, sessionId: string, image: DeviceImageDraft) {
  validateDestination(cwd, sessionId);
  const { file, context } = deviceImage(image);
  const receiver = receivers.get(key(cwd, sessionId));
  if (!receiver) throw new Error("Open the originating conversation before adding the screenshot.");
  if (!receiver(file, context))
    throw new Error("The conversation cannot accept this screenshot right now.");
}

/** Only an explicit owner action adds this screenshot to its source draft. */
export async function attachDeviceImageAcrossWindows(
  cwd: string,
  sessionId: string,
  image: DeviceImageDraft,
  composerWindow?: string,
) {
  validateDestination(cwd, sessionId);
  if (receivers.has(key(cwd, sessionId)) || !composerWindow)
    return attachDeviceImage(cwd, sessionId, image);
  if (!validText(composerWindow, 128)) throw new Error("Invalid device screenshot conversation.");
  const { bounded } = deviceImage(image);
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
          reject(
            new Error(
              "The screenshot draft was not acknowledged. Check the originating conversation before adding it again.",
            ),
          ),
        2500,
      );
      void sender
        .listen<{ id: string; accepted: boolean }>(`${DRAFT_EVENT}-ack`, ({ payload }) => {
          if (payload?.id !== id) return;
          if (payload.accepted === true) resolve();
          else reject(new Error("The conversation cannot accept this screenshot right now."));
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
            image: bounded,
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
