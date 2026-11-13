import { Code } from "../../../../shared/ui/Code";
import { Text } from "../../../../shared/ui/Text";
import { useState } from "react";
import type {
  AssistantJob,
  AssistantNote,
} from "../../../../shared/model/host-contracts/assistant";
import { formatNumber, t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { ClampText } from "../../../../shared/ui/ClampText";
import { DescriptionItem, DescriptionList } from "../../../../shared/ui/DescriptionList";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { Badge } from "../../../../shared/ui/Badge";
import { ModalActions } from "../../../../shared/ui/Modal";
import { Timestamp } from "../../../../shared/ui/Timestamp";
import { Sheet } from "../../../../shared/ui/Sheet";
import { Tab, TabList, TabPanel, Tabs } from "../../../../shared/ui/Tabs";
import { InlineError } from "../../../../shared/ui/InlineError";
import { assistantJobProjectIds, assistantJobVisible } from "../../model/assistantJobs";
import { AssistantQuickAutomationFields } from "../AssistantQuickAutomationFields";
import { captureAssistantHostRead } from "../../model/assistantHostRead";
import styles from "./Jobs.module.css";
import rootStyles from "../AssistantView.module.css";
import { finished, jobStatusLabel, jobStatusTone, type OwnerRequest } from "./assistantRoomHelpers";
import { useAssistantRoom } from "./assistantRoomContext";
import { JobDetailActivity } from "./JobDetailActivity";
import { JobDetailNotes } from "./JobDetailNotes";

const PRIORITY_LABEL = { low: "Low", normal: "Normal", high: "High" } as const;

/** Job details as a compact end sheet: header, request, meta, then Activity and Notes. */
export function JobDetailDialog() {
  const room = useAssistantRoom();
  const { snapshot, setDetail, openJob } = room;
  if (!openJob) return null;
  return (
    <Sheet
      title={openJob.title}
      context={t("Job details")}
      onClose={() => setDetail(null)}
      side="end"
      size="min(440px, 100vw)"
      headerBelow={
        <div className={styles.sheetStatus}>
          <Badge tone={jobStatusTone(openJob)} size="sm">
            {jobStatusLabel(openJob)}
          </Badge>
        </div>
      }
      footer={
        openJob.kind !== "quick" ? (
          <ModalActions>
            <JobSheetActions key={openJob.id} job={openJob} />
          </ModalActions>
        ) : undefined
      }
    >
      <JobDetailBody key={openJob.id} job={openJob} notes={snapshot?.notes ?? []} />
    </Sheet>
  );
}

function JobSheetActions({ job }: { job: AssistantJob }) {
  const room = useAssistantRoom();
  const { environmentId, privacy, pending, setJobEdit } = room;
  const editable = !finished(job) && job.status !== "paused" && !job.pendingTaskDeletion;
  const priority = job.kind === "quick" ? "normal" : (job.priority ?? "normal");
  return (
    <>
      <Button
        disabled={!!pending || !environmentId}
        onClick={() =>
          environmentId &&
          setJobEdit({
            job,
            mode: "priority",
            environmentId,
            scopeKey: privacy.key,
          })
        }
      >
        {t("Priority")}: {t(PRIORITY_LABEL[priority])}
      </Button>
      {editable && job.goalId && !job.awaitingOwnerRestart && (
        <Button
          disabled={!!pending || !environmentId}
          onClick={() =>
            environmentId &&
            setJobEdit({
              job,
              mode: "replan",
              environmentId,
              scopeKey: privacy.key,
            })
          }
        >
          {t("Replan")}
        </Button>
      )}
    </>
  );
}

function JobDetailBody({ job, notes }: { job: AssistantJob; notes: readonly AssistantNote[] }) {
  const room = useAssistantRoom();
  const {
    environmentId,
    assistantRequest,
    projects,
    canSeeProject,
    scopeEpoch,
    setDetail,
    setNoteEdit,
    setView,
    pending,
    error,
    run,
    onOpenSession,
    props,
    control,
    reviewJobTasks,
    projectName,
    errorFor,
  } = room;
  const [tab, setTab] = useState("activity");
  return (
    <div className={styles.sheet}>
      <div className={styles.request}>
        <ClampText key={job.id} lines={4}>
          <p>{job.request}</p>
        </ClampText>
        {job.summary && (
          <Text as="p" leading="inherit" className={styles.muted}>
            {job.summary}
          </Text>
        )}
      </div>
      <DescriptionList size="sm">
        {job.kind !== "quick" && (
          <DescriptionItem term={t("Lead project")}>{projectName(job.projectId)}</DescriptionItem>
        )}
        {assistantJobProjectIds(job).length > 1 && (
          <DescriptionItem term={t("Participating projects")}>
            {assistantJobProjectIds(job).map(projectName).join(" · ")}
          </DescriptionItem>
        )}
        <DescriptionItem term={t("Tokens")}>{formatNumber(job.tokens)}</DescriptionItem>
        <DescriptionItem term={t("Created")}>
          <Timestamp value={job.createdAt} />
        </DescriptionItem>
      </DescriptionList>
      {job.kind === "quick" && job.quickAction.kind === "note" && (
        <section className={styles.block}>
          <SectionLabel>{job.quickAction.title}</SectionLabel>
          <p>{job.quickAction.body}</p>
          {job.quickResult?.noteId && (
            <Button
              loading={pending?.key === `note:${job.id}`}
              disabled={!!pending}
              onClick={() =>
                run(`note:${job.id}`, t("Loading..."), async () => {
                  const id = job.quickResult?.noteId;
                  if (!id) throw new Error(t("The saved note is no longer available."));
                  const result = await assistantRequest({
                    op: "notes.get",
                    id,
                  });
                  if (!result.note || result.note.id !== id)
                    throw new Error(t("The saved note is no longer available."));
                  setDetail(null);
                  setNoteEdit(result.note);
                  setView("Notes");
                })
              }
            >
              {t("Open saved note")}
            </Button>
          )}
          {errorFor(`note:${job.id}`)}
        </section>
      )}
      {job.kind === "quick" && job.quickAction.kind === "automation" && (
        <section className={styles.block}>
          <AssistantQuickAutomationFields
            value={job.quickAction}
            projects={projects.map((project) => ({
              ...project,
              id: project.id ?? project.path,
            }))}
            disabled
            onChange={() => undefined}
          />
          {!job.quickResult?.automationId && job.quickIntent?.automationId && (
            <Text as="p" leading="inherit" className={styles.muted}>
              {t(
                "Automation creation is unconfirmed. Inspect its original target before retrying.",
              )}{" "}
              <Code>{job.quickIntent.automationId}</Code>
            </Text>
          )}
          {(job.quickResult?.automationId || job.quickIntent?.automationId) &&
            props.onOpenAutomation && (
              <Button
                loading={pending?.key === `automation:${job.id}`}
                disabled={!!pending}
                onClick={() =>
                  run(`automation:${job.id}`, t("Loading..."), async () => {
                    const navigationEpoch = scopeEpoch.current.value;
                    const id = job.quickResult?.automationId ?? job.quickIntent?.automationId;
                    if (!id || !environmentId || job.quickAction.kind !== "automation")
                      throw new Error(
                        "The linked automation is unavailable on its original computer.",
                      );
                    const owner = await captureAssistantHostRead(environmentId);
                    const rows = await owner.automations();
                    const projectId = job.quickAction.projectId;
                    const actual = rows.find((row) => row.id === id && row.projectId === projectId);
                    if (!actual || !assistantJobVisible(job, canSeeProject))
                      throw new Error(
                        "The linked automation is unavailable on its original computer.",
                      );
                    await props.onOpenAutomation!({
                      id: actual.id,
                      projectId: actual.projectId,
                      environmentId: owner.environmentId,
                    });
                    if (scopeEpoch.current.value === navigationEpoch)
                      setDetail((current) => (current === job.id ? null : current));
                  })
                }
              >
                {t("Open automation")}
              </Button>
            )}
          {errorFor(`automation:${job.id}`)}
        </section>
      )}
      {job.awaitingOwnerRestart && (
        <section className={styles.block}>
          <Text as="p" leading="inherit" className={styles.muted}>
            {t(
              "Restoring keeps the epic and tasks stopped. Review them in the task board before restarting.",
            )}
          </Text>
          {props.onReviewJobTasks && (
            <Button
              disabled={!!pending}
              loading={pending?.key === `tasks:${job.id}`}
              onClick={() => reviewJobTasks(job)}
            >
              {t("Review tasks")}
            </Button>
          )}
        </section>
      )}
      {job.pendingTaskDeletion && (
        <Button
          disabled={!!pending}
          loading={pending?.key === job.id}
          onClick={() => control(job, "keep")}
        >
          {t("Keep job and tasks")}
        </Button>
      )}
      {errorFor(`tasks:${job.id}`)}
      {error?.key.startsWith("navigation:") && (
        <InlineError className={rootStyles.error}>{error.text}</InlineError>
      )}
      <Disclosure size="sm" summary={t("Related work")}>
        <div className={styles.related}>
          {job.goalId && (
            <p>
              {t("Epic")}:{" "}
              <Button
                variant="link"
                disabled={!props.onReviewJobTasks || !!pending}
                loading={pending?.key === `tasks:${job.id}`}
                onClick={() => reviewJobTasks(job)}
              >
                {job.goalId}
              </Button>
            </p>
          )}
          {job.sessionIds.map((id) => (
            <Button
              key={id}
              variant="link"
              disabled={!onOpenSession}
              onClick={() => onOpenSession?.(id)}
            >
              {id}
            </Button>
          ))}
          {job.taskIds.map((id) => (
            <Button
              key={id}
              variant="link"
              disabled={!props.onReviewJobTasks || !!pending || job.kind === "quick" || !job.goalId}
              onClick={() => reviewJobTasks(job)}
            >
              {id}
            </Button>
          ))}
        </div>
      </Disclosure>
      <Tabs value={tab} onValueChange={setTab} id="job-detail">
        <TabList label={t("Job details")}>
          <Tab value="activity">{t("Activity")}</Tab>
          <Tab value="notes">{t("Notes")}</Tab>
        </TabList>
        <TabPanel value="activity">
          {tab === "activity" && (
            <JobDetailActivity jobId={job.id} request={assistantRequest as OwnerRequest} />
          )}
        </TabPanel>
        <TabPanel value="notes">
          {tab === "notes" && (
            <JobDetailNotes
              job={job}
              notes={notes}
              onOpenNote={(note) => {
                setDetail(null);
                setNoteEdit(note);
                setView("Notes");
              }}
            />
          )}
        </TabPanel>
      </Tabs>
    </div>
  );
}
