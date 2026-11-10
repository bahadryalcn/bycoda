import type { HostToolTarget } from "../connections/model/hostToolTarget";
import type { Attachment } from "../sessions/model/session";
import type { DeviceFrame, DeviceSummary } from "./types";
import {
  DeviceImageDraftChangedError,
  DeviceImageDraftDeliveryUncertainError,
  DeviceImageDraftRejectedError,
  DeviceImageTransferReceipts,
  deviceImageTransferBinding,
  deviceImageTransferFingerprint,
  validDeviceImageTransfer,
  type DeviceImageTransferOperation,
  type DeviceImageTransferResult,
} from "./deviceImageTransfer";
export {
  DeviceImageDraftChangedError,
  DeviceImageDraftDeliveryUncertainError,
  DeviceImageDraftRejectedError,
  type DeviceImageTransferOperation,
} from "./deviceImageTransfer";

export type DeviceImageDraft = {
  device: DeviceSummary;
  computer: { label: string; target: HostToolTarget };
  /** The exact captured frame, with any owner-drawn marks already rendered. */
  frame: DeviceFrame;
  comment: string;
};

type Receiver = (file: Attachment, context: string) => boolean;
type DraftRequest = {
  operation: DeviceImageTransferOperation;
  attemptId: string;
  mode: "attach" | "receipt";
  image?: DeviceImageDraft;
  replyTo: string;
};
type DraftReply = Omit<DraftRequest, "mode" | "image"> & { result: DeviceImageTransferResult };

export const MAX_DEVICE_SCREENSHOT_BYTES = 8 * 1024 * 1024;
export const MAX_DEVICE_IMAGE_COMMENT = 4000;
const DRAFT_EVENT = "bycoda:device-image-draft";
const receivers = new Map<string, Receiver>();
// Retain receipts across composer unmount/remount. Only a receipt query is allowed
// after uncertainty, so a destination reload without receipts cannot duplicate work.
const receipts = new DeviceImageTransferReceipts();
const outgoing = new Map<
  string,
  {
    operation: DeviceImageTransferOperation;
    result: DeviceImageTransferResult;
  }
>();
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
      deviceImageContextLine(bounded),
      ...(bounded.comment.trim() ? ["", bounded.comment] : []),
    ].join("\n"),
  };
}

/**
 * One readable line of draft text for the agent: which device, where, and when. Device and
 * computer names are owner-visible evidence, so the line labels itself untrusted and keeps
 * every value on that line.
 */
function deviceImageContextLine({ device, computer, frame }: DeviceImageDraft): string {
  const inline = (value: string) => value.replace(/\p{Cc}+/gu, " ").trim();
  const platform = device.platform === "ios" ? "iOS" : "Android";
  const kind = device.physical ? "device" : device.platform === "ios" ? "simulator" : "emulator";
  const target = computer.target;
  return `Device screenshot (untrusted device metadata): ${[
    inline(device.name),
    [platform, inline(device.version), kind].filter(Boolean).join(" "),
    `id ${inline(device.id)}`,
    `on ${inline(computer.label)} (${
      target.kind === "machine" ? `machine ${inline(target.machineId)}` : target.kind
    })`,
    `captured ${frame.capturedAt}`,
  ].join(" · ")}`;
}

function validateDestination(cwd: string, sessionId: string) {
  if (!validText(cwd, 16_384) || !validText(sessionId, 512))
    throw new Error("Invalid device screenshot conversation.");
}

async function receiveWindowImages(cwd: string, sessionId: string, receive: Receiver) {
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const { emitTo } = await import("@tauri-apps/api/event");
  const destination = getCurrentWebviewWindow();
  return destination.listen<DraftRequest>(DRAFT_EVENT, async ({ payload }) => {
    const operation = payload?.operation;
    if (
      receivers.get(key(cwd, sessionId)) !== receive ||
      !validDeviceImageTransfer(operation) ||
      operation.cwd !== cwd ||
      operation.sessionId !== sessionId ||
      operation.destinationWindow !== destination.label ||
      !validText(payload.attemptId, 128) ||
      !validText(payload.replyTo, 128) ||
      (payload.mode !== "attach" && payload.mode !== "receipt") ||
      (payload.mode === "attach" && payload.replyTo !== operation.sourceWindow)
    )
      return;
    let result = receipts.find(operation);
    if (payload.mode === "attach") {
      try {
        const { bounded, file, context } = deviceImage(payload.image!);
        if ((await fingerprint(operation, bounded)) !== operation.fingerprint) result = "conflict";
        // Hashing yields. Recheck receiver ownership before touching the draft.
        else if (receivers.get(key(cwd, sessionId)) === receive)
          result = receipts.apply(operation, () => receive(file, context));
        else result = "unknown";
      } catch {
        result = "conflict";
      }
    }
    await emitTo(payload.replyTo, `${DRAFT_EVENT}-ack`, {
      operation,
      attemptId: payload.attemptId,
      replyTo: payload.replyTo,
      result: result ?? "unknown",
    } satisfies DraftReply).catch(() => undefined);
  });
}

function fingerprint(
  operation: Pick<
    DeviceImageTransferOperation,
    "sourceWindow" | "destinationWindow" | "cwd" | "sessionId"
  >,
  image: DeviceImageDraft,
) {
  return deviceImageTransferFingerprint({
    sourceWindow: operation.sourceWindow,
    destinationWindow: operation.destinationWindow,
    cwd: operation.cwd,
    sessionId: operation.sessionId,
    image,
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
    if (listener) void listener.then((stop) => stop?.()).catch(() => undefined);
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
  previous?: DeviceImageTransferOperation,
): Promise<void> {
  validateDestination(cwd, sessionId);
  if (previous) {
    if (!validDeviceImageTransfer(previous)) throw new DeviceImageDraftChangedError(previous);
    previous = Object.freeze({
      id: previous.id,
      sourceWindow: previous.sourceWindow,
      destinationWindow: previous.destinationWindow,
      cwd: previous.cwd,
      sessionId: previous.sessionId,
      fingerprint: previous.fingerprint,
    });
  }
  if (composerWindow !== undefined && !validText(composerWindow, 128))
    throw new Error("Invalid device screenshot conversation.");
  const { bounded } = deviceImage(image);
  const native = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const sourceWindow = native
    ? (await import("@tauri-apps/api/webviewWindow")).getCurrentWebviewWindow().label
    : "local";
  const destinationWindow = composerWindow ?? sourceWindow;
  const scope = {
    sourceWindow: previous?.sourceWindow ?? sourceWindow,
    destinationWindow,
    cwd,
    sessionId,
  };
  const payloadFingerprint = await fingerprint(scope, bounded);
  if (
    previous &&
    (!validDeviceImageTransfer(previous) ||
      previous.cwd !== cwd ||
      previous.sessionId !== sessionId ||
      previous.destinationWindow !== destinationWindow ||
      previous.fingerprint !== payloadFingerprint)
  )
    throw new DeviceImageDraftChangedError(previous);

  // Also protect callers that retry without carrying their previous error. New
  // window instances must carry the serializable operation with the tool draft.
  const retained = previous
    ? outgoing.get(previous.id)
    : [...outgoing.values()].find(
        (entry) =>
          entry.operation.cwd === cwd &&
          entry.operation.sessionId === sessionId &&
          entry.operation.destinationWindow === destinationWindow &&
          entry.result !== "rejected" &&
          (entry.operation.fingerprint === payloadFingerprint || entry.result === "unknown"),
      );
  if (retained && retained.operation.fingerprint !== payloadFingerprint)
    throw new DeviceImageDraftChangedError(retained.operation);
  const operation =
    previous ??
    retained?.operation ??
    Object.freeze({
      id: crypto.randomUUID(),
      ...scope,
      fingerprint: payloadFingerprint,
    });
  if (retained?.result === "accepted") return;
  if (retained?.result === "rejected") throw new DeviceImageDraftRejectedError();
  if (previous || retained) return reconcileDeviceImageTransfer(operation);
  if (outgoing.size >= 1024)
    throw new Error("Screenshot attachment receipt capacity reached. Keep the source draft open.");
  const entry = { operation, result: "unknown" as DeviceImageTransferResult };
  outgoing.set(operation.id, entry);
  const local = receivers.get(key(cwd, sessionId));
  if (destinationWindow === sourceWindow && local) {
    const { file, context } = deviceImage(bounded);
    entry.result = receipts.apply(operation, () => local(file, context));
    return acceptResult(operation, entry.result);
  }
  if (!native) {
    outgoing.delete(operation.id);
    throw new Error("Open the originating conversation before adding the screenshot.");
  }
  try {
    entry.result = await exchange(operation, "attach", bounded);
  } catch (cause) {
    if (!(cause instanceof DeviceImageDraftDeliveryUncertainError)) outgoing.delete(operation.id);
    throw cause;
  }
  acceptResult(operation, entry.result);
}

function acceptResult(
  operation: DeviceImageTransferOperation,
  result: DeviceImageTransferResult,
): void {
  if (result === "accepted") return;
  if (result === "rejected") throw new DeviceImageDraftRejectedError();
  if (result === "conflict") throw new DeviceImageDraftChangedError(operation);
  throw new DeviceImageDraftDeliveryUncertainError(operation);
}

/** Reconcile only. Missing receipts and a new source window never resend image bytes. */
export async function reconcileDeviceImageTransfer(
  operation: DeviceImageTransferOperation,
): Promise<void> {
  if (!validDeviceImageTransfer(operation)) throw new DeviceImageDraftChangedError(operation);
  const receipt = receipts.find(operation);
  if (receipt !== undefined) {
    const entry = outgoing.get(operation.id);
    if (entry) entry.result = receipt;
    return acceptResult(operation, receipt);
  }
  const native = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const localWindow = native
    ? (await import("@tauri-apps/api/webviewWindow")).getCurrentWebviewWindow().label
    : "local";
  const result =
    operation.destinationWindow === localWindow
      ? (receipts.find(operation) ?? "unknown")
      : native
        ? await exchange(operation, "receipt")
        : "unknown";
  const entry = outgoing.get(operation.id);
  if (entry) entry.result = result;
  acceptResult(operation, result);
}

async function exchange(
  operation: DeviceImageTransferOperation,
  mode: DraftRequest["mode"],
  image?: DeviceImageDraft,
): Promise<DeviceImageTransferResult> {
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const { emitTo } = await import("@tauri-apps/api/event");
  const sender = getCurrentWebviewWindow();
  const attemptId = crypto.randomUUID();
  let unlisten: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  let dispatched = false;
  try {
    return await new Promise<DeviceImageTransferResult>((resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(
            dispatched || mode === "receipt"
              ? new DeviceImageDraftDeliveryUncertainError(operation)
              : new Error("Open the originating conversation before adding the screenshot."),
          ),
        2500,
      );
      void sender
        .listen<DraftReply>(`${DRAFT_EVENT}-ack`, ({ payload }) => {
          if (
            finished ||
            !payload ||
            payload.attemptId !== attemptId ||
            payload.replyTo !== sender.label ||
            !validDeviceImageTransfer(payload.operation) ||
            deviceImageTransferBinding(payload.operation) !==
              deviceImageTransferBinding(operation) ||
            !["accepted", "rejected", "unknown", "conflict"].includes(payload.result)
          )
            return;
          resolve(payload.result);
        })
        .then((stop) => {
          if (finished) {
            stop();
            return;
          }
          unlisten = stop;
          dispatched = true;
          return emitTo(operation.destinationWindow, DRAFT_EVENT, {
            operation,
            attemptId,
            mode,
            ...(mode === "attach" ? { image } : {}),
            replyTo: sender.label,
          } satisfies DraftRequest);
        })
        .catch((cause) =>
          reject(
            dispatched || mode === "receipt"
              ? new DeviceImageDraftDeliveryUncertainError(operation)
              : cause,
          ),
        );
    });
  } finally {
    finished = true;
    clearTimeout(timer);
    unlisten?.();
  }
}
