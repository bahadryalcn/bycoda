import { useSocialPending } from "./useSocialPending";
import { useContext as useSocialContext } from "react";
import { SocialBusyContext as SocialLockContext } from "./socialContext";
import { SocialFilters } from "./SocialFilters";
import { getLocale, t, useLocale } from "../../../shared/i18n";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { NativeSelect } from "../../../shared/ui/Select";
import { DateTimeField } from "../../../shared/ui/DateTimePicker";
import { Button } from "../../../shared/ui/Button";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { ContinuousList } from "../../../shared/ui/ContinuousList";
import { useState } from "react";
import { socialRows } from "../model/socialWorkspace";
import { socialQueryScope } from "../model/socialQuery";
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
export type SocialHistoryAccountIntent = { accountId: string; token: number };

/** Mirrors the currently shipped Host guard; the Host still authorizes cancellation. */
export function socialJobCancellation(job: SocialJob) {
  const submitted = Boolean(
    job.preparation?.youtubeVideoId ||
    job.preparation?.tiktokPublishId ||
    job.preparation?.snapchatMedia?.spotlightId ||
    job.preparation?.facebookReel?.stage === "submitted",
  );
  return {
    allowed: job.status === "queued" && !submitted,
    reason:
      submitted || job.status === "running"
        ? t("A dispatched send cannot be recalled. Stop the account to prevent later sends.")
        : job.status !== "queued"
          ? t("Only queued jobs can be cancelled.")
          : "",
  };
}

function processing(job: SocialJob) {
  return job.status === "queued" && !socialJobCancellation(job).allowed;
}

function JobState({ job }: { job: SocialJob }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      <StatusBadge
        status={job.status}
        label={
          processing(job)
            ? t("Platform processing")
            : job.status === "succeeded"
              ? t("Dispatch accepted")
              : undefined
        }
      />
      {job.delivery ? (
        <StatusBadge
          status={
            job.delivery.status === "failed"
              ? "failed"
              : job.delivery.status === "delivered" || job.delivery.status === "read"
                ? "succeeded"
                : "info"
          }
          label={
            {
              accepted: t("Delivery unconfirmed"),
              sent: t("Sent; delivery unconfirmed"),
              delivered: t("Delivered"),
              read: t("Read"),
              failed: t("Delivery failed"),
            }[job.delivery.status]
          }
        />
      ) : null}
    </span>
  );
}
export function socialJobExplanation(job: SocialJob): string {
  if (job.status === "succeeded" && job.delivery) {
    return {
      accepted: t("The platform accepted the message. Delivery has not been confirmed."),
      sent: t("The message was sent. Recipient delivery has not been confirmed."),
      delivered: t("The platform confirmed recipient delivery."),
      read: t("The platform confirmed that the recipient read the message."),
      failed: t(
        "The platform reported a delivery failure. The message will not be resent automatically.",
      ),
    }[job.delivery.status];
  }
  if (job.status === "cancelled")
    return t("This job was cancelled; nothing is waiting to be sent.");
  if (job.status === "review")
    return t(
      "The result could not be verified. Check the account; do not resend the same content.",
    );
  if (job.status === "failed")
    return t("Sending failed. Check the detail and retry this target if needed.");
  if (job.status === "queued" && processing(job))
    return t(
      "The platform accepted the video and is processing it. Publication is not yet confirmed.",
    );
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

export function SocialHistory({
  snapshot,
  client,
  run,
  onFilterChange,
  accountIntent,
  onLoadMore,
  loadingMore,
  loadError,
}: Props & {
  accountIntent?: SocialHistoryAccountIntent;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  loadError?: string;
}) {
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
          <span>{t("Dispatch accepted")}</span>
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
      {snapshot.jobs.some((job) => job.delivery?.status === "failed") ? (
        <Notice
          kind="error"
          title={t("Delivery failures in loaded records: {p0}", {
            p0: snapshot.jobs.filter((job) => job.delivery?.status === "failed").length,
          })}
        >
          {t(
            "A delivery failure does not queue another send. Check the platform result before taking action.",
          )}
        </Notice>
      ) : null}
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
      <JobHistory
        snapshot={snapshot}
        client={client}
        run={run}
        onFilterChange={onFilterChange}
        accountIntent={accountIntent}
        onLoadMore={onLoadMore}
        loadingMore={loadingMore}
        loadError={loadError}
      />
    </div>
  );
}

export function JobHistory({
  snapshot,
  client,
  run,
  jobs = snapshot.jobs,
  onFilterChange,
  accountIntent,
  onLoadMore,
  loadingMore,
  loadError,
}: {
  snapshot: SocialSnapshot;
  client: SocialClient;
  run: Run;
  jobs?: SocialJob[];
  onFilterChange?: Props["onFilterChange"];
  accountIntent?: SocialHistoryAccountIntent;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  loadError?: string;
}) {
  const socialLocked = useSocialContext(SocialLockContext);
  useLocale();
  const campaigns = socialRows(snapshot.campaigns, snapshot.related?.campaigns);
  const contacts = socialRows(snapshot.contacts, snapshot.related?.contacts);
  const [status, setStatus] = useState("");
  const [accountId, setAccountId] = useState("");
  const [kind, setKind] = useState("");
  const [query, setQuery] = useState("");
  const [since, setSince] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const intentKey = accountIntent ? `${accountIntent.token}:${accountIntent.accountId}` : "";
  const [appliedIntent, setAppliedIntent] = useState("");
  if (accountIntent && intentKey !== appliedIntent) {
    setAppliedIntent(intentKey);
    setAccountId(accountIntent.accountId);
    setSelectedId(null);
  }
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
  const remotePage = onFilterChange && snapshot.pages?.jobs;
  const shown = filtered;
  const selected = (selectedId ? jobs.find((job) => job.id === selectedId) : shown[0]) ?? null;
  const reset = () => {
    setQuery("");
    setStatus("");
    setAccountId("");
    setKind("");
    setSince("");
  };
  return (
    <div className="social-job-list @container/history">
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
            <DateTimeField
              mode="date"
              disabled={socialLocked}
              label={t("Start date")}
              clearable
              value={since}
              onChange={(next) => {
                setSince(next);
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
      {filtered.length || selected ? (
        <div
          className="grid min-w-0 grid-cols-1 gap-3 @min-[760px]/history:grid-cols-[minmax(15rem,0.85fr)_minmax(0,1.4fr)]"
          data-social-history-workspace
        >
          <div className="flex min-w-0 flex-col gap-1" aria-label={t("Activity records")}>
            {!shown.length ? (
              <Empty title={t("No jobs match these filters")}>
                <Button variant="link" onClick={reset}>
                  {t("Clear filters")}
                </Button>
              </Empty>
            ) : null}
            <ContinuousList
              items={shown}
              itemKey={(job) => job.id}
              stateKey={`social-history:${socialQueryScope(client).join(":")}:${snapshot.executorId}:${snapshot.programProjectId ?? "all"}:${status}:${accountId}:${kind}:${since}`}
              requiredKey={selected?.id}
              estimateSize={104}
              className="social-history-continuous-list"
              hasMore={
                !socialLocked &&
                !!remotePage &&
                remotePage.offset + remotePage.limit < remotePage.total
              }
              loading={loadingMore}
              error={remotePage ? loadError : undefined}
              onLoadMore={remotePage ? onLoadMore : undefined}
              renderItem={(job) => {
                const account = snapshot.accounts.find((item) => item.id === job.accountId);
                const campaign = campaigns.find((item) => item.id === job.campaignId);
                const contact = contacts.find((item) => item.id === job.contactId);
                const title =
                  campaign?.name || contact?.name || job.payload.recipientId || jobKinds[job.kind];
                return (
                  <article
                    key={job.id}
                    className="social-history-record min-w-0"
                    data-status={job.status}
                  >
                    <Button
                      variant="item"
                      layout="stacked"
                      selected={selected?.id === job.id}
                      aria-current={selected?.id === job.id ? "true" : undefined}
                      tooltip={title}
                      tooltipWhen="overflow"
                      tooltipDetails={
                        job.payload.text && title !== jobKinds[job.kind]
                          ? [jobKinds[job.kind]]
                          : undefined
                      }
                      onClick={() => setSelectedId(job.id)}
                      className="w-full min-w-0"
                    >
                      <span className="line-clamp-1 min-w-0 text-ui-secondary font-medium">
                        {title}
                      </span>
                      <span className="line-clamp-2 min-w-0 wrap-anywhere text-ui-caption text-(--ui-text-secondary)">
                        {job.payload.text || jobKinds[job.kind]}
                      </span>
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ui-micro text-(--ui-text-secondary)">
                        <span className="min-w-0 truncate">
                          {account?.name ?? t("Account removed")}
                          {account ? ` · ${names[account.platform]}` : ""}
                        </span>
                        <time dateTime={new Date(job.createdAt).toISOString()}>
                          {t("Created {p0}", { p0: time(job.createdAt) })}
                        </time>
                      </span>
                      <JobState job={job} />
                      {job.status === "review" || job.delivery?.status === "failed" ? (
                        <span className="text-ui-caption text-(--ui-tone-warning-fg)">
                          {socialJobExplanation(job)}
                        </span>
                      ) : null}
                    </Button>
                  </article>
                );
              }}
            />
          </div>
          {selected ? (
            <JobDetail
              job={selected}
              snapshot={snapshot}
              client={client}
              run={run}
              outsideFilters={!filtered.some((job) => job.id === selected.id)}
              onClearFilters={reset}
            />
          ) : (
            <Empty>{t("Select an activity record to inspect its result.")}</Empty>
          )}
        </div>
      ) : (
        <Empty title={jobs.length ? t("No jobs match these filters") : t("Nothing sent yet")}>
          {jobs.length
            ? t("Clear the filters to see other jobs.")
            : t("Scheduled posts, messages and replies will appear here with their results.")}
          {jobs.length ? (
            <Button variant="ghost" onClick={reset}>
              {t("Clear filters")}
            </Button>
          ) : null}
        </Empty>
      )}
    </div>
  );
}

function JobDetail({
  job,
  snapshot,
  client,
  run,
  outsideFilters,
  onClearFilters,
}: {
  job: SocialJob;
  snapshot: SocialSnapshot;
  client: SocialClient;
  run: Run;
  outsideFilters: boolean;
  onClearFilters: () => void;
}) {
  useLocale();
  const pendingUi = useSocialPending();
  const socialLocked = useSocialContext(SocialLockContext);
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  const account = snapshot.accounts.find((item) => item.id === job.accountId);
  const contacts = socialRows(snapshot.contacts, snapshot.related?.contacts);
  const campaigns = socialRows(snapshot.campaigns, snapshot.related?.campaigns);
  const contact = contacts.find((item) => item.id === job.contactId);
  const campaign = campaigns.find((item) => item.id === job.campaignId);
  const link = resultUrl(job.url);
  const cancellation = socialJobCancellation(job);
  const errorSummary =
    job.error && job.error.length > 320 ? `${job.error.slice(0, 320)}…` : job.error;
  const perform = (action: "jobs.retry" | "jobs.cancel", key: string, message: string) => {
    setActionError(null);
    return pendingUi.run(key, () =>
      run(async () => {
        try {
          return await client.request(action, { id: job.id });
        } catch (reason) {
          setActionError({
            id: job.id,
            message: reason instanceof Error ? reason.message : String(reason),
          });
          throw reason;
        }
      }, message),
    );
  };
  return (
    <section
      className="flex min-w-0 flex-col gap-3 border-l border-(--ui-tone-neutral-border) pl-3"
      aria-label={t("Activity result")}
      data-social-job-detail
      data-job-id={job.id}
    >
      <header className="flex min-w-0 flex-col gap-1">
        <h3 className="wrap-anywhere text-ui-title font-medium">
          {campaign?.name || contact?.name || job.payload.recipientId || jobKinds[job.kind]}
        </h3>
        <p className="wrap-anywhere text-ui-caption text-(--ui-text-secondary)">
          {jobKinds[job.kind]} · {account?.name ?? t("Account removed")}
          {account ? ` · ${names[account.platform]}` : ""}
        </p>
        <JobState job={job} />
        <time
          className="text-ui-caption text-(--ui-text-secondary)"
          dateTime={new Date(job.createdAt).toISOString()}
        >
          {t("Created {p0}", { p0: time(job.createdAt) })}
        </time>
        {job.status === "queued" && !processing(job) ? (
          <p className="text-ui-caption text-(--ui-text-secondary)">
            {t("Scheduled send: {p0}", { p0: time(job.scheduledAt) })}
          </p>
        ) : null}
        {job.delivery ? (
          <time
            className="text-ui-caption text-(--ui-text-secondary)"
            dateTime={new Date(job.delivery.at).toISOString()}
          >
            {t("Latest delivery update: {p0}", { p0: time(job.delivery.at) })}
          </time>
        ) : null}
      </header>
      {outsideFilters ? (
        <Notice kind="info">
          {t("This result is outside the current filters.")}{" "}
          <Button variant="link" onClick={onClearFilters}>
            {t("Clear filters")}
          </Button>
        </Notice>
      ) : null}
      <p className="wrap-anywhere text-ui-secondary">{socialJobExplanation(job)}</p>
      {job.error && job.status !== "cancelled" ? (
        <Notice
          kind={job.status === "failed" || job.delivery?.status === "failed" ? "error" : "warning"}
        >
          <p className="whitespace-pre-wrap wrap-anywhere">{errorSummary}</p>
          {job.error.length > 320 ? (
            <details>
              <summary>{t("Show full error")}</summary>
              <p className="mt-2 whitespace-pre-wrap wrap-anywhere">{job.error}</p>
            </details>
          ) : null}
        </Notice>
      ) : null}
      <div className="whitespace-pre-wrap wrap-anywhere text-ui-body" data-social-job-content>
        {job.payload.text}
      </div>
      {job.payload.link ? (
        <p className="wrap-anywhere text-ui-caption">
          {t("Link")}:{" "}
          {resultUrl(job.payload.link) ? (
            <a href={resultUrl(job.payload.link)} target="_blank" rel="noreferrer">
              {job.payload.link}
            </a>
          ) : (
            job.payload.link
          )}
        </p>
      ) : null}
      {job.payload.media.length ? (
        <ul className="flex min-w-0 flex-col gap-2" aria-label={t("Media")}>
          {job.payload.media.map((media, index) => (
            <li
              key={`${index}:${media.uploadId || media.url}`}
              className="wrap-anywhere text-ui-caption text-(--ui-text-secondary)"
            >
              <span className="font-medium">
                {t(
                  media.kind === "image" ? "Image" : media.kind === "video" ? "Video" : "Document",
                )}
                {media.title ? ` · ${media.title}` : ""}
              </span>
              {media.alt ? (
                <p>
                  {t("Description")}: {media.alt}
                </p>
              ) : null}
              {media.url ? (
                <p>
                  {resultUrl(media.url) ? (
                    <a href={resultUrl(media.url)} target="_blank" rel="noreferrer">
                      {media.url}
                    </a>
                  ) : (
                    media.url
                  )}
                </p>
              ) : null}
              {media.uploadId ? (
                <p>
                  {t("Upload")}: {media.uploadId}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {job.visibility ? (
        <p className="text-ui-caption text-(--ui-text-secondary)">
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
      {job.payload.recipientId ||
      job.payload.threadId ||
      job.payload.postId ||
      job.payload.objectPostId ? (
        <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-ui-caption">
          {[
            [t("Recipient"), job.payload.recipientId],
            [t("Conversation"), job.payload.threadId],
            [t("Post"), job.payload.postId || job.payload.objectPostId],
          ].map(([label, value]) =>
            value ? (
              <div key={label} className="contents">
                <dt className="text-(--ui-text-secondary)">{label}</dt>
                <dd className="wrap-anywhere">{value}</dd>
              </div>
            ) : null,
          )}
        </dl>
      ) : null}
      <details className="text-ui-caption text-(--ui-text-secondary)">
        <summary>{t("Technical details")}</summary>
        <div className="mt-2 flex min-w-0 flex-col gap-1">
          <span className="wrap-anywhere">
            {t("Record ID")}: {job.id}
          </span>
          {job.dispatchedAt ? (
            <span>{t("Send started {p0}", { p0: time(job.dispatchedAt) })}</span>
          ) : null}
          {job.attempts ? <span>{t("{p0} attempts", { p0: job.attempts })}</span> : null}
          {job.platformId ? (
            <span className="wrap-anywhere">
              {t("Platform reference")}: {job.platformId}
            </span>
          ) : null}
          {job.delivery?.code !== undefined ? (
            <span>
              {t("Delivery code")}: {job.delivery.code}
            </span>
          ) : null}
          {job.payload.youtube ||
          job.payload.tiktok ||
          job.payload.facebook ||
          job.payload.snapchat ? (
            <pre className="max-w-full overflow-auto whitespace-pre-wrap wrap-anywhere">
              {JSON.stringify(
                {
                  youtube: job.payload.youtube,
                  tiktok: job.payload.tiktok,
                  facebook: job.payload.facebook,
                  snapchat: job.payload.snapchat,
                },
                null,
                2,
              )}
            </pre>
          ) : null}
        </div>
      </details>
      {actionError?.id === job.id ? <Notice kind="error">{actionError.message}</Notice> : null}
      <div className="flex flex-wrap items-center gap-2">
        {link ? (
          <a className="social-result-link" href={link} target="_blank" rel="noreferrer">
            {t("Open on platform")}
          </a>
        ) : null}
        {job.status === "failed" ? (
          <Button
            variant="secondary"
            loading={pendingUi.is(`job.retry:${job.id}`)}
            disabled={socialLocked}
            onClick={() =>
              void perform(
                "jobs.retry",
                `job.retry:${job.id}`,
                t("Failed target was queued again."),
              )
            }
          >
            {t("Retry this target")}
          </Button>
        ) : null}
        {cancellation.allowed ? (
          <Button
            variant="danger"
            loading={pendingUi.is(`job.cancel:${job.id}`)}
            disabled={socialLocked}
            onClick={() =>
              void perform("jobs.cancel", `job.cancel:${job.id}`, t("Queued job cancelled."))
            }
          >
            {t("Cancel job")}
          </Button>
        ) : null}
      </div>
      {cancellation.reason && (job.status === "queued" || job.status === "running") ? (
        <p className="text-ui-caption text-(--ui-text-secondary)">{cancellation.reason}</p>
      ) : null}
    </section>
  );
}
