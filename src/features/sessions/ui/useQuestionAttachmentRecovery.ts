import { useEffect, useRef, useState } from "react";
import type { QuestionDraft } from "../model/questionDrafts";
import type { UserQuestionPrompt } from "../model/userQuestion";
import { listQuestionAttachmentDrafts, reconcileQuestionAttachment } from "../model/questionAttachments";

export function useQuestionAttachmentRecovery(
  draft: QuestionDraft,
  busy: boolean,
  update: (change: (current: QuestionDraft) => QuestionDraft) => boolean,
  setError: (message: string | null) => void,
  sessionId: string | undefined,
  scope: string,
  prompt: UserQuestionPrompt,
  setBusy: (value: boolean) => void,
): { blocked: boolean; retry: () => void } {
  const [blocked, setBlocked] = useState(!!sessionId);
  const [attempt, setAttempt] = useState(0);
  const callbacks = useRef({ update, setError, prompt, setBusy });
  callbacks.current = { update, setError, prompt, setBusy };
  useEffect(() => {
    if (!sessionId) return;
    let current = true;
    setBlocked(true);
    callbacks.current.setBusy(true);
    void listQuestionAttachmentDrafts(sessionId, scope, callbacks.current.prompt).then((found) => {
      if (!current) return;
      if (found.length === 0) { setBlocked(false); return; }
      const saved = callbacks.current.update((latest) => {
        const attachments = { ...latest.attachments };
        for (const item of found) {
          const files = attachments[item.questionId] ?? [];
          if (!files.some((file) => file.id === item.file.id)) attachments[item.questionId] = [...files, item.file];
        }
        return { ...latest, attachments, ...(found.some((item) => item.retained) ? { delivery: "unknown" as const, pendingAction: "answer" as const } : {}) };
      });
      if (!saved) throw new Error("Question attachment recovery could not retain the draft");
      setBlocked(false);
    }).catch((reason: unknown) => { if (current) callbacks.current.setError(String(reason instanceof Error ? reason.message : reason)); })
      .finally(() => { if (current) callbacks.current.setBusy(false); })
      .catch(() => {});
    return () => { current = false; callbacks.current.setBusy(false); };
  }, [sessionId, scope, attempt]);
  useEffect(() => {
    if (busy || !Object.values(draft.attachments ?? {}).some((files) => files.some((file) => file.questionCustody))) return;
    let current = true;
    void Promise.all(Object.entries(draft.attachments ?? {}).map(async ([questionId, files]) => {
      const resolved = await Promise.all(files.map(reconcileQuestionAttachment));
      return [questionId, files, resolved] as const;
    })).then((entries) => {
      if (!current || !entries.some(([, files, resolved]) => resolved.some((file, index) => file !== files[index]))) return;
      callbacks.current.update((latest) => ({ ...latest, attachments: Object.fromEntries(entries.map(([id, original, resolved]) => [id,
        (latest.attachments?.[id] ?? []).flatMap((file) => {
          const at = original.findIndex((item) => item.id === file.id);
          return at < 0 ? [file] : resolved[at] ? [resolved[at]!] : [];
        }),
      ])) }));
    }).catch((reason: unknown) => { if (current) callbacks.current.setError(String(reason instanceof Error ? reason.message : reason)); });
    return () => { current = false; };
  }, [draft.attachments, busy]);
  return { blocked: !!sessionId && blocked, retry: () => setAttempt((value) => value + 1) };
}
