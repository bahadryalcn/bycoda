import type { UserQuestionReply } from "../../src/shared/model/userQuestion";
import { parseRemoteAttachments } from "../attachments/attachments";

/** Validate untrusted question answer payload before dispatch to a provider. */
export function parseQuestionReply(value: unknown): UserQuestionReply {
  const reply = value as
    | { kind?: string; answers?: unknown; custom?: unknown; notes?: unknown; attachments?: unknown }
    | undefined;
  if (reply?.kind === "skipped") return { kind: "skipped" };
  if (
    reply?.kind !== "answered" ||
    !reply.answers ||
    typeof reply.answers !== "object" ||
    Array.isArray(reply.answers)
  )
    throw new Error("Unsupported command");
  const entries = Object.entries(reply.answers);
  if (
    entries.length > 50 ||
    entries.some(
      ([key, value]) =>
        key.length > 200 ||
        !Array.isArray(value) ||
        value.length > 50 ||
        value.some((item) => typeof item !== "string" || item.length > 10_000),
    )
  )
    throw new Error("Invalid question answers");
  const parseTextRecord = (record: unknown, error: string, boundedKeys = false) => {
    if (record == null) return undefined;
    if (
      typeof record !== "object" ||
      Array.isArray(record) ||
      (boundedKeys && Object.entries(record).length > 50) ||
      Object.entries(record).some(
        ([key, item]) =>
          (boundedKeys && key.length > 200) || typeof item !== "string" || item.length > 10_000,
      )
    )
      throw new Error(error);
    return record as Record<string, string>;
  };
  const custom = parseTextRecord(reply.custom, "Invalid custom answers");
  const notes = parseTextRecord(reply.notes, "Invalid question notes", true);
  let attachments: Record<string, ReturnType<typeof parseRemoteAttachments>> | undefined;
  if (reply.attachments !== undefined) {
    if (
      !reply.attachments ||
      typeof reply.attachments !== "object" ||
      Array.isArray(reply.attachments)
    )
      throw new Error("Invalid question attachments");
    const files = Object.entries(reply.attachments);
    if (files.length > 50 || files.some(([key]) => key.length > 200))
      throw new Error("Invalid question attachments");
    let total = 0;
    for (const [, value] of files) {
      if (!Array.isArray(value)) throw new Error("Invalid question attachments");
      total += value.length;
      if (total > 20) throw new Error("Too many attachments");
    }
    attachments = Object.fromEntries(
      files.map(([key, value]) => [key, parseRemoteAttachments(value)]),
    );
  }
  return {
    kind: "answered",
    answers: Object.fromEntries(entries) as Record<string, string[]>,
    ...(custom ? { custom } : {}),
    ...(notes ? { notes } : {}),
    ...(attachments ? { attachments } : {}),
  };
}
