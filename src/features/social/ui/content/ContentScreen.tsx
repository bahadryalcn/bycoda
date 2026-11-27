import { redactDiagnosticText } from "@bycoda/account-contracts";
import { InlineError } from "../../../../shared/ui/InlineError";
import { LoadingText } from "../../../../shared/ui/LoadingText";
import { Text } from "../../../../shared/ui/Text";
import { useMemo, useState } from "react";
import { formatDate, t } from "../../../../shared/i18n";
import { useConfirm } from "../../../../shared/ui/ConfirmDialog";
import { Button } from "../../../../shared/ui/Button";
import { CollectionFooter } from "../../../../shared/ui/ContinuousList";
import { ChevronLeft, ChevronRight, Plus } from "../../../../shared/ui/icons";
import { InlineMessage } from "../../../../shared/ui/InlineError";
import { SegmentedControl } from "../../../../shared/ui/SegmentedControl";
import { useSocialMediaEditor } from "../../hooks/useSocialMediaEditor";
import type { SocialCampaign } from "../../model/social";
import { EmptyHint } from "../common/EmptyHint";
import { DisabledReason, gateProps, type ActionGate } from "../common/DisabledReason";
import { postHasLockingJob } from "./contentGate";
import type { SocialScreenProps } from "../shell/screens";
import { ContentCalendar } from "./ContentCalendar";
import { ContentEditor, type EditorOutcome } from "./ContentEditor";
import { ContentList, type ContentListStatus } from "./ContentList";
import { ContentProgramReview } from "./ContentProgramReview";
import { localDateTimeInput } from "../../model/socialProgramForm";
import { socialQueryScope } from "../../model/socialQuery";
import {
  calendarEntries,
  dayKey,
  monthCells,
  shiftMonth,
  shiftWeek,
  weekDays,
  visibleRange,
  type CalendarView,
} from "./calendarModel";
import { draftFromCampaign, emptyDraft } from "./contentDraft";
import { useContentData } from "./useContentData";
import { useContentDraft } from "./useContentDraft";
import { SnapchatContentList } from "./SnapchatContentList";
import "./content.css";

const OUTCOME_TEXT: Record<EditorOutcome, () => string> = {
  published: () => t("Posts are being published. Follow the results in this calendar."),
  scheduled: () => t("Posts scheduled. Follow the results in this calendar."),
  draft: () => t("Draft saved."),
  program: () => t("Repeating program saved as paused. Review it before it starts."),
};

/** Content: calendar or list of posts, and one editor for new and saved posts. */
export function ContentScreen({
  client,
  projectId,
  shellState,
  active,
  onNavigate,
}: SocialScreenProps) {
  const confirmation = useConfirm();
  const reviewScope = JSON.stringify([...socialQueryScope(client), projectId]);
  const [programReview, setProgramReview] = useState<{ scope: string; id: string }>();
  const reviewId = programReview?.scope === reviewScope ? programReview.id : undefined;
  const editor = useSocialMediaEditor(client);
  const [views, setViews] = useState<Record<string, CalendarView>>({});
  const view = views[reviewScope] ?? "week";
  const setView = (next: CalendarView) =>
    setViews((current) => ({ ...current, [reviewScope]: next }));
  const [anchor, setAnchor] = useState(() => Date.now());
  // The calendar asks the Host for the posts scheduled in the days it shows, not for the newest pages.
  const data = useContentData(
    client,
    projectId,
    active,
    view === "list" ? undefined : visibleRange(view, anchor),
  );
  const [accountFilter, setAccountFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<ContentListStatus>("all");
  const workspace = useContentDraft(client, projectId);
  const { draft, setDraft, open, setOpen, notice, setNotice, dirty } = workspace;
  const snapshot = data.snapshot;
  const accounts = snapshot?.accounts ?? [];
  const entries = useMemo(
    () => calendarEntries(data.scheduledJobs, accounts),
    [data.scheduledJobs, accounts],
  );
  const findCampaign = (campaignId: string) =>
    snapshot?.campaigns.find((item) => item.id === campaignId) ??
    data.scheduledCampaigns.find((item) => item.id === campaignId);
  const newGate: ActionGate = !projectId
    ? { disabled: true, disabledReason: t("Choose a project first.") }
    : !snapshot
      ? { disabled: true, disabledReason: t("Loading accounts…") }
      : { disabled: false };
  const lockedReason =
    draft.campaignId &&
    postHasLockingJob(draft.campaignId, [...(snapshot?.jobs ?? []), ...data.scheduledJobs])
      ? t("This post was already scheduled or sent, so it can't be edited here.")
      : undefined;

  const openNew = (day?: number) => {
    let scheduledAt = "";
    if (day !== undefined) {
      const now = Date.now();
      const preferred = new Date(`${dayKey(day)}T09:00`).getTime();
      const nextMinute = (Math.floor(now / 60_000) + 1) * 60_000;
      const start = Math.max(preferred, nextMinute);
      if (dayKey(start) !== dayKey(day)) return;
      scheduledAt = localDateTimeInput(start);
    }
    setNotice(undefined);
    if (!dirty) {
      workspace.loadDraft(
        day === undefined ? emptyDraft() : { ...emptyDraft(), when: "later", scheduledAt },
      );
    }
    setOpen(true);
  };
  const openCampaign = (campaign: SocialCampaign) => {
    if (dirty) {
      setNotice({
        tone: "warning",
        text: t("Finish the post you are writing first, or discard it."),
      });
      return;
    }
    setNotice(undefined);
    workspace.loadDraft(draftFromCampaign(campaign, accounts));
    setOpen(true);
  };
  const discard = async () => {
    const confirmed = await confirmation.confirm({
      title: t("Discard draft?"),
      message: t("Your unsaved post will be removed."),
      confirmLabel: t("Discard draft"),
      danger: true,
    });
    if (confirmed) {
      workspace.loadDraft(emptyDraft());
      setNotice(undefined);
    }
  };
  const close = () => {
    setOpen(false);
    if (!dirty) workspace.loadDraft(emptyDraft());
  };
  // The Host saved the post before a later publish step could fail: later saves revise it, not copy it.
  const saved = (identity: { campaignId: string; revision: number }) =>
    setDraft((current) => ({
      ...current,
      campaignId: identity.campaignId,
      revision: identity.revision,
    }));
  const done = (outcome: EditorOutcome) => {
    workspace.reset();
    if (outcome === "program") setView("list");
    setNotice({ tone: "success", text: OUTCOME_TEXT[outcome]() });
    data.refetch();
  };

  const isEmpty =
    !!snapshot &&
    snapshot.campaigns.length === 0 &&
    data.programs.length === 0 &&
    !data.programsError;
  const youtubeAccounts = accounts.filter(
    (account) =>
      account.platform === "youtube" && account.connected && account.connection !== "browser",
  );
  const youtubeAccount =
    youtubeAccounts.find((account) => account.id === accountFilter) ?? youtubeAccounts[0];
  const days = view === "week" ? weekDays(anchor) : monthCells(anchor);
  const shift = (step: number) =>
    setAnchor((value) => (view === "week" ? shiftWeek(value, step) : shiftMonth(value, step)));
  const rangeLabel =
    view === "week"
      ? `${formatDate(days[0]!, { day: "numeric", month: "short" })} – ${formatDate(days[6]!, { day: "numeric", month: "short" })}`
      : formatDate(anchor, { month: "long", year: "numeric" });

  const collectionErrors = projectId
    ? [
        {
          cause: data.refreshError,
          title: t("Could not refresh posts."),
          retry: data.retrySnapshot,
        },
        {
          cause: data.programsError,
          title: t("Could not load repeating programs."),
          retry: data.retryPrograms,
        },
        {
          cause: data.scheduledError,
          title: t("Could not load scheduled posts."),
          retry: data.retryScheduled,
        },
      ]
    : [];
  return (
    <section className="content-screen">
      {!isEmpty || youtubeAccount ? (
        <div className="content-toolbar">
          {!isEmpty && projectId && !data.error && !data.loading ? (
            <SegmentedControl
              label={t("View")}
              selectionRole="radio"
              value={view}
              options={[
                { value: "week", label: t("Week") },
                { value: "month", label: t("Month") },
                { value: "list", label: t("List") },
              ]}
              onValueChange={(value) => setView(value as CalendarView)}
            />
          ) : null}
          {!isEmpty && projectId && !data.error && !data.loading && view !== "list" ? (
            <div className="content-range">
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                label={t("Previous")}
                onClick={() => shift(-1)}
              >
                <ChevronLeft className="icon-sm" aria-hidden />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAnchor(Date.now())}>
                {t("Today")}
              </Button>
              <Button variant="ghost" size="sm" iconOnly label={t("Next")} onClick={() => shift(1)}>
                <ChevronRight className="icon-sm" aria-hidden />
              </Button>
              <Text
                size="secondary"
                tone="secondary"
                leading="inherit"
                className="content-range-label"
              >
                {rangeLabel}
              </Text>
            </div>
          ) : null}
          <span className="content-toolbar-primary">
            {youtubeAccount ? (
              <Button
                onClick={() =>
                  onNavigate("accounts", { accountId: youtubeAccount.id, youtubeSection: "videos" })
                }
              >
                {t("Videos and playlists")}
              </Button>
            ) : null}
            {!isEmpty && projectId ? (
              <DisabledReason
                variant="primary"
                size="sm"
                startIcon={<Plus className="icon-sm" aria-hidden />}
                onClick={() => openNew()}
                {...gateProps(newGate)}
              >
                {t("New post")}
              </DisabledReason>
            ) : null}
          </span>
        </div>
      ) : null}
      {notice ? (
        <InlineMessage tone={notice.tone === "success" ? "success" : "warning"}>
          {notice.text}
        </InlineMessage>
      ) : null}
      {!open
        ? workspace.operationError?.map(({ title, details }, index) => (
            <InlineError key={index} details={details}>
              {title}
            </InlineError>
          ))
        : null}
      {!open && dirty ? (
        <InlineMessage
          tone="neutral"
          action={{ label: t("Resume draft"), onClick: () => setOpen(true) }}
          secondaryAction={{
            label: t("Discard draft"),
            disabled: workspace.busy || workspace.uploading,
            onClick: () => void discard().catch(() => undefined),
          }}
        >
          {t("You have an unsaved post.")}
        </InlineMessage>
      ) : null}
      {collectionErrors.map(({ cause, title, retry }) =>
        cause ? (
          <InlineError
            key={title}
            details={cause instanceof Error ? redactDiagnosticText(cause.message) : undefined}
            retry={{ onRetry: retry, label: t("Try again") }}
          >
            {title}
          </InlineError>
        ) : null,
      )}
      {!projectId ? (
        <EmptyHint
          illustration="no-projects"
          title={t("No project selected")}
          message={t("Choose a project at the top to see its posts.")}
        />
      ) : data.error ? (
        <InlineError
          details={redactDiagnosticText(data.error.message)}
          retry={{ onRetry: data.retrySnapshot ?? data.refetch, label: t("Try again") }}
        >
          {t("Could not load posts.")}
        </InlineError>
      ) : data.loading ? (
        <LoadingText layout="fill" delay={false} className="flex-1">
          {t("Loading posts…")}
        </LoadingText>
      ) : isEmpty ? (
        <EmptyHint
          illustration="inbox-empty"
          title={t("No posts yet")}
          message={t("Create a post or let AI plan the week, then schedule or publish it.")}
          action={{ label: t("New post"), onClick: () => openNew(), ...newGate }}
          fillWithAi={{
            onClick: () => onNavigate("command", { prompt: t("Plan this week's posts") }),
          }}
        />
      ) : (
        <>
          {view === "list" ? (
            <ContentList
              campaigns={snapshot?.campaigns ?? []}
              jobs={snapshot?.jobs ?? []}
              accounts={accounts}
              programs={data.programs}
              accountFilter={accountFilter}
              statusFilter={statusFilter}
              onAccountFilter={setAccountFilter}
              onStatusFilter={setStatusFilter}
              onReviewProgram={(program) =>
                setProgramReview({ scope: reviewScope, id: program.id })
              }
              onOpen={(campaignId) => {
                const campaign = findCampaign(campaignId);
                if (campaign) openCampaign(campaign);
              }}
            />
          ) : data.scheduledLoading ? (
            <LoadingText delay={false}>{t("Loading…")}</LoadingText>
          ) : data.scheduledUnavailable ? null : (
            <ContentCalendar
              view={view}
              anchor={anchor}
              entries={entries}
              onPickDay={(day) => openNew(day)}
              onOpen={(campaignId) => {
                const campaign = findCampaign(campaignId);
                if (campaign) openCampaign(campaign);
              }}
            />
          )}
        </>
      )}
      {/* Older pages only matter to the list; the calendar already holds everything scheduled in its days. */}
      {view === "list" && data.moreError ? (
        <InlineError
          details={redactDiagnosticText(data.moreError)}
          retry={{ onRetry: data.loadMore, label: t("Try again") }}
        >
          {t("Could not load more posts.")}
        </InlineError>
      ) : (
        <CollectionFooter
          hasMore={view === "list" && data.hasMore}
          loading={data.loadingMore}
          onLoadMore={data.loadMore}
        />
      )}
      {snapshot ? (
        <SnapchatContentList
          key={projectId}
          client={client}
          accounts={accounts.filter(
            (account) =>
              account.platform === "snapchat" &&
              account.accountType === "public_profile" &&
              (!projectId || account.grants[projectId]?.includes("read")),
          )}
          capabilities={snapshot.capabilities}
          executorId={snapshot.executorId}
          projectId={projectId}
          disabled={!active || !shellState.hostOnline || shellState.unreachable}
        />
      ) : null}
      {open && projectId ? (
        <ContentEditor
          key={workspace.key}
          client={client}
          editor={editor}
          snapshot={snapshot}
          projectId={projectId}
          shell={shellState}
          draft={draft}
          onDraft={setDraft}
          locked={lockedReason}
          operationPending={workspace.busy}
          mediaPending={workspace.uploading}
          onBusyChange={workspace.setBusy}
          onMediaBusyChange={workspace.setUploading}
          operationError={workspace.operationError}
          onOperationError={workspace.setOperationError}
          onSaved={saved}
          onDone={done}
          onClose={close}
          onNavigate={onNavigate}
        />
      ) : null}
      {reviewId && active && projectId ? (
        <ContentProgramReview
          key={`${reviewScope}:${reviewId}`}
          id={reviewId}
          client={client}
          accounts={accounts}
          available={shellState.hostOnline && !shellState.unreachable}
          onChange={data.refetch}
          onClose={() =>
            setProgramReview((current) =>
              current?.scope === reviewScope && current.id === reviewId ? undefined : current,
            )
          }
        />
      ) : null}
      {confirmation.dialog}
    </section>
  );
}
