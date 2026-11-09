import { useEffect, useId, useRef, useState } from "react";
import type {
  AssistantJob,
  AssistantRequest,
} from "../../../../shared/model/host-contracts/assistant";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { TextareaField } from "../../../../shared/ui/TextareaField";
import { Select } from "../../../../shared/ui/Select";
import { Modal, ModalActions } from "../../../../shared/ui/Modal";
import { InlineError } from "../../../../shared/ui/InlineError";
import { LiveText } from "../../../../shared/ui/LiveText";
import { assistantJobProjectIds } from "../../model/assistantJobs";
import rootStyles from "../AssistantView.module.css";
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
    [error, setError] = useState("");
  const [draftStorageError, setDraftStorageError] = useState(() => unsavedJobOwnerDrafts.has(key));
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const live = useRef(current);
  useEffect(() => {
    live.current = current;
  });
  function retain(next: typeof draft, requirePersistence = false) {
    if (!requirePersistence) setDraft(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
      unsavedJobOwnerDrafts.delete(key);
      setDraftStorageError(false);
      if (requirePersistence) setDraft(next);
      return true;
    } catch {
      if (!requirePersistence) unsavedJobOwnerDrafts.set(key, next);
      setDraftStorageError(true);
      return false;
    }
  }
  function verify(next: AssistantJob | undefined) {
    if (
      !alive.current ||
      !live.current() ||
      !next ||
      next.id !== job.id ||
      next.kind === "quick" ||
      next.projectId !== job.projectId ||
      JSON.stringify(assistantJobProjectIds(next)) !== JSON.stringify(assistantJobProjectIds(job))
    )
      throw new Error("The job changed or is outside visible project scope.");
    return next;
  }
  async function submit() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      if (!live.current()) throw new Error("The selected project is no longer visible.");
      if (draft.intent) {
        const next = verify((await request({ op: "jobs.get", id: job.id }, environmentId)).job);
        if (
          draft.intent.op === "jobs.priority" &&
          next.version > draft.intent.expectedVersion &&
          (next.priority ?? "normal") === draft.intent.priority
        ) {
          localStorage.removeItem(key);
          onSaved();
          return;
        }
        setError(
          t(
            mode === "replan"
              ? "Replan was not confirmed. Review the goal before starting another replan."
              : "Priority change was not confirmed. Review the job before changing it again.",
          ),
        );
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
        throw new Error("Describe the change before replanning.");
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
        throw new Error("Job status is unknown. Check the Room before retrying.");
      localStorage.removeItem(key);
      onSaved();
    } catch (cause) {
      if (alive.current && live.current())
        setError(cause instanceof Error ? t(cause.message) : String(cause));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <Modal
      title={t(mode === "replan" ? "Replan job" : "Job priority")}
      onClose={onClose}
      size="md"
      footer={
        <ModalActions>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            {t("Close")}
          </Button>
          <Button
            form={formId}
            type="submit"
            variant="primary"
            loading={pending}
            disabled={!draft.intent && mode === "replan" && !draft.feedback.trim()}
          >
            {t(draft.intent ? "Check status" : mode === "replan" ? "Replan" : "Save")}
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
        <p className={styles.subtitle}>{job.title}</p>
        {mode === "replan" ? (
          <TextareaField
            label={t("Replan feedback")}
            value={draft.feedback}
            maxLength={3000}
            minRows={5}
            disabled={pending || !!draft.intent}
            onChange={(event) => retain({ ...draft, feedback: event.currentTarget.value })}
          />
        ) : (
          <Select
            hideLabel
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
          className={styles.muted}
          text={
            draft.intent
              ? t(
                  "This request is retained on its original computer. Check its status before taking another action.",
                )
              : ""
          }
        />
        {error && <InlineError className={rootStyles.error}>{error}</InlineError>}
        {draftStorageError && (
          <InlineError className={rootStyles.error}>
            {t("Could not save this draft. It is kept in this window.")}{" "}
            <Button type="button" onClick={() => retain(draft)}>
              {t("Retry saving")}
            </Button>
          </InlineError>
        )}
      </form>
    </Modal>
  );
}
