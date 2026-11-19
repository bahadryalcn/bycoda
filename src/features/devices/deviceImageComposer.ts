import { invoke } from "@tauri-apps/api/core";
import { readBinaryFile } from "../../platform/tauri/fs";
import type { HostToolTarget } from "../connections/model/hostToolTarget";
import type { Attachment } from "../sessions/model/session";
import type { DeviceFrame, DeviceSummary } from "./types";
import {
  DeviceImageDraftChangedError,
  DeviceImageDraftDeliveryUncertainError,
  DeviceImageDraftRejectedError,
  DeviceImageTransferReceipts,
  deviceImageTransferBinding,
  deviceImageTransferDigest,
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

/** Everything about a screenshot except its bytes; the operation fingerprint binds this. */
type DeviceImageContext = Omit<DeviceImageDraft, "frame"> & {
  frame: Omit<DeviceFrame, "base64">;
};
/**
 * The bytes cross windows as one stored attachment file, never as inline base64.
 * `digest` identifies the encoded frame the source validated; `size` is its decoded length.
 */
type StoredScreenshot = { path: string; size: number; digest: string };
type DeviceImageTransferDraft = DeviceImageContext & { file: StoredScreenshot };

type Receiver = (file: Attachment, context: string) => boolean;
type DraftRequest = {
  operation: DeviceImageTransferOperation;
  attemptId: string;
  mode: "attach" | "receipt";
  image?: DeviceImageTransferDraft;
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
    /** Stored screenshot this source wrote and still owns; cleared once the outcome is definite. */
    storedPath?: string;
  }
>();
const MAX_BASE64_LENGTH = Math.ceil(MAX_DEVICE_SCREENSHOT_BYTES / 3) * 4;
const STORED_SCREENSHOT_NAME = /^\d+-\d+-device-screen\.(?:png|jpg)$/;
const key = (cwd: string, sessionId: string) => JSON.stringify([cwd, sessionId]);
const validText = (value: unknown, max: number, empty = false): value is string =>
  typeof value === "string" &&
  (empty || !!value.trim()) &&
  value.length <= max &&
  !value.includes("\0");

/** Validates and bounds everything except the image bytes. */
function deviceContext(image: DeviceImageContext | undefined): DeviceImageContext {
  const device = image?.device;
  const computer = image?.computer;
  const frame = image?.frame;
  const comment = image?.comment;
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
    !validText(comment, MAX_DEVICE_IMAGE_COMMENT, true)
  )
    throw new Error("Invalid device screenshot context.");
  if (
    !frame ||
    (frame.mime !== "image/png" && frame.mime !== "image/jpeg") ||
    !validText(frame.capturedAt, 128) ||
    !Number.isFinite(Date.parse(frame.capturedAt))
  )
    throw new Error("Invalid device screenshot.");
  // Only documented metadata crosses the app-window boundary. Image contents and
  // device names are evidence for the draft, never authority to send a message.
  return {
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
    frame: { mime: frame.mime, capturedAt: frame.capturedAt },
    comment,
  };
}

const screenshotName = (mime: DeviceFrame["mime"]) =>
  mime === "image/png" ? "device-screen.png" : "device-screen.jpg";

/** The attachment draft text: the context line, then the owner's note. */
function deviceImageText(context: DeviceImageContext): string {
  return [
    deviceImageContextLine(context),
    ...(context.comment.trim() ? ["", context.comment] : []),
  ].join("\n");
}

function hasImageSignature(mime: DeviceFrame["mime"], bytes: ArrayLike<number>): boolean {
  const signature =
    mime === "image/png" ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] : [0xff, 0xd8, 0xff];
  return signature.every((byte, index) => bytes[index] === byte);
}

/**
 * Validates an inline frame without decoding it: the length cap, the base64 tail and the
 * magic bytes of its first few characters. Returns the decoded byte count.
 * shortcut: the middle of the string is not scanned here. Storing it for another window
 * is decoded strictly by the native write_attachment, and the receiving window checks the
 * stored bytes; upgrade if an inline frame ever reaches a consumer without either step.
 */
function inlineScreenshotSize(frame: DeviceFrame): number {
  const data = frame.base64;
  if (
    typeof data !== "string" ||
    !data.length ||
    data.length > MAX_BASE64_LENGTH ||
    data.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]{2}(?:[A-Za-z0-9+/]{2}|[A-Za-z0-9+/]=|==)$/.test(data.slice(-4))
  )
    throw new Error("Invalid device screenshot.");
  let head: Uint8Array;
  try {
    head = Uint8Array.from(atob(data.slice(0, 16)), (char) => char.charCodeAt(0));
  } catch {
    throw new Error("Invalid device screenshot.");
  }
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const size = (data.length / 4) * 3 - padding;
  if (size > MAX_DEVICE_SCREENSHOT_BYTES || !hasImageSignature(frame.mime, head))
    throw new Error("Invalid device screenshot.");
  return size;
}

function isStoredScreenshotPath(path: string): boolean {
  const parts = path.split(/[\\/]/);
  return (
    parts.length >= 2 &&
    !parts.includes("..") &&
    parts[parts.length - 2] === "bycoda-attachments" &&
    STORED_SCREENSHOT_NAME.test(parts[parts.length - 1])
  );
}

/** A reference received from another window is data, never authority to read a path. */
function storedScreenshot(value: StoredScreenshot | undefined): StoredScreenshot {
  if (
    !value ||
    !validText(value.path, 16_384) ||
    !isStoredScreenshotPath(value.path) ||
    !Number.isSafeInteger(value.size) ||
    value.size < 1 ||
    value.size > MAX_DEVICE_SCREENSHOT_BYTES ||
    typeof value.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.digest)
  )
    throw new Error("Invalid device screenshot.");
  return { path: value.path, size: value.size, digest: value.digest };
}

/** Same-window attachment: the bytes never leave this window, so they stay inline. */
function inlineAttachment(
  context: DeviceImageContext,
  frame: DeviceFrame,
  size: number,
): { file: Attachment; text: string } {
  return {
    file: {
      id: crypto.randomUUID(),
      name: screenshotName(frame.mime),
      kind: "image",
      mimeType: frame.mime,
      size,
      data: frame.base64,
    },
    text: deviceImageText(context),
  };
}

/**
 * One readable line of draft text for the agent: which device, where, and when. Device and
 * computer names are owner-visible evidence, so the line labels itself untrusted and keeps
 * every value on that line.
 */
function deviceImageContextLine({ device, computer, frame }: DeviceImageContext): string {
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
        const context = deviceContext(payload.image);
        const stored = storedScreenshot(payload.image?.file);
        if ((await fingerprint(operation, context, stored)) !== operation.fingerprint)
          result = "conflict";
        // A replayed request is answered from its receipt without reading the file again.
        else if (result === undefined)
          result = await applyStoredImage(
            operation,
            context,
            stored,
            receive,
            () => receivers.get(key(cwd, sessionId)) === receive,
          );
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

/**
 * Reads the stored screenshot natively as bytes, checks it is the image the source
 * described, then hands it to the draft. A file that cannot be read was never attached.
 */
async function applyStoredImage(
  operation: DeviceImageTransferOperation,
  context: DeviceImageContext,
  stored: StoredScreenshot,
  receive: Receiver,
  owns: () => boolean,
): Promise<DeviceImageTransferResult> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await readBinaryFile(stored.path);
  } catch {
    return "rejected";
  }
  if (bytes.byteLength !== stored.size || !hasImageSignature(context.frame.mime, bytes))
    throw new Error("Invalid device screenshot.");
  // Reading yields. Recheck receiver ownership before touching the draft.
  if (!owns()) return "unknown";
  const previewUrl = URL.createObjectURL(new Blob([bytes], { type: context.frame.mime }));
  const file: Attachment = {
    id: crypto.randomUUID(),
    name: screenshotName(context.frame.mime),
    kind: "image",
    mimeType: context.frame.mime,
    size: bytes.byteLength,
    path: stored.path,
    previewUrl,
  };
  let handed = false;
  const result = receipts.apply(operation, () => {
    handed = true;
    return receive(file, deviceImageText(context));
  });
  // A receiver that threw may already hold the attachment; only a definite refusal frees it.
  if (!handed || result === "rejected") URL.revokeObjectURL(previewUrl);
  return result;
}

function fingerprint(
  operation: Pick<
    DeviceImageTransferOperation,
    "sourceWindow" | "destinationWindow" | "cwd" | "sessionId"
  >,
  context: DeviceImageContext,
  content: Pick<StoredScreenshot, "size" | "digest">,
) {
  return deviceImageTransferFingerprint({
    sourceWindow: operation.sourceWindow,
    destinationWindow: operation.destinationWindow,
    cwd: operation.cwd,
    sessionId: operation.sessionId,
    image: context,
    content: { size: content.size, digest: content.digest },
  });
}

/** Screenshot bytes are written once by the native attachment store, off this thread. */
async function storeScreenshot(frame: DeviceFrame): Promise<string> {
  const path = await invoke<string>("write_attachment", {
    name: screenshotName(frame.mime),
    data: frame.base64,
  });
  if (!path?.trim()) throw new Error("Screenshot storage returned no file path.");
  return path;
}

function discardStoredScreenshot(path: string) {
  void invoke("delete_path", { path }).catch(() => undefined);
}

/** Frees the stored file only once the destination definitely did not take it. */
function settleStoredScreenshot(
  entry: { storedPath?: string } | undefined,
  result: DeviceImageTransferResult,
) {
  if (!entry?.storedPath || result === "unknown") return;
  if (result !== "accepted") discardStoredScreenshot(entry.storedPath);
  entry.storedPath = undefined;
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
  const context = deviceContext(image);
  const { file, text } = inlineAttachment(context, image.frame, inlineScreenshotSize(image.frame));
  const receiver = receivers.get(key(cwd, sessionId));
  if (!receiver) throw new Error("Open the originating conversation before adding the screenshot.");
  if (!receiver(file, text))
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
  const context = deviceContext(image);
  const frame: DeviceFrame = image.frame;
  const size = inlineScreenshotSize(frame);
  // Hashed natively as one string: no decode, no JSON copy of the frame, no regex scan.
  const digest = await deviceImageTransferDigest(frame.base64);
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
  const payloadFingerprint = await fingerprint(scope, context, { size, digest });
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
  const entry: NonNullable<ReturnType<typeof outgoing.get>> = { operation, result: "unknown" };
  outgoing.set(operation.id, entry);
  const local = receivers.get(key(cwd, sessionId));
  if (destinationWindow === sourceWindow && local) {
    const { file, text } = inlineAttachment(context, frame, size);
    entry.result = receipts.apply(operation, () => local(file, text));
    return acceptResult(operation, entry.result);
  }
  if (!native) {
    outgoing.delete(operation.id);
    throw new Error("Open the originating conversation before adding the screenshot.");
  }
  try {
    // Written once per operation. Retries only reconcile and never store the bytes again.
    entry.storedPath = await storeScreenshot(frame);
    entry.result = await exchange(operation, "attach", {
      ...context,
      file: { path: entry.storedPath, size, digest },
    });
  } catch (cause) {
    if (!(cause instanceof DeviceImageDraftDeliveryUncertainError)) {
      outgoing.delete(operation.id);
      // Nothing was handed over (or the destination reported no receipt): free the file.
      if (entry.storedPath) discardStoredScreenshot(entry.storedPath);
    }
    throw cause;
  }
  settleStoredScreenshot(entry, entry.result);
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
    settleStoredScreenshot(entry, receipt);
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
  settleStoredScreenshot(entry, result);
  acceptResult(operation, result);
}

async function exchange(
  operation: DeviceImageTransferOperation,
  mode: DraftRequest["mode"],
  image?: DeviceImageTransferDraft,
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
