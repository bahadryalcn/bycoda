import { isRemoteProvider, type HostCommand } from "./protocol";
import { RUNTIME_MODES } from "../../sessions/public/session";

export type AttachmentCommand =
  | HostCommand
  | NonNullable<Extract<HostCommand, { type: "create" }>["firstTurn"]>;

export type PendingEntry = {
  v?: 1;
  savedAt?: number;
  command: HostCommand;
  shellId?: string;
  followup?: HostCommand;
  stopRequested?: boolean;
};
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): boolean =>
  object(value) && Object.values(value).every((v) => typeof v === "string");
const optionalString = (value: unknown) => value === undefined || typeof value === "string";

export function validCommand(value: unknown, followup = false): value is HostCommand {
  if (!object(value) || typeof value.commandId !== "string" || !value.commandId) return false;
  if (
    value.authorityGeneration !== undefined &&
    (!Number.isSafeInteger(value.authorityGeneration) || Number(value.authorityGeneration) < 1)
  )
    return false;
  if (value.type === "create") {
    return (
      typeof value.projectId === "string" &&
      !!value.projectId &&
      isRemoteProvider(value.harness) &&
      typeof value.model === "string" &&
      RUNTIME_MODES.includes(value.runtimeMode as never) &&
      (value.modelSettings === undefined || strings(value.modelSettings)) &&
      optionalString(value.worktreeCwd) &&
      optionalString(value.autoWorktreeBranch) &&
      (value.firstTurn === undefined ||
        (object(value.firstTurn) &&
          ["send", "draft"].includes(String(value.firstTurn.type)) &&
          optionalString(value.firstTurn.sessionId) &&
          validCommand({ ...value.firstTurn, sessionId: "" }, true)))
    );
  }
  if (
    typeof value.sessionId !== "string" ||
    (!value.sessionId && !(followup && (value.type === "send" || value.type === "draft")))
  )
    return false;
  if (value.resumeAtReset !== undefined && typeof value.resumeAtReset !== "boolean") return false;
  switch (value.type) {
    case "contextual":
      return (
        typeof value.sourceBlockId === "string" &&
        !!value.sourceBlockId &&
        Number.isSafeInteger(value.expectedRevision) &&
        Number(value.expectedRevision) >= 0 &&
        ["handoff", "secondOpinion"].includes(String(value.mode)) &&
        isRemoteProvider(value.harness) &&
        typeof value.model === "string" &&
        !!value.model &&
        strings(value.modelSettings) &&
        typeof value.previewDigest === "string" &&
        /^[a-f0-9]{64}$/.test(value.previewDigest)
      );
    case "configure":
      return (
        (value.providerAccountId === undefined ||
          value.providerAccountId === null ||
          typeof value.providerAccountId === "string") &&
        (value.harness === undefined || isRemoteProvider(value.harness)) &&
        typeof value.model === "string" &&
        strings(value.modelSettings) &&
        RUNTIME_MODES.includes(value.runtimeMode as never)
      );
    case "compact":
      return true;
    case "send":
    case "draft":
      return (
        typeof value.text === "string" &&
        (value.attachments === undefined ||
          (Array.isArray(value.attachments) &&
            value.attachments.every(
              (a) =>
                object(a) &&
                typeof a.id === "string" &&
                !!a.id &&
                typeof a.name === "string" &&
                typeof a.mimeType === "string" &&
                ["image", "audio", "file"].includes(a.kind as string) &&
                typeof a.size === "number" &&
                Number.isFinite(a.size) &&
                a.size >= 0,
            ))) &&
        (value.intent === undefined ||
          ["default", "plan", "build"].includes(value.intent as string)) &&
        optionalString(value.draftBlockId) &&
        optionalString(value.planBlockId) &&
        optionalString(value.expectedPlanText)
      );
    case "removeDraft":
      return typeof value.draftBlockId === "string" && !!value.draftBlockId;
    case "shell":
      return typeof value.line === "string";
    case "usageLimit":
      return ["arm", "disarm", "dismiss"].includes(value.action as string);
    case "steer":
      return (
        typeof value.runId === "string" &&
        !!value.runId &&
        typeof value.text === "string" &&
        validCommand({ ...value, type: "send" })
      );
    case "cancel":
      return typeof value.runId === "string" && !!value.runId;
    case "stopItem":
      return [value.runId, value.blockId, value.callId].every(
        (entry) => typeof entry === "string" && !!entry,
      );
    case "approve":
    case "answer": {
      if (
        typeof value.runId !== "string" ||
        !value.runId ||
        !Number.isSafeInteger(value.requestId) ||
        (value.requestId as number) < 0
      )
        return false;
      if (value.type === "approve") return value.decision === "allow" || value.decision === "deny";
      const reply = value.reply;
      return (
        object(reply) &&
        (reply.kind === "skipped" ||
          (reply.kind === "answered" &&
            object(reply.answers) &&
            Object.values(reply.answers).every(
              (a) => Array.isArray(a) && a.every((s) => typeof s === "string"),
            ) &&
            (reply.custom === undefined || strings(reply.custom))))
      );
    }
    default:
      return false;
  }
}

export function readPendingEntry(value: string, id: string): PendingEntry | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!object(parsed)) return;
    const entry = "command" in parsed ? parsed : { command: parsed };
    if (entry.v !== undefined && entry.v !== 1) return;
    if (
      entry.savedAt !== undefined &&
      (typeof entry.savedAt !== "number" ||
        !Number.isFinite(entry.savedAt) ||
        entry.savedAt <= 0 ||
        Date.now() - entry.savedAt >= 6 * 24 * 60 * 60 * 1000)
    )
      return;
    if (
      !validCommand(entry.command) ||
      entry.command.commandId !== id ||
      !optionalString(entry.shellId)
    )
      return;
    if (entry.stopRequested !== undefined && typeof entry.stopRequested !== "boolean") return;
    if (
      entry.followup !== undefined &&
      (entry.command.type !== "create" ||
        !validCommand(entry.followup, true) ||
        (entry.followup.type !== "send" && entry.followup.type !== "draft"))
    )
      return;
    return entry as PendingEntry;
  } catch {
    return;
  }
}
