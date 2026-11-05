import { invoke } from "@tauri-apps/api/core";
import { t } from "../../../shared/i18n";
import type { Attachment } from "./session";
import type { UserQuestionPrompt } from "./userQuestion";
import { MAX_ATTACHMENTS, persistableAttachment } from "./attachments";

type Custody = {
  scope: string;
  sessionId: string;
  questionId: string;
  operationId: string;
  claimId: string;
};
export type QuestionDraftAttachment = Attachment & { questionCustody?: Custody };
export function questionTransportHeld(
  parentClosed: boolean,
  sending: boolean,
  localUnknown: boolean,
  delivery: UserQuestionPrompt["delivery"],
): boolean {
  return parentClosed || sending || localUnknown || delivery === "unknown" || delivery === "queued";
}
export function questionAttachmentIdentity(
  prompt: UserQuestionPrompt,
  questionId: string,
): string | null {
  const valid = (value: unknown): value is string =>
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 512 &&
    // oxlint-disable-next-line no-control-regex -- rejects control characters in untrusted question fields
    !/[\u0000-\u001f\u007f-\u009f]/.test(value);
  if (
    (!valid(prompt.occurrenceId) && !valid(prompt.providerTurnId)) ||
    !valid(questionId) ||
    !Number.isSafeInteger(prompt.requestId)
  )
    return null;
  if (
    (prompt.occurrenceId != null && !valid(prompt.occurrenceId)) ||
    (prompt.providerTurnId != null && !valid(prompt.providerTurnId)) ||
    (prompt.callId != null && !valid(prompt.callId))
  )
    return null;
  return JSON.stringify([
    prompt.occurrenceId ?? null,
    prompt.providerTurnId ?? null,
    prompt.callId ?? null,
    prompt.requestId,
    questionId,
  ]);
}
async function listOwnedDrafts(
  sessionId: string,
  questionId: string,
): Promise<Array<Record<string, unknown>>> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await invoke<Array<Record<string, unknown>>>("list_question_attachment_drafts", {
        sessionId,
        questionId,
      });
    } catch (error) {
      if (attempt >= 3 || !String(error).includes("Conversation ownership changed")) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
  }
}
export async function listQuestionAttachmentDrafts(
  sessionId: string,
  scope: string,
  prompt: UserQuestionPrompt,
): Promise<{ questionId: string; file: QuestionDraftAttachment; retained: boolean }[]> {
  const recovered: { questionId: string; file: QuestionDraftAttachment; retained: boolean }[] = [];
  for (const question of prompt.questions) {
    const questionId = questionAttachmentIdentity(prompt, question.id);
    if (!questionId) continue;
    const records = await listOwnedDrafts(sessionId, questionId);
    if (recovered.length + records.length > MAX_ATTACHMENTS)
      throw new Error("Question attachment recovery capacity exceeded");
    for (const record of records) {
      if (
        typeof record.fileId !== "string" ||
        typeof record.name !== "string" ||
        typeof record.mimeType !== "string" ||
        !["image", "audio", "file"].includes(String(record.kind)) ||
        !Number.isSafeInteger(record.size) ||
        Number(record.size) < 0 ||
        Number(record.size) > 20 * 1024 * 1024 ||
        typeof record.operationId !== "string" ||
        typeof record.claimId !== "string"
      )
        throw new Error("Question attachment draft is corrupt");
      recovered.push({
        questionId: question.id,
        file: {
          id: record.fileId,
          name: record.name,
          mimeType: record.mimeType,
          kind: record.kind as Attachment["kind"],
          size: Number(record.size),
          missing: true,
          questionCustody: {
            scope,
            sessionId,
            questionId,
            operationId: record.operationId,
            claimId: record.claimId,
          },
        },
        retained: record.retained === true,
      });
    }
  }
  return recovered;
}
export function pendingQuestionAttachment(
  file: Attachment,
  scope: string,
  sessionId: string,
  questionId: string | null,
): QuestionDraftAttachment {
  if (file.path?.trim()) return file;
  if (!questionId)
    throw new Error(
      t("Question attachment identity is unavailable. Text answers remain available."),
    );
  return {
    ...persistableAttachment(file),
    missing: true,
    questionCustody: {
      scope,
      sessionId,
      questionId,
      operationId: crypto.randomUUID(),
      claimId: crypto.randomUUID(),
    },
  };
}
const params = (owner: Custody) => ({
  scope: owner.scope,
  sessionId: owner.sessionId,
  questionId: owner.questionId,
  operationId: owner.operationId,
  receipt: owner.operationId,
  claimId: owner.claimId,
});
export async function prepareOwnedQuestionAttachment(
  file: Attachment,
  pending: QuestionDraftAttachment,
): Promise<QuestionDraftAttachment> {
  const owner = pending.questionCustody;
  if (!owner) return pending;
  if (file.data === undefined)
    throw new Error(t("Cannot attach {p0}: no file data is available.", { p0: file.name }));
  const identity = params(owner);
  await invoke("reserve_question_attachment", {
    ...identity,
    fileId: file.id,
    name: file.name,
    mimeType: file.mimeType,
    kind: file.kind,
    size: file.size,
  });
  const result = await invoke<{ state: string; path?: string }>("create_question_attachment", {
    ...identity,
    name: file.name,
    data: file.data,
  });
  if (result.state !== "created" || !result.path)
    throw new Error("Question attachment preparation requires recovery");
  return { ...persistableAttachment({ ...file, path: result.path }), questionCustody: owner };
}
export async function prepareOwnedQuestionAttachments(
  files: Attachment[],
  pending: QuestionDraftAttachment[],
  onError: (reason: unknown) => void,
): Promise<QuestionDraftAttachment[]> {
  return Promise.all(
    files.map(async (file, index) => {
      try {
        return await prepareOwnedQuestionAttachment(file, pending[index]);
      } catch (reason) {
        onError(reason);
        return pending[index];
      }
    }),
  );
}
export async function reconcileQuestionAttachment(
  file: QuestionDraftAttachment,
): Promise<QuestionDraftAttachment | null> {
  const owner = file.questionCustody;
  if (!owner) return file;
  const result = await invoke<{ state: string; path?: string }>(
    "read_question_attachment",
    params(owner),
  );
  if (result.state === "released") return null;
  if (result.state !== "created" || !result.path)
    throw new Error("Question attachment preparation requires recovery");
  if (!file.missing && file.path === result.path) return file;
  return { ...file, path: result.path, missing: undefined };
}
export async function retainQuestionAttachments(files: QuestionDraftAttachment[]): Promise<void> {
  for (const file of files)
    if (file.questionCustody)
      await invoke("retain_question_attachment", params(file.questionCustody));
}
export async function releaseQuestionAttachments(files: QuestionDraftAttachment[]): Promise<void> {
  for (const file of files)
    if (file.questionCustody) {
      const result = await invoke<{ state: string }>(
        "release_question_attachment",
        params(file.questionCustody),
      );
      if (result.state !== "released")
        throw new Error("Question attachment cleanup requires recovery");
    }
}
export function runQuestionAttachmentEffect(
  files: QuestionDraftAttachment[],
  action: "retain" | "release",
  commit: () => void,
  busy: (value: boolean) => void,
  error: (value: string | null) => void,
  flight: { current: boolean },
): void {
  if (flight.current) return;
  if (!files.some((file) => file.questionCustody)) {
    commit();
    return;
  }
  flight.current = true;
  busy(true);
  error(null);
  void (action === "retain" ? retainQuestionAttachments(files) : releaseQuestionAttachments(files))
    .then(() => {
      flight.current = false;
      commit();
    })
    .catch((reason: unknown) => error(String(reason instanceof Error ? reason.message : reason)))
    .finally(() => {
      flight.current = false;
      busy(false);
    })
    .catch(() => {});
}

/** Question protocols carry text: every file must have a durable readable path. */
export async function prepareQuestionAttachments(files: Attachment[]): Promise<Attachment[]> {
  if (files.length > MAX_ATTACHMENTS) throw new Error(t("Too many attachments"));
  return Promise.all(
    files.map(async (file) => {
      let path = file.path;
      if (!path?.trim()) {
        if (!file.data)
          throw new Error(t("Cannot attach {p0}: no file data is available.", { p0: file.name }));
        path = await invoke<string>("write_attachment", { name: file.name, data: file.data });
      }
      if (!path?.trim()) throw new Error(t("Could not save attachment {p0}.", { p0: file.name }));
      return {
        ...persistableAttachment({ ...file, path }),
        ...(file.hostEnvironmentId ? { hostEnvironmentId: file.hostEnvironmentId } : {}),
      };
    }),
  );
}
