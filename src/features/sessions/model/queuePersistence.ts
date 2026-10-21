import { removeAttachmentFromText } from "./attachmentTokens";
import { REMOTE_PROVIDERS as HARNESSES } from "../../connections/model/protocol";
import type { Attachment, AttachmentKind, ModelTarget, QueuedMessage, TurnIntent } from "./session";
import { parseBrowserAnnotation } from "../../../shared/lib/browserAnnotation";

/**
 * Queued follow-ups survive an app restart. What is saved is the message as
 * the queue holds it: text, order, intent and cards, and each attachment as far
 * as it can be brought back. A file attachment is a path on disk, so only the
 * path is saved and it is checked again on restore. A pasted image has nothing
 * but its base64 payload (the object URL dies with the process), so the payload
 * is saved while it is small enough to keep in the store.
 */

/** Base64 characters; about 4.5 MB of image. Larger pastes are marked missing. */
export const MAX_PERSISTED_ATTACHMENT_CHARS = 6_000_000;

const INTENTS: TurnIntent[] = ["default", "plan", "build", "orchestrate"];
const KINDS: AttachmentKind[] = ["image", "audio", "file"];

function persistableAttachment(file: Attachment): Attachment {
  const base = {
    id: file.id,
    ...(file.hostEnvironmentId ? { hostEnvironmentId: file.hostEnvironmentId } : {}),
    name: file.name,
    mimeType: file.mimeType,
    kind: file.kind,
    size: file.size,
    ...(file.browserAnnotation ? { browserAnnotation: file.browserAnnotation } : {}),
  };
  if (file.path) {
    return { ...base, path: file.path, ...(file.missing ? { missing: true } : {}) };
  }
  if (file.data && file.data.length <= MAX_PERSISTED_ATTACHMENT_CHARS) {
    return { ...base, data: file.data };
  }
  // Nothing on disk and nothing small enough to keep: it cannot come back.
  return { ...base, missing: true };
}

/** The queue as written to the store, or null when there is nothing to keep. */
export function persistableQueue(queue: QueuedMessage[] | undefined): QueuedMessage[] | null {
  if (!queue?.length) return null;
  return queue.map((message) => ({
    id: message.id,
    text: message.text,
    ...(message.deliveryUnknown ? { deliveryUnknown: true as const } : {}),
    attachments: message.attachments.map(persistableAttachment),
    ...(message.noteCard ? { noteCard: message.noteCard } : {}),
    ...(message.handoffCard ? { handoffCard: message.handoffCard } : {}),
    ...(message.intent ? { intent: message.intent } : {}),
    ...(message.modelTarget
      ? {
          modelTarget: {
            ...message.modelTarget,
            modelSettings: { ...message.modelTarget.modelSettings },
          },
        }
      : {}),
  }));
}

function restoreAttachment(raw: unknown): Attachment | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<Attachment>;
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.mimeType !== "string" ||
    typeof value.size !== "number" ||
    !KINDS.includes(value.kind as AttachmentKind)
  ) {
    return null;
  }
  let browserAnnotation: Attachment["browserAnnotation"];
  if (value.browserAnnotation !== undefined) {
    try {
      browserAnnotation = parseBrowserAnnotation(value.browserAnnotation);
    } catch {
      return null;
    }
  }
  return {
    id: value.id,
    ...(typeof value.hostEnvironmentId === "string"
      ? { hostEnvironmentId: value.hostEnvironmentId }
      : {}),
    name: value.name,
    mimeType: value.mimeType,
    kind: value.kind as AttachmentKind,
    size: value.size,
    ...(browserAnnotation ? { browserAnnotation } : {}),
    ...(typeof value.path === "string" && value.path ? { path: value.path } : {}),
    ...(typeof value.data === "string" && value.data ? { data: value.data } : {}),
    ...(value.missing === true ? { missing: true } : {}),
  };
}

/** Validate what the store returned. A row that does not fit is dropped, never thrown. */
export function restoreQueuedMessages(raw: unknown): QueuedMessage[] {
  if (!Array.isArray(raw)) return [];
  const restored: QueuedMessage[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const value = entry as Partial<QueuedMessage>;
    if (typeof value.id !== "string" || typeof value.text !== "string") continue;
    const target = value.modelTarget as Partial<ModelTarget> | undefined;
    if (
      target !== undefined &&
      (!target ||
        !HARNESSES.includes(target.harness!) ||
        typeof target.model !== "string" ||
        !target.model ||
        !target.modelSettings ||
        typeof target.modelSettings !== "object" ||
        Array.isArray(target.modelSettings) ||
        Object.values(target.modelSettings).some((setting) => typeof setting !== "string"))
    )
      continue;
    const attachments = (Array.isArray(value.attachments) ? value.attachments : [])
      .map(restoreAttachment)
      .filter((file): file is Attachment => file != null);
    if (!value.text.trim() && attachments.length === 0 && !value.noteCard && !value.handoffCard) {
      continue;
    }
    restored.push({
      id: value.id,
      text: value.text,
      ...(value.deliveryUnknown === true ? { deliveryUnknown: true as const } : {}),
      attachments,
      ...(target
        ? {
            modelTarget: {
              harness: target.harness!,
              model: target.model!,
              modelSettings: { ...target.modelSettings! },
            },
          }
        : {}),
      ...(value.noteCard && typeof value.noteCard === "object" ? { noteCard: value.noteCard } : {}),
      ...(value.handoffCard && typeof value.handoffCard === "object"
        ? { handoffCard: value.handoffCard }
        : {}),
      ...(value.intent && INTENTS.includes(value.intent) ? { intent: value.intent } : {}),
    });
  }
  return restored;
}

/**
 * Flag attachments whose file no longer exists. `existing` answers, for a list
 * of paths, which of them are still there; it is injected so this stays pure.
 */
export async function markMissingAttachments(
  queue: QueuedMessage[],
  existing: (paths: string[]) => Promise<Set<string>>,
): Promise<QueuedMessage[]> {
  const paths = queue.flatMap((message) =>
    message.attachments.flatMap((file) =>
      file.path && !file.hostEnvironmentId ? [file.path] : [],
    ),
  );
  if (paths.length === 0) return queue;
  const present = await existing([...new Set(paths)]).catch(() => null);
  // Could not ask: keep the attachments as they were rather than condemn them.
  if (!present) return queue;
  return queue.map((message) => {
    if (
      !message.attachments.some(
        (file) =>
          file.path && !file.hostEnvironmentId && Boolean(file.missing) !== !present.has(file.path),
      )
    ) {
      return message;
    }
    return {
      ...message,
      attachments: message.attachments.map((file) =>
        file.path && !file.hostEnvironmentId
          ? { ...file, missing: !present.has(file.path) || undefined }
          : file,
      ),
    };
  });
}

/** A row with a gone attachment is held back: sending it would leave a dangling `[image1]`. */
export function hasMissingAttachment(message: QueuedMessage): boolean {
  return message.attachments.some((file) => file.missing);
}

/**
 * The message with its gone attachments taken out, and their tokens with them
 * (the ones left behind are renumbered). Used when the user edits the row.
 */
export function withoutMissingAttachments(
  message: QueuedMessage,
  text = message.text,
): QueuedMessage {
  let files = message.attachments;
  let next = text;
  for (let index = files.length - 1; index >= 0; index -= 1) {
    if (!files[index].missing) continue;
    next = removeAttachmentFromText(next, files, index);
    files = files.filter((_, i) => i !== index);
  }
  return { ...message, text: next, attachments: files };
}
