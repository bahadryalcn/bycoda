import { Text } from "../../../../shared/ui/Text";
import { errorText } from "../../../../shared/lib/errors";
import type { AssistantSnapshot } from "../../../../shared/model/host-contracts/assistant";
import { t } from "../../../../shared/i18n";
import { isImeComposition } from "../../../../shared/lib/keyboard";
import { Button } from "../../../../shared/ui/Button";
import { Heading } from "../../../../shared/ui/Heading";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
import { PromptField } from "../../../../shared/ui/PromptField";
import { assistantJobProjectIds } from "../../model/assistantJobs";
import styles from "./Jobs.module.css";
import { finished } from "./assistantRoomHelpers";
import { useAssistantRoom } from "./assistantRoomContext";
import { JobRow } from "./JobRow";

/** Today shows this many active jobs; the full list lives on the Jobs tab. */
const TODAY_JOB_LIMIT = 3;

export function JobsTab({ snapshot }: { snapshot: AssistantSnapshot }) {
  const room = useAssistantRoom();
  const {
    environmentId,
    privacy,
    identity,
    view,
    setView,
    query,
    setQuery,
    filter,
    setFilter,
    jobProjectFilter,
    setJobProjectFilter,
    jobDateFilter,
    setJobDateFilter,
    setJobEdit,
    pending,
    error,
    selected,
    setSelected,
    setDetail,
    jobText,
    setJobText,
    jobReview,
    prepareJobReview,
    openJobReview,
    submitJobs,
    jobDraftVisible,
    props,
    control,
    reviewJobTasks,
    bulk,
    visibleSelectedCount,
    allJobs,
    active,
    projectName,
    errorFor,
  } = room;

  const confirmJobs = snapshot.profile.confirmJobs === true;
  const canStart =
    jobDraftVisible &&
    jobText.trim().length > 0 &&
    !pending &&
    (snapshot.capabilities.jobs ||
      snapshot.capabilities.quickNotes ||
      snapshot.capabilities.quickAutomations);
  function start() {
    if (!canStart) return;
    const prepared = prepareJobReview(jobText);
    if (confirmJobs) openJobReview(prepared);
    else
      submitJobs(prepared).catch((error: unknown) =>
        room.setError({ key: "jobs.create", text: errorText(error) }),
      );
  }
  const todayJobs = view === "Today" ? allJobs.slice(0, TODAY_JOB_LIMIT) : allJobs;
  const filtered = Boolean(query || filter || jobProjectFilter || jobDateFilter !== "all");

  return (
    <section className={styles.section}>
      <PromptField
        label={t("Give {p0} a job", { p0: identity.name })}
        frameClassName={styles.composer}
        value={jobDraftVisible ? jobText : ""}
        disabled={!jobDraftVisible}
        minRows={1}
        maxRows={4}
        maxLength={16000}
        placeholder={t("Give {p0} a job", { p0: identity.name })}
        onChange={(event) => setJobText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey || isImeComposition(event.nativeEvent))
            return;
          event.preventDefault();
          start();
        }}
        toolbarTrailing={
          <Button
            variant="primary"
            disabled={!canStart}
            loading={pending?.key === "jobs.create"}
            onClick={start}
          >
            {t(confirmJobs ? "Review jobs" : "Start")}
          </Button>
        }
      />
      {!jobDraftVisible && (
        <Text as="p" size="caption" tone="secondary" leading="inherit" className={styles.notice}>
          {t("The selected project is no longer visible.")}
        </Text>
      )}
      {!snapshot.capabilities.jobs && (
        <Text as="p" size="caption" tone="secondary" leading="inherit" className={styles.notice}>
          {t("Job execution is unavailable on this Host.")}
        </Text>
      )}
      {!jobReview && errorFor("jobs.create")}
      <div className={styles.listHead}>
        {view === "Today" && allJobs.length > 0 && <SectionLabel>{t("Active jobs")}</SectionLabel>}
        {visibleSelectedCount > 0 && (
          <Text as="div" size="caption" tone="secondary" leading="inherit" className={styles.bulk}>
            <span>{t("{p0} selected", { p0: visibleSelectedCount })}</span>
            <Button size="sm" disabled={Boolean(pending)} onClick={() => bulk("stop")}>
              {t("Stop")}
            </Button>
            <Button
              size="sm"
              disabled={Boolean(pending)}
              tone="danger"
              onClick={() => bulk("delete")}
            >
              {t("Delete")}
            </Button>
          </Text>
        )}
        {view === "Today" && active.length > TODAY_JOB_LIMIT && (
          <Button variant="link" onClick={() => setView("Jobs")}>
            {t("View all")}
          </Button>
        )}
      </div>
      {todayJobs.length ? (
        <div className={styles.list} data-selection={visibleSelectedCount > 0 || undefined}>
          {todayJobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              projectName={assistantJobProjectIds(job).map(projectName).join(" · ")}
              selected={selected.has(job.id)}
              selectionMode={visibleSelectedCount > 0}
              busy={pending?.key === job.id}
              disabled={Boolean(pending)}
              error={error?.key === job.id ? error.text : ""}
              onEdit={
                job.kind !== "quick" && !finished(job) && environmentId
                  ? (mode) => setJobEdit({ job, mode, environmentId, scopeKey: privacy.key })
                  : undefined
              }
              onSelect={(checked) =>
                setSelected((current) => {
                  const next = new Set(current);
                  if (checked) next.add(job.id);
                  else next.delete(job.id);
                  return next;
                })
              }
              onDetails={() => setDetail(job.id)}
              onControl={(action) => control(job, action)}
              onReviewTasks={props.onReviewJobTasks ? () => reviewJobTasks(job) : undefined}
            />
          ))}
        </div>
      ) : view === "Jobs" ? (
        <Text as="div" size="inherit" tone="secondary" className={styles.empty}>
          <Heading size="item" level={3}>
            {t(filtered ? "No matching jobs" : "No jobs yet")}
          </Heading>
          {filtered ? (
            <Button
              variant="secondary"
              onClick={() => {
                setQuery("");
                setFilter("");
                setJobProjectFilter("");
                setJobDateFilter("all");
              }}
            >
              {t("Reset")}
            </Button>
          ) : (
            <p>{t("Give {p0} a job", { p0: identity.name })}</p>
          )}
        </Text>
      ) : null}
      {errorFor("bulk")}
    </section>
  );
}
