import { useSocialPending } from "./useSocialPending";
import { useContext as useSocialContext } from "react";
import { SocialBusyContext as SocialLockContext } from "./socialContext";
import { SocialFilters } from "./SocialFilters";
import { getLocale, t, useLocale } from "../../../shared/i18n";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { NativeSelect } from "../../../shared/ui/Select";
import { TextField } from "../../../shared/ui/TextField";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { useState } from "react";
import { socialRows } from "../model/socialWorkspace";
import { useSocialWorkspaceFilter } from "./useSocialWorkspaceFilter";
import type { SocialJob, SocialSnapshot } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import {
  Empty,
  Notice,
  StatusBadge,
  names,
  statuses,
  time,
  type Props,
  type Run,
} from "./socialShared";

const jobKinds: Record<SocialJob["kind"], string> = {
  get publish() {
    return t("Post");
  },
  get reply() {
    return t("Reply");
  },
  get message() {
    return t("Message");
  },
  get comment() {
    return t("Comment");
  },
};
const PAGE_SIZE = 30;
export function socialJobExplanation(job: SocialJob): string {
  if (job.status === "cancelled")
    return t("This job was cancelled; nothing is waiting to be sent.");
  if (job.status === "review")
    return t(
      "The result could not be verified. Check the account; do not resend the same content.",
    );
  if (job.status === "failed")
    return t("Sending failed. Check the detail and retry this target if needed.");
  if (job.status === "queued") return t("Scheduled send: {p0}", { p0: time(job.scheduledAt) });
  if (job.status === "running") return t("Waiting for the result from the platform.");
  return t("The platform confirmed the send.");
}
function resultUrl(value?: string) {
  try {
    const parsed = new URL(value ?? "");
    return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

export function SocialHistory({ snapshot, client, run, onFilterChange }: Props) {
  useLocale();
  const waiting = snapshot.jobCounts
    ? (snapshot.jobCounts.queued ?? 0) + (snapshot.jobCounts.running ?? 0)
    : snapshot.jobs.filter((job) => job.status === "queued" || job.status === "running").length;
  const attention = snapshot.jobCounts
    ? (snapshot.jobCounts.failed ?? 0) + (snapshot.jobCounts.review ?? 0)
    : snapshot.jobs.filter((job) => job.status === "failed" || job.status === "review").length;
  return (
    <div className="social-history-page">
      <div className="social-section-heading">
        <div>
          <h2>{t("Send history")}</h2>
        </div>
      </div>
      <div className="social-stats social-history-summary" aria-label={t("Send summary")}>
        <div>
          <strong>
            {snapshot.jobCounts?.succeeded ??
              snapshot.jobs.filter((job) => job.status === "succeeded").length}
          </strong>
          <span>{statuses.succeeded}</span>
        </div>
        <div>
          <strong>{waiting}</strong>
          <span>{t("Waiting")}</span>
        </div>
        <div>
          <strong>{attention}</strong>
          <span>{t("Needs attention")}</span>
        </div>
        <div>
          <strong>
            {snapshot.jobCounts?.cancelled ??
              snapshot.jobs.filter((job) => job.status === "cancelled").length}
          </strong>
          <span>{statuses.cancelled}</span>
        </div>
      </div>
      {!snapshot.sendingEnabled || snapshot.stopped || !snapshot.hostOnline ? (
        <Notice
          kind="warning"
          title={
            snapshot.stopped
              ? t("Sending stopped")
              : !snapshot.hostOnline
                ? t("Sending service offline")
                : t("Sending is off")
          }
        >
          {t("Queued jobs are kept. Manage sending controls in Automations.")}
        </Notice>
      ) : null}
      <JobHistory snapshot={snapshot} client={client} run={run} onFilterChange={onFilterChange} />
    </div>
  );
}

export function JobHistory({
  snapshot,
  client,
  run,
  jobs = snapshot.jobs,
  onFilterChange,
}: {
  snapshot: SocialSnapshot;
  client: SocialClient;
  run: Run;
  jobs?: SocialJob[];
  onFilterChange?: Props["onFilterChange"];
}) {
  const pendingUi = useSocialPending();
  const socialLocked = useSocialContext(SocialLockContext);
  useLocale();
  const campaigns = socialRows(snapshot.campaigns, snapshot.related?.campaigns);
  const contacts = socialRows(snapshot.contacts, snapshot.related?.contacts);
  const [status, setStatus] = useState("");
  const [accountId, setAccountId] = useState("");
  const [kind, setKind] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [since, setSince] = useState("");
  const hostFiltered = useSocialWorkspaceFilter(
    snapshot,
    "jobs",
    {
      query,
      status,
      accountId,
      kind,
      ...(since ? { since: new Date(`${since}T00:00:00`).getTime() } : {}),
    },
    onFilterChange,
  );
  const filtered = jobs
    .filter((job) => {
      if (hostFiltered && onFilterChange) return true;
      const account = snapshot.accounts.find((item) => item.id === job.accountId);
      const campaign = campaigns.find((item) => item.id === job.campaignId);
      const contact = contacts.find((item) => item.id === job.contactId);
      return (
        (!status || job.status === status) &&
        (!accountId || job.accountId === accountId) &&
        (!kind || job.kind === kind) &&
        (!since || job.createdAt >= new Date(`${since}T00:00:00`).getTime()) &&
        `${account?.name ?? ""} ${campaign?.name ?? ""} ${contact?.name ?? ""} ${job.payload.text} ${job.error ?? ""}`
          .toLocaleLowerCase(getLocale())
          .includes(query.toLocaleLowerCase(getLocale()))
      );
    })
    .sort((a, b) => b.createdAt - a.createdAt || b.scheduledAt - a.scheduledAt);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  const reset = () => {
    setQuery("");
    setStatus("");
    setAccountId("");
    setKind("");
    setSince("");
    setPage(0);
  };
  return (
    <div className="social-job-list">
      <div className="social-list-tools social-history-filters">
        <label className="social-history-search">
          {t("Search jobs")}
          <SearchInput
            disabled={socialLocked}
            appearance="field"
            type="search"
            value={query}
            placeholder={t("Content, contact or campaign")}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </label>
        <SocialFilters
          activeCount={[status, accountId, kind, since].filter(Boolean).length}
          onReset={reset}
        >
          <label>
            {t("Send status")}
            <NativeSelect
              disabled={socialLocked}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(0);
              }}
            >
              <option value="">
                {t("All jobs")} ·{" "}
                {onFilterChange && snapshot.jobCounts
                  ? Object.values(snapshot.jobCounts).reduce(
                      (total, count) => total + (count ?? 0),
                      0,
                    )
                  : jobs.length}
              </option>
              {["queued", "running", "succeeded", "failed", "review", "cancelled"].map((item) => (
                <option key={item} value={item}>
                  {statuses[item]} ·{" "}
                  {(onFilterChange
                    ? snapshot.jobCounts?.[item as SocialJob["status"]]
                    : undefined) ?? jobs.filter((job) => job.status === item).length}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label>
            {t("Account")}
            <SearchableSelect
              disabled={socialLocked}
              value={accountId}
              label={t("Account")}
              options={[
                { value: "", label: t("All accounts") },
                ...snapshot.accounts.map((item) => ({
                  value: item.id,
                  label: [item.name, "·", names[item.platform]].join(" "),
                })),
              ]}
              onChange={(nextValue) => {
                setAccountId(nextValue);
                setPage(0);
              }}
              searchLocale={getLocale()}
            />
          </label>
          <label>
            {t("Job type")}
            <NativeSelect
              disabled={socialLocked}
              value={kind}
              onChange={(event) => {
                setKind(event.target.value);
                setPage(0);
              }}
            >
              <option value="">{t("All jobs")}</option>
              {Object.entries(jobKinds).map(([id, title]) => (
                <option key={id} value={id}>
                  {title}
                </option>
              ))}
            </NativeSelect>
          </label>
          <div>
            <TextField
              disabled={socialLocked}
              label={t("Start date")}
              type="date"
              value={since}
              onChange={(event) => {
                setSince(event.target.value);
                setPage(0);
              }}
            />
          </div>
        </SocialFilters>
      </div>
      <p className="social-inline-meta" role="status">
        {t("{p0} jobs", {
          p0: hostFiltered && onFilterChange ? snapshot.pages?.jobs?.total : filtered.length,
        })}
        {!hostFiltered && filtered.length !== jobs.length ? ` / ${jobs.length}` : ""}
        {status || accountId || kind || query || since ? (
          <Button disabled={socialLocked} variant="secondary" type="button" onClick={reset}>
            {t("Clear filters")}
          </Button>
        ) : null}
      </p>
      {filtered.length ? (
        <div className="social-history-records">
          {(onFilterChange && snapshot.pages
            ? filtered
            : filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
          ).map((job) => {
            const account = snapshot.accounts.find((item) => item.id === job.accountId);
            const campaign = campaigns.find((item) => item.id === job.campaignId);
            const contact = contacts.find((item) => item.id === job.contactId);
            const link = resultUrl(job.url);
            return (
              <article key={job.id} className="social-history-record" data-status={job.status}>
                <div className="social-record-heading">
                  <div>
                    <strong>
                      {jobKinds[job.kind]} · {campaign?.name ?? contact?.name ?? t("Conversation")}
                    </strong>
                    <p className="social-inline-meta">
                      {account?.name ?? t("Account removed")}
                      {account ? ` · ${names[account.platform]}` : ""}
                    </p>
                  </div>
                  <StatusBadge status={job.status} />
                </div>
                <p className="social-job-explanation">{socialJobExplanation(job)}</p>
                <p className="social-history-excerpt">{job.payload.text}</p>
                <details className="social-history-metadata">
                  <summary>{t("Job details")}</summary>
                  <div className="social-inline-meta">
                    <span>{t("Created {p0}", { p0: time(job.createdAt) })}</span>
                    {job.dispatchedAt ? (
                      <span>{t("Send started {p0}", { p0: time(job.dispatchedAt) })}</span>
                    ) : null}
                    {job.attempts ? <span>{t("{p0} attempts", { p0: job.attempts })}</span> : null}
                  </div>
                </details>
                {job.error && job.status !== "cancelled" ? (
                  <details className="social-job-error">
                    <summary>{t("Result detail")}</summary>
                    <p>{job.error}</p>
                  </details>
                ) : null}
                {job.visibility ? (
                  <p className="social-muted">
                    {t("Video: {p0}", {
                      p0:
                        job.visibility === "public"
                          ? t("Public")
                          : job.visibility === "private"
                            ? t("Private")
                            : t("Unlisted"),
                    })}
                  </p>
                ) : null}
                <div className="social-actions">
                  {link ? (
                    <a className="social-result-link" href={link} target="_blank" rel="noreferrer">
                      {t("Open on platform")}
                    </a>
                  ) : null}
                  {job.status === "failed" ? (
                    <>
                      <Badge variant="label" appearance="outline">
                        {account
                          ? `${account.name} · ${names[account.platform]}`
                          : t("Account removed")}
                      </Badge>
                      <Button
                        loading={pendingUi.is(`job.retry:${job.id}`)}
                        disabled={socialLocked}
                        variant="secondary"
                        type="button"
                        onClick={() =>
                          void pendingUi.run(`job.retry:${job.id}`, () =>
                            run(
                              () => client.request("jobs.retry", { id: job.id }),
                              t("Failed target was queued again."),
                            ),
                          )
                        }
                      >
                        {t("Retry this target")}
                      </Button>
                    </>
                  ) : null}
                  {job.status === "queued" ? (
                    <Button
                      loading={pendingUi.is(`job.cancel:${job.id}`)}
                      disabled={socialLocked}
                      variant="danger"
                      type="button"
                      className="ml-auto"
                      onClick={() =>
                        void pendingUi.run(`job.cancel:${job.id}`, () =>
                          run(
                            () => client.request("jobs.cancel", { id: job.id }),
                            t("Queued job cancelled."),
                          ),
                        )
                      }
                    >
                      {t("Cancel job")}
                    </Button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty title={jobs.length ? t("No jobs match these filters") : t("Nothing sent yet")}>
          {jobs.length
            ? t("Clear the filters to see other jobs.")
            : t("Scheduled posts, messages and replies will appear here with their results.")}
        </Empty>
      )}
      {!onFilterChange && filtered.length > PAGE_SIZE ? (
        <div className="social-pagination">
          <Button
            variant="secondary"
            type="button"
            disabled={socialLocked || currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            {t("Previous")}
          </Button>
          <span>
            {currentPage + 1} / {Math.ceil(filtered.length / PAGE_SIZE)}
          </span>
          <Button
            variant="secondary"
            type="button"
            disabled={socialLocked || (currentPage + 1) * PAGE_SIZE >= filtered.length}
            onClick={() => setPage(currentPage + 1)}
          >
            {t("Next")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
