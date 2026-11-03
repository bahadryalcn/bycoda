import { useEffect, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Select } from "../../../shared/ui/Select";
import {
  assistantJobProjectIds,
  assistantJobDraftVisible,
  assistantJobDraftReady,
  changeAssistantJobDraftKind,
  selectAssistantJobProjects,
} from "../../assistant/model/assistantJobs";
import { AssistantQuickNoteFields } from "../../assistant/ui/AssistantQuickNoteFields";
import { AssistantQuickAutomationFields } from "../../assistant/ui/AssistantQuickAutomationFields";
import { t } from "../../../shared/i18n";
import type { VoiceJobDraft, VoiceJobReviewState } from "../model/voiceJobs";
import styles from "./VoiceJobReview.module.css";
import { InlineError } from "../../../shared/ui/InlineError";

/** The owner reviews editable requests before any job is created. */
export function VoiceJobReview({
  review,
  onChange,
  onStart,
  onCancel,
}: {
  review: VoiceJobReviewState;
  onChange: (rows: VoiceJobDraft[]) => void;
  onStart: (rows: VoiceJobDraft[]) => void;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState(review.jobs);
  const locked = review.busy || review.accepted.length > 0 || Boolean(review.error);
  const update = (id: string, patch: Partial<VoiceJobDraft>) => {
    if (locked) return;
    const next = rows.map((row) => {
      if (row.id !== id) return row;
      const result = { ...row, ...patch };
      if (result.kind === "quick" && result.quickAction?.kind === "automation") {
        result.projectId = result.quickAction.projectId;
        result.projectIds = result.projectId ? [result.projectId] : [];
      }
      return result;
    });
    setRows(next);
    onChange(next);
  };
  useEffect(() => {
    if (locked) setRows(review.jobs);
  }, [locked, review.jobs]);
  return (
    <div className={styles.review}>
      <p>{t("Review jobs before starting")}</p>
      {rows.map((row, index) => (
        <fieldset className={styles.job} key={row.id} disabled={locked}>
          <legend>{t("Job {p0}", { p0: index + 1 })}</legend>
          <Select
            label={t("Job type")}
            visibleLabel
            value={
              row.kind === "quick" && row.quickAction?.kind === "automation"
                ? "automation"
                : (row.kind ?? "project")
            }
            disabled={locked}
            options={[
              { value: "project", label: t("Project work") },
              {
                value: "quick",
                label: t("Save personal note"),
                disabled: review.quickNotes !== true,
              },
              {
                value: "automation",
                label: t("Create scheduled automation"),
                disabled: review.quickAutomations !== true,
              },
            ]}
            onValueChange={(kind) =>
              update(
                row.id,
                changeAssistantJobDraftKind(row, kind as "project" | "quick" | "automation"),
              )
            }
          />
          <TextField
            label={t("Title")}
            value={row.title}
            maxLength={300}
            onChange={(event) => update(row.id, { title: event.currentTarget.value })}
          />
          <TextareaField
            label={t("Request")}
            value={row.request}
            maxLength={16000}
            minRows={2}
            maxRows={5}
            onChange={(event) => update(row.id, { request: event.currentTarget.value })}
          />
          {row.kind === "quick" && row.quickAction?.kind === "note" ? (
            <AssistantQuickNoteFields
              value={row.quickAction}
              disabled={locked}
              onChange={(quickAction) => update(row.id, { quickAction })}
            />
          ) : row.kind === "quick" && row.quickAction?.kind === "automation" ? (
            <AssistantQuickAutomationFields
              value={row.quickAction}
              projects={review.projects}
              disabled={locked}
              onChange={(quickAction) => update(row.id, { quickAction })}
            />
          ) : (
            <>
              <SearchableSelect
                visibleLabel
                multiple
                showSelectedValues
                selectionLabels={{ done: t("Done") }}
                label={t("Participating projects")}
                value={assistantJobProjectIds(row)}
                disabled={locked}
                options={review.projects.map((project) => ({
                  value: project.id,
                  label: project.name,
                  description: project.path,
                  disabled:
                    assistantJobProjectIds(row).length >= 20 &&
                    !assistantJobProjectIds(row).includes(project.id),
                }))}
                onChange={(projectIds) =>
                  update(row.id, selectAssistantJobProjects(row.projectId, projectIds))
                }
              />
              <SearchableSelect
                visibleLabel
                label={t("Lead project")}
                value={row.projectId}
                disabled={locked || !assistantJobProjectIds(row).length}
                options={review.projects
                  .filter((project) => assistantJobProjectIds(row).includes(project.id))
                  .map((project) => ({
                    value: project.id,
                    label: project.name,
                    description: project.path,
                  }))}
                onChange={(projectId) =>
                  update(row.id, selectAssistantJobProjects(projectId, assistantJobProjectIds(row)))
                }
              />
            </>
          )}
        </fieldset>
      ))}
      {review.accepted.length ? (
        <p role="status">
          {t("{p0} jobs accepted. They continue independently.", { p0: review.accepted.length })}
        </p>
      ) : null}
      {review.error ? <InlineError>{review.error}</InlineError> : null}
      <div className={styles.actions}>
        <Button
          variant="primary"
          loading={review.busy}
          disabled={rows.some(
            (row) =>
              !assistantJobDraftReady(row) ||
              !assistantJobDraftVisible(row, (id) =>
                review.projects.some((project) => project.id === id),
              ) ||
              (row.kind === "quick" &&
                (row.quickAction?.kind === "automation"
                  ? review.quickAutomations !== true
                  : review.quickNotes !== true)),
          )}
          onClick={() => onStart(rows)}
        >
          {t(
            review.error
              ? "Check and retry"
              : rows.every((row) => row.kind === "quick" && row.quickAction?.kind === "note")
                ? "Save notes"
                : rows.every(
                      (row) => row.kind === "quick" && row.quickAction?.kind === "automation",
                    )
                  ? "Create automations"
                  : "Start jobs",
          )}
        </Button>
        <Button variant="ghost" disabled={review.busy} onClick={onCancel}>
          {t("Cancel review")}
        </Button>
      </div>
    </div>
  );
}
