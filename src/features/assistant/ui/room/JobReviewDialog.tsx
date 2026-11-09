import { errorText } from "../../../../shared/lib/errors";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { TextField } from "../../../../shared/ui/TextField";
import { SearchableSelect } from "../../../../shared/ui/SearchableSelect";
import { Select } from "../../../../shared/ui/Select";
import { Modal, ModalActions } from "../../../../shared/ui/Modal";
import { InlineError } from "../../../../shared/ui/InlineError";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
import { X } from "../../../../shared/ui/icons";
import {
  assistantJobDraftReady,
  changeAssistantJobDraftKind,
  selectAssistantJobProjects,
} from "../../model/assistantJobs";
import { AssistantQuickNoteFields } from "../AssistantQuickNoteFields";
import { AssistantQuickAutomationFields } from "../AssistantQuickAutomationFields";
import styles from "./Jobs.module.css";
import { useAssistantRoom } from "./assistantRoomContext";

export function JobReviewDialog() {
  const room = useAssistantRoom();
  const {
    projects,
    snapshot,
    pending,
    error,
    jobReview,
    setJobReview,
    jobReviewFrozen,
    reviewedDraft,
    visibleDraft,
    updateJobDraft,
    submitJobs,
    jobDraftVisible,
    reviewHasAutomation,
  } = room;
  if (!jobReview || !jobDraftVisible) return null;
  return (
    <Modal
      title={t("Review jobs")}
      description={t("Check each request and its projects before it starts.")}
      onClose={() => {
        if (!pending) setJobReview(null);
      }}
      size="md"
      fitViewport
      footerStart={
        error?.key === "jobs.create" || reviewHasAutomation ? (
          <div className={styles.footerNote}>
            {error?.key === "jobs.create" && <InlineError>{error.text}</InlineError>}
            {reviewHasAutomation && (
              <p className={styles.muted}>
                {t("This creates a scheduled automation. It does not run it now.")}
              </p>
            )}
          </div>
        ) : undefined
      }
      footer={
        <ModalActions>
          <Button variant="ghost" disabled={Boolean(pending)} onClick={() => setJobReview(null)}>
            {t("Cancel")}
          </Button>
          <Button
            variant="primary"
            loading={pending?.key === "jobs.create"}
            disabled={
              !jobReview.length ||
              jobReview.some(
                (item) =>
                  !assistantJobDraftReady(reviewedDraft(item)) ||
                  !visibleDraft(item) ||
                  (item.kind === "quick" &&
                    (item.quickAction?.kind === "automation"
                      ? snapshot?.capabilities.quickAutomations !== true
                      : snapshot?.capabilities.quickNotes !== true)),
              )
            }
            onClick={() =>
              submitJobs().catch((error: unknown) =>
                room.setError({ key: "jobs.create", text: errorText(error) }),
              )
            }
          >
            {t(
              jobReviewFrozen
                ? "Check and retry"
                : jobReview.every((row) => row.kind === "quick" && row.quickAction?.kind === "note")
                  ? "Save notes"
                  : jobReview.every(
                        (row) => row.kind === "quick" && row.quickAction?.kind === "automation",
                      )
                    ? "Create automations"
                    : "Start",
            )}
          </Button>
        </ModalActions>
      }
    >
      <div className={styles.reviewList}>
        {jobReview.map((draft, index) => (
          <div className={styles.reviewJob} key={draft.id}>
            <div className={styles.reviewHead}>
              <SectionLabel as="h3">{t("Request {p0}", { p0: index + 1 })}</SectionLabel>
              <div className={styles.reviewTools}>
                <Select
                  hideLabel
                  label={t("Job type")}
                  value={
                    draft.kind === "quick" && draft.quickAction?.kind === "automation"
                      ? "automation"
                      : (draft.kind ?? "project")
                  }
                  disabled={jobReviewFrozen || !!pending}
                  options={[
                    {
                      value: "project",
                      label: t("Project work"),
                      disabled: !snapshot?.capabilities.jobs,
                    },
                    {
                      value: "quick",
                      label: t("Save personal note"),
                      disabled: snapshot?.capabilities.quickNotes !== true,
                    },
                    {
                      value: "automation",
                      label: t("Create scheduled automation"),
                      disabled: snapshot?.capabilities.quickAutomations !== true,
                    },
                  ]}
                  onValueChange={(kind) => {
                    const next = changeAssistantJobDraftKind(
                      reviewedDraft(draft),
                      kind as "project" | "quick" | "automation",
                    );
                    updateJobDraft(draft.id, {
                      ...next,
                      projectIds: [...(next.projectIds ?? [])],
                    });
                  }}
                />
                {jobReview.length > 1 && (
                  <Button
                    iconOnly
                    size="sm"
                    variant="ghost"
                    label={t("Remove request")}
                    tooltip={t("Remove request")}
                    disabled={jobReviewFrozen || Boolean(pending)}
                    onClick={() =>
                      setJobReview((current) => current!.filter((item) => item.id !== draft.id))
                    }
                  >
                    <X className="icon-sm" aria-hidden />
                  </Button>
                )}
              </div>
            </div>
            <TextField
              label={t("Request {p0}", { p0: index + 1 })}
              hideLabel
              value={draft.request}
              disabled={jobReviewFrozen || !!pending}
              maxLength={16000}
              onChange={(event) => {
                const value = event.currentTarget.value;
                updateJobDraft(draft.id, { request: value, title: value.trim().slice(0, 300) });
              }}
            />
            {draft.kind === "quick" && draft.quickAction?.kind === "note" ? (
              <AssistantQuickNoteFields
                value={draft.quickAction}
                disabled={jobReviewFrozen || !!pending}
                onChange={(quickAction) => updateJobDraft(draft.id, { quickAction })}
              />
            ) : draft.kind === "quick" && draft.quickAction?.kind === "automation" ? (
              <AssistantQuickAutomationFields
                value={draft.quickAction}
                projects={projects.map((project) => ({
                  ...project,
                  id: project.id ?? project.path,
                }))}
                disabled={jobReviewFrozen || !!pending}
                onChange={(quickAction) => updateJobDraft(draft.id, { quickAction })}
              />
            ) : (
              <>
                <SearchableSelect
                  label={t("Participating projects")}
                  multiple
                  showSelectedValues
                  selectionLabels={{ done: t("Done") }}
                  value={draft.projectIds}
                  disabled={jobReviewFrozen || !!pending}
                  options={projects.map((project) => ({
                    value: project.id ?? project.path,
                    label: project.name,
                    description: project.path,
                    disabled:
                      draft.projectIds.length >= 20 &&
                      !draft.projectIds.includes(project.id ?? project.path),
                  }))}
                  onChange={(projectIds) =>
                    updateJobDraft(
                      draft.id,
                      selectAssistantJobProjects(draft.projectId, projectIds),
                    )
                  }
                />
                <SearchableSelect
                  label={t("Lead project")}
                  value={draft.projectId}
                  disabled={jobReviewFrozen || !!pending || !draft.projectIds.length}
                  options={projects
                    .filter((project) => draft.projectIds.includes(project.id ?? project.path))
                    .map((project) => ({
                      value: project.id ?? project.path,
                      label: project.name,
                      description: project.path,
                    }))}
                  onChange={(projectId) =>
                    updateJobDraft(
                      draft.id,
                      selectAssistantJobProjects(projectId, draft.projectIds),
                    )
                  }
                />
              </>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
