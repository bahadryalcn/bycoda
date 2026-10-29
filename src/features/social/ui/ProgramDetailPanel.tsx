import { useContext } from "react";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { ConfirmMorph } from "../../../shared/ui/ConfirmMorph";
import { TextField } from "../../../shared/ui/TextField";
import { dateTimeFormat } from "../../../shared/lib/intl";
import { t, useLocale } from "../../../shared/i18n";
import type { SocialSnapshot } from "../model/social";
import type { ProgramDetail, SocialProgram } from "../model/socialProgram";
import { localDateTimeInput } from "../model/socialProgramForm";
import { ProgramTargetEditor } from "./ProgramTargetEditor";
import { SocialBusyContext } from "./socialContext";
import { Notice, type Props } from "./socialShared";
import { useSocialPending } from "./useSocialPending";

/** Placeholder for a selected program whose record is loading or failed to load. */
export function ProgramDetailPending({
  summary,
  error,
  refreshing,
  onRetry,
}: {
  summary?: SocialProgram;
  error: unknown;
  refreshing: boolean;
  onRetry: () => void;
}) {
  const detailError = error;
  const selectedSummary = summary;
  return (
    <section
      className="social-program-detail social-program-detail-pending"
      aria-label={selectedSummary?.name ?? t("Selected program")}
      aria-busy={!detailError}
    >
      <header className="social-record-heading">
        <h3>{selectedSummary?.name ?? t("Selected program")}</h3>
        {selectedSummary ? (
          <span className="social-muted">
            {selectedSummary.enabled
              ? t("Active")
              : selectedSummary.cancelled
                ? t("Cancelled")
                : t("Paused")}
          </span>
        ) : null}
      </header>
      {detailError ? (
        <Notice kind="error" title={t("Could not load this program")}>
          {String(detailError)}{" "}
          <Button
            type="button"
            variant="secondary"
            loading={refreshing}
            onClick={() => onRetry()}
          >
            {t("Retry")}
          </Button>
        </Notice>
      ) : (
        <Notice kind="loading">{t("Loading program…")}</Notice>
      )}
    </section>
  );
}

/** Selected program: usage, controls, review confirmation, calendar and target editors. */
export function ProgramDetailPanel({
  detail,
  error: detailError,
  refreshing,
  onRetry,
  snapshot,
  client,
  run,
  perform,
  confirmed,
  onConfirmedChange,
  bulkLink,
  onBulkLinkChange,
  onEdit,
  onDetailChange,
}: {
  detail: ProgramDetail;
  error: unknown;
  refreshing: boolean;
  onRetry: () => void;
  snapshot: SocialSnapshot;
  client: Props["client"];
  run: Props["run"];
  perform: (action: string, input: Record<string, unknown>) => Promise<boolean>;
  confirmed: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
  bulkLink: string;
  onBulkLinkChange: (link: string) => void;
  onEdit: (program: SocialProgram) => void;
  onDetailChange: (
    update: (previous: ProgramDetail | undefined) => ProgramDetail,
  ) => void;
}) {
  const pendingUi = useSocialPending();
  const socialLocked = useContext(SocialBusyContext);
  const busy = socialLocked;
  const locale = useLocale();
  return (
    <section className="social-program-detail">
      <header className="social-record-heading">
        <h3>{detail.program.name}</h3>
        <span className="social-muted">
          {detail.program.enabled ? t("Active") : t("Paused")}
        </span>
      </header>
      {detailError ? (
        <Notice kind="error" title={t("Could not refresh this program")}>
          {String(detailError)}{" "}
          <Button
            type="button"
            variant="secondary"
            loading={refreshing}
            onClick={() => onRetry()}
          >
            {t("Retry")}
          </Button>
        </Notice>
      ) : null}
      {detail.program.reason ? <Notice>{detail.program.reason}</Notice> : null}
      <details className="social-program-advanced">
        <summary>{t("Generation usage")}</summary>
        <p className="social-muted">
          {t("Generation usage")}: {detail.program.generationCount}/
          {detail.program.limits.totalGenerations} · {t("Images")}:{" "}
          {detail.program.imageGenerationCount}/{detail.program.limits.maxImageGenerations}
        </p>
      </details>
      <details className="social-program-advanced">
        <summary>{t("Link for future drafts")}</summary>
        <TextField
          disabled={socialLocked}
          label={t("Link for future drafts")}
          type="url"
          value={bulkLink}
          onChange={(e) => onBulkLinkChange(e.target.value)}
        />
        <Button
          type="button"
          variant="secondary"
          loading={pendingUi.is("programs.apply-link-to-editable-drafts")}
          disabled={socialLocked || busy}
          onClick={() =>
            void pendingUi.run("programs.apply-link-to-editable-drafts", () =>
              perform("programs.bulk-edit", {
                id: detail.program.id,
                expectedRevision: detail.program.revision,
                link: bulkLink,
              }),
            )
          }
        >
          {t("Apply link to editable drafts")}
        </Button>
      </details>
      <div className="social-toolbar-actions">
        <Button
          type="button"
          variant="secondary"
          loading={pendingUi.is("programs.generate-next-content")}
          disabled={socialLocked || busy || detail.program.cancelled}
          onClick={() =>
            void pendingUi.run("programs.generate-next-content", () =>
              perform("programs.generate", { id: detail.program.id }),
            )
          }
        >
          {t("Generate next content")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={socialLocked || busy}
          onClick={() => onEdit(detail.program)}
        >
          {t("Edit campaign settings")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          loading={pendingUi.is("programs.pause")}
          disabled={socialLocked || busy}
          onClick={() =>
            void pendingUi.run("programs.pause", () =>
              perform("programs.pause", { id: detail.program.id }),
            )
          }
        >
          {t("Pause")}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-(--ui-tone-neutral-border) pt-2">
        <ConfirmMorph
          label={t("Cancel future publications")}
          tone="danger"
          confirmLabel={t("Cancel publications")}
          pendingLabel={t("Cancelling…")}
          doneLabel={t("Cancelled")}
          errorLabel={t("Cancel failed")}
          disabled={busy || detail.program.cancelled}
          onConfirm={async () => {
            if (!(await perform("programs.cancel", { id: detail.program.id })))
              throw new Error(t("Cancel failed"));
          }}
        />
      </div>
      <label className="social-program-confirm">
        <Checkbox
          disabled={socialLocked}
          checked={confirmed}
          onChange={(e) => onConfirmedChange(e.target.checked)}
        />
        {t(
          "I reviewed this revision, its accounts, schedule, models, budgets and approval steps.",
        )}
      </label>
      {detail.program.enabled || detail.program.cancelled || !confirmed ? (
        <small className="social-muted">
          {detail.program.cancelled
            ? t("This campaign was cancelled.")
            : detail.program.enabled
              ? t("This campaign is already active.")
              : t("Tick the review confirmation above to activate.")}
        </small>
      ) : null}
      <div className="social-actions">
        {detail.program.accountIds.map((accountId) => (
          <Badge key={accountId} variant="label" appearance="outline">
            {snapshot.accounts.find((account) => account.id === accountId)?.name ?? accountId}
          </Badge>
        ))}
        <Button
          type="button"
          variant="secondary"
          loading={pendingUi.is("programs.activate-reviewed-campaign")}
          disabled={
            socialLocked ||
            busy ||
            !confirmed ||
            detail.program.cancelled ||
            detail.program.enabled
          }
          onClick={() =>
            void pendingUi.run("programs.activate-reviewed-campaign", () =>
              perform("programs.activate", {
                id: detail.program.id,
                expectedRevision: detail.program.revision,
                confirm: true,
              }),
            )
          }
        >
          {t("Activate reviewed campaign")}
        </Button>
      </div>
      {!snapshot.sendingEnabled || snapshot.stopped ? (
        <Notice>
          {t(
            "External sending is disabled. Campaign activation does not change sending permissions.",
          )}
        </Notice>
      ) : null}
      <div className="social-program-calendar">
        {detail.occurrences.map((o) => (
          <article key={o.id}>
            <header>
              <strong>#{o.sequence + 1}</strong>
              <time>
                {dateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: detail.program.schedule.timeZone,
                }).format(o.scheduledAt)}
              </time>
            </header>
            {o.originalAt !== o.scheduledAt ? (
              <p>
                {t("Rescheduled from")}:{" "}
                {dateTimeFormat(locale, {
                  year: "numeric",
                  month: "numeric",
                  day: "numeric",
                  hour: "numeric",
                  minute: "numeric",
                  second: "numeric",
                }).format(new Date(o.originalAt))}
              </p>
            ) : null}
            {!o.targets.some((t) => t.jobId) ? (
              <TextField
                label={t("Reschedule (device local time)")}
                type="datetime-local"
                disabled={socialLocked || busy}
                defaultValue={localDateTimeInput(o.scheduledAt)}
                onBlur={(e) => {
                  const at = new Date(e.target.value).getTime();
                  if (at !== o.scheduledAt && Number.isFinite(at))
                    void perform("programs.reschedule", {
                      id: detail.program.id,
                      occurrenceId: o.id,
                      scheduledAt: at,
                    });
                }}
              />
            ) : null}
            {o.targets.map((target) => (
              <ProgramTargetEditor
                key={`${o.id}:${target.accountId}`}
                target={target}
                occurrence={o}
                program={detail.program}
                busy={busy}
                perform={perform}
                client={client}
                accountName={
                  snapshot.accounts.find((account) => account.id === target.accountId)?.name
                }
              />
            ))}
          </article>
        ))}
      </div>
      {detail.nextBefore !== undefined ? (
        <Button
          loading={pendingUi.is("programs.load-older-posts")}
          disabled={socialLocked}
          type="button"
          variant="secondary"
          onClick={() =>
            void pendingUi.run("programs.load-older-posts", () =>
              run(async () => {
                const older = await client.request<ProgramDetail>("programs.status", {
                  id: detail.program.id,
                  before: detail.nextBefore,
                });
                onDetailChange((d) =>
                  d
                    ? { ...older, occurrences: [...older.occurrences, ...d.occurrences] }
                    : older,
                );
              }),
            )
          }
        >
          {t("Load older posts")}
        </Button>
      ) : null}
    </section>
  );
}
