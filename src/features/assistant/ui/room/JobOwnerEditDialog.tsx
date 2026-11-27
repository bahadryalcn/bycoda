import { describeRemoteError } from "../../../connections/public/remoteFailure";
import { useEffect, useId, useRef, useState } from "react";
import type {
  AssistantJob,
  AssistantRequest,
} from "../../../../shared/model/host-contracts/assistant";
import { t } from "../../../../shared/i18n";
import { useStableCallback } from "../../../../shared/hooks/useStableCallback";
import { Button } from "../../../../shared/ui/Button";
import { TextareaField } from "../../../../shared/ui/TextareaField";
import { Select } from "../../../../shared/ui/Select";
import { Modal, ModalActions } from "../../../../shared/ui/Modal";
import { InlineError } from "../../../../shared/ui/InlineError";
import { LiveText } from "../../../../shared/ui/LiveText";
import { Text } from "../../../../shared/ui/Text";
import { assistantJobProjectIds } from "../../model/assistantJobs";
import { createLocalDraftWriter } from "../../model/assistantLocalDraft";
import styles from "./Jobs.module.css";
import { type OwnerRequest } from "./assistantRoomHelpers";

type JobOwnerEditInput = Extract<AssistantRequest, { op: "jobs.replan" | "jobs.priority" }>;
type JobOwnerDraft = {
  feedback: string;
  priority: "low" | "normal" | "high";
  intent?: JobOwnerEditInput;
};
const unsavedJobOwnerDrafts = new Map<string, JobOwnerDraft>();
export function JobOwnerEditDialog({
  job,
  mode,
  environmentId,
  request,
  current,
  onClose,
  onSaved,
}: {
  job: AssistantJob;
  mode: "priority" | "replan";
  environmentId: string;
  request: OwnerRequest;
  current: () => boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const formId = useId(),
    key = `bycoda.assistant.job-edit:${environmentId}:${job.id}:${mode}`;
  const [draft, setDraft] = useState<JobOwnerDraft>(() => {
    const unsaved = unsavedJobOwnerDrafts.get(key);
    if (unsaved) return unsaved;
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null");
      if (
        saved &&
        typeof saved.feedback === "string" &&
        ["low", "normal", "high"].includes(saved.priority) &&
        (!saved.intent || (saved.intent.id === job.id && saved.intent.op === `jobs.${mode}`))
      )
        return saved;
    } catch {
      /* An invalid retained draft grants no action. */
    }
    return {
      feedback: "",
      priority: job.kind !== "quick" ? (job.priority ?? "normal") : "normal",
    };
  });
  const [pending, setPending] = useState(false),
    busy = useRef(false),
    [problem, setProblem] = useState<{ message: string; details?: string } | null>(null);
  const [draftStorageError, setDraftStorageError] = useState(() => unsavedJobOwnerDrafts.has(key));
  const [writer] = useState(() =>
    createLocalDraftWriter(key, (saved) => {
      if (saved) unsavedJobOwnerDrafts.delete(key);
      setDraftStorageError(!saved);
    }),
  );
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Attach the draft writer's page lifecycle listener and flush on unmount.
  useEffect(() => writer.attach(), [writer]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const live = useStableCallback(current);
  /**
   * Keeps the latest draft in memory for remounts and hands storage to the shared writer. A
   * persistence-required call (durable intent before dispatch) flushes at once; a failed write
   * stays pending and is retried by the next flush.
   */
  function retain(next: typeof draft, requirePersistence = false) {
    if (!requirePersistence) {
      setDraft(next);
      unsavedJobOwnerDrafts.set(key, next);
      writer.schedule(() => JSON.stringify(next));
      return true;
    }
    unsavedJobOwnerDrafts.set(key, next);
    writer.schedule(() => JSON.stringify(next));
    if (writer.flush()) {
      setDraft(next);
      return true;
    }
    // An undispatched intent must not reach storage later: keep the pre-intent draft pending instead.
    unsavedJobOwnerDrafts.set(key, draft);
    writer.schedule(() => JSON.stringify(draft));
    return false;
  }
  /** Explicit discard or a confirmed save: no pending write may bring the draft back. */
  function discard() {
    writer.clear();
    unsavedJobOwnerDrafts.delete(key);
  }
  function verify(next: AssistantJob | undefined) {
    if (
      !alive.current ||
      !live() ||
      !next ||
      next.id !== job.id ||
      next.kind === "quick" ||
      next.projectId !== job.projectId ||
      JSON.stringify(assistantJobProjectIds(next)) !== JSON.stringify(assistantJobProjectIds(job))
    )
      throw new Error(t("The job changed or is outside visible project scope."));
    return next;
  }
  async function submit() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setProblem(null);
    try {
      if (!live()) throw new Error(t("The selected project is no longer visible."));
      if (draft.intent) {
        const next = verify((await request({ op: "jobs.get", id: job.id }, environmentId)).job);
        if (
          draft.intent.op === "jobs.priority" &&
          next.version > draft.intent.expectedVersion &&
          (next.priority ?? "normal") === draft.intent.priority
        ) {
          discard();
          onSaved();
          return;
        }
        setProblem({
          message:
            mode === "replan"
              ? t("Replan could not be confirmed. Review the epic before starting another replan.")
              : t(
                  "Priority change could not be confirmed. Review the job before changing it again.",
                ),
        });
        return;
      }
      const input: JobOwnerEditInput =
        mode === "replan"
          ? {
              op: "jobs.replan",
              id: job.id,
              expectedVersion: job.version,
              feedback: draft.feedback.trim(),
            }
          : {
              op: "jobs.priority",
              id: job.id,
              expectedVersion: job.version,
              priority: draft.priority,
            };
      if (input.op === "jobs.replan" && !input.feedback)
        throw new Error(t("Describe the change before replanning."));
      if (!retain({ ...draft, intent: input }, true))
        throw new Error(
          t(
            "Could not save this request locally. Your draft is kept in this window; retry saving before continuing.",
          ),
        );
      const next = verify((await request(input, environmentId)).job);
      if (
        next.version <= job.version ||
        (input.op === "jobs.priority" && (next.priority ?? "normal") !== input.priority) ||
        (input.op === "jobs.replan" && next.status !== "planning")
      )
        throw new Error(t("Job status is unknown. Check the Room before retrying."));
      discard();
      onSaved();
    } catch (cause) {
      if (alive.current && live()) setProblem(describeRemoteError(cause));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  const blockedReason =
    !draft.intent && mode === "replan" && !draft.feedback.trim()
      ? t("Describe what should change")
      : undefined;
  return (
    <Modal
      title={mode === "replan" ? t("Replan job") : t("Job priority")}
      onClose={onClose}
      size="md"
      footer={
        <ModalActions reason={blockedReason}>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            form={formId}
            type="submit"
            variant="primary"
            loading={pending}
            disabled={Boolean(blockedReason)}
          >
            {draft.intent ? t("Check status") : mode === "replan" ? t("Replan") : t("Save")}
          </Button>
        </ModalActions>
      }
    >
      <form
        id={formId}
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Text as="p" leading="inherit" className={styles.subtitle}>
          {job.title}
        </Text>
        {mode === "replan" ? (
          <TextareaField
            label={t("Replan feedback")}
            placeholder={t("What should the plan do differently?")}
            value={draft.feedback}
            maxLength={3000}
            minRows={5}
            disabled={pending || !!draft.intent}
            onChange={(event) => retain({ ...draft, feedback: event.currentTarget.value })}
          />
        ) : (
          <Select
            label={t("Priority")}
            value={draft.priority}
            disabled={pending || !!draft.intent}
            options={[
              { value: "low", label: t("Low") },
              { value: "normal", label: t("Normal") },
              { value: "high", label: t("High") },
            ]}
            onValueChange={(priority) =>
              retain({ ...draft, priority: priority as typeof draft.priority })
            }
          />
        )}
        <LiveText
          size="caption"
          tone="secondary"
          leading="inherit"
          className={styles.muted}
          text={
            draft.intent
              ? t(
                  "This request is retained on its original computer. Check its status before taking another action.",
                )
              : ""
          }
        />
        {problem && <InlineError details={problem.details}>{problem.message}</InlineError>}
        {draftStorageError && (
          <InlineError
            retry={{
              label: t("Retry saving"),
              onRetry: () => {
                retain(draft);
                writer.flush();
              },
            }}
          >
            {t("Could not save this draft. It is kept in this window.")}
          </InlineError>
        )}
      </form>
    </Modal>
  );
}
