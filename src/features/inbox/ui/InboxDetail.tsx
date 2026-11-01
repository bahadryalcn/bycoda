import { Alert } from "../../../shared/ui/Alert";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Tab, TabList, TabPanel, Tabs } from "../../../shared/ui/Tabs";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { t, useLocale, getLocale } from "../../../shared/i18n";
import { useGithubPrChecks } from "../hooks/useGithubPrChecks";
import { summarizePrChecks } from "../model/githubPrChecks";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Check,
  Copy,
  ExternalLink,
  GitCompare,
  MessageSquare,
  MessageMultiple,
} from "../../../shared/ui/icons";
import { useEffect, useId, useRef, useState, type ComponentPropsWithRef } from "react";
import { InboxProviderMark } from "./InboxProviderMark";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import {
  githubReviewDecisionLabel,
  githubWorkItemComment,
  githubWorkItemThread,
  gitlabAttentionLabel,
  inboxItemRef,
  inboxItemKey,
  inboxItemStatus,
  formatRelativeTime,
  inboxPersonAvatarUrl,
  type InboxItem,
} from "../model/githubTasks";
import { copyText } from "../../../platform/tauri/clipboard";
import { providerLabel } from "../../../shared/lib/providerLabel";
import { projectName } from "../../../shared/lib/paths";
import { playCue } from "../../settings/model/sounds";
import { sameProjectPath } from "../../projects/model/recents";
import { sessionDisplayTitle } from "../../sessions/model/session";
import type { SessionSummary } from "../../sessions/data/sessionStore";
import { linearIssueComment, linearIssueThread } from "../model/linear";
import { jiraIssueComment, jiraIssueThread } from "../model/jira";
import { gitlabWorkItemComment, gitlabWorkItemThread } from "../model/gitlab";
import { azureDevOpsWorkItemComment, azureDevOpsWorkItemThread } from "../model/azureDevOps";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import { SurfaceSelection } from "../../sessions/ui/SurfaceSelection";
import { InboxComments, InboxCommentForm, type InboxReplyTarget } from "./InboxComments";
import { InboxPrDiff } from "./InboxPrDiff";
import { InboxPrChecks, PrChecksTab } from "./InboxPrChecks";
import { GithubPrActions } from "./InboxPrActions";
import {
  InboxProjectOption,
  inboxStatusMark,
  InboxPerson,
  InboxProjectPicker,
  InboxLabel,
  CiRepairProps,
} from "./InboxPresentation";
import { InboxDescriptionSummary, InboxPrChangesGlance } from "./InboxPrOverview";
import { useInboxDetailData } from "./useInboxDetailData";

/** The body is the PR tabs' one shared panel; an issue has no tabs and stays a plain region. */
function DetailBody({
  tabbed,
  ...props
}: ComponentPropsWithRef<"div"> & { tabbed: boolean }) {
  return tabbed ? <TabPanel {...props} /> : <div {...props} />;
}

export function inboxShowsFullFileDiff(item: InboxItem): boolean {
  return item.provider === "github" && item.kind === "pr";
}

export function InboxDetail({
  item,
  cwd,
  projects,
  revision,
  relatedSessions,
  mode = "inbox",
  visible = true,
  onDiscuss,
  onStart,
  repairSessions,
  onRepairChecks,
  onOpenSession,
  onItemChange,
}: {
  item: InboxItem;
  cwd: string;
  projects: InboxProjectOption[];
  revision: number;
  relatedSessions: readonly SessionSummary[];
  mode?: "inbox" | "panel";
  visible?: boolean;
  onDiscuss?: () => void;
  onStart?: (item: InboxItem, body?: string) => void | Promise<void>;
  repairSessions?: CiRepairProps["repairSessions"];
  onRepairChecks?: CiRepairProps["onRepairChecks"];
  onOpenSession?: (sessionId: string) => void | Promise<void>;
  onItemChange?: (item: InboxItem) => void;
}) {
  useLocale();
  const detailLock = useLockOverscroll<HTMLDivElement>();
  const panel = mode === "panel";
  const tabsId = useId();
  const [diffFocusPath, setDiffFocusPath] = useState<string | undefined>();
  const [tab, setTab] = useState<"summary" | "code" | "checks">("summary");
  const [diffMode, setDiffMode] = useState<"hunks" | "full">("hunks");
  const fullFile = inboxShowsFullFileDiff(item) && diffMode === "full";
  const {
    linear,
    jira,
    tracker,
    jiraKey,
    gitlab,
    azuredevops,
    isPr,
    githubKind,
    gitlabKind,
    azureDevOpsKind,
    details,
    loading,
    error,
    prDiff,
    diffLoading,
    diffError,
    thread,
    setThread,
    threadLoading,
    threadError,
  } = useInboxDetailData(item, revision, tab, fullFile, panel);
  const externalActionLabel =
    item.kind === "pr"
      ? gitlab
        ? "Review on GitLab"
        : azuredevops
          ? "Review on ADO"
          : "Review on GitHub"
      : linear
        ? "Open in Linear"
        : jira
          ? "Open in Jira"
          : gitlab
            ? "Open on GitLab"
            : azuredevops
              ? "Open on ADO"
              : "Open on GitHub";
  const commentScope = `${cwd}:${item.projectPath}:${inboxItemKey(item)}`;
  const [replyTo, setReplyTo] = useRetainedState<InboxReplyTarget | null>(
    `inbox:reply:${commentScope}`, null,
  );
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [postRefreshError, setPostRefreshError] = useState<string | null>(null);
  const [threadRefreshing, setThreadRefreshing] = useState(false);
  const postingRef = useRef(false);
  const defaultProject =
    projects.find((project) => sameProjectPath(project.path, cwd))?.path ??
    projects[0]?.path ??
    cwd;
  const [startProject, setStartProject] = useState(defaultProject);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const chooseStartProject = tracker || ((gitlab || azuredevops) && !item.projectPath);
  const statusMark = inboxStatusMark(item);
  const status = tracker ? item.state || inboxItemStatus(item) : t(statusMark.label);

  const source = tracker ? item.teamName || item.repo : item.repo || projectName(item.projectPath);
  const attentionLabel =
    gitlab || azuredevops ? gitlabAttentionLabel(item.attentionReason ?? "") : "";
  const markdownCwd = chooseStartProject ? startProject || cwd : item.projectPath || cwd;
  const authorName = details?.author?.trim() ?? "";
  const extraAssignees = item.assignees.filter(
    (person) => !authorName || person.login.trim().toLowerCase() !== authorName.toLowerCase(),
  );
  const showAssignment = extraAssignees.length > 0 || item.assignees.length === 0;
  const reviewDecision = details?.reviewDecision?.trim() || thread?.reviewDecision?.trim() || "";
  const reviewLabel = githubReviewDecisionLabel(reviewDecision);
  const baseRef = details?.baseRefName?.trim() || thread?.baseRefName?.trim() || "";
  const headRef = details?.headRefName?.trim() || thread?.headRefName?.trim() || "";

  // Checks load as soon as a code-host PR is open, whatever tab is active. The
  // panel passes revision 0, so its loads ride on mount and the identity key.
  const prChecksEnabled =
    isPr &&
    (item.provider === "github" || item.provider === "gitlab" || item.provider === "azuredevops");
  const prChecksView = useGithubPrChecks({
    provider:
      item.provider === "gitlab" || item.provider === "azuredevops" ? item.provider : "github",
    cwd: item.projectPath || cwd,
    repo: item.repo,
    number: item.number,
    enabled: prChecksEnabled,
    open: isPr && item.state.trim().toLowerCase() === "open",
    poll: visible,
    revision,
  });
  const prChecksOverall = prChecksEnabled
    ? summarizePrChecks({
        loading: prChecksView.loading,
        error: prChecksView.error,
        checks: prChecksView.checks?.checks ?? null,
      })
    : null;

  const refreshPostedThread = async () => {
    setThreadRefreshing(true);
    try {
      const next = linear
        ? await linearIssueThread(item.id ?? "", { force: true })
        : jira
          ? await jiraIssueThread(jiraKey, { force: true })
          : gitlabKind
            ? await gitlabWorkItemThread(item.repo, gitlabKind, item.number, { force: true })
            : azureDevOpsKind
              ? await azureDevOpsWorkItemThread(item.repo, azureDevOpsKind, item.number, { force: true })
              : githubKind
                ? await githubWorkItemThread(item.projectPath, item.repo, githubKind, item.number, { force: true })
                : null;
      if (next) setThread(next);
      setPostRefreshError(null);
    } catch (err: unknown) {
      setPostRefreshError(err instanceof Error ? err.message : String(err));
    } finally {
      setThreadRefreshing(false);
    }
  };

  const postComment = async (body: string) => {
    if (postingRef.current) throw new Error("Comment already in progress");
    postingRef.current = true;
    setPosting(true);
    setPostError(null);
    try {
      if (linear) {
        await linearIssueComment(item.id ?? "", body, { parentId: replyTo?.id });
      } else if (jira) {
        await jiraIssueComment({ id: item.id ?? "", key: jiraKey }, body);
      } else if (gitlabKind) {
        await gitlabWorkItemComment(item.repo, gitlabKind, item.number, body);
      } else if (azureDevOpsKind) {
        await azureDevOpsWorkItemComment(item.repo, azureDevOpsKind, item.number, body);
      } else {
        if (!githubKind) throw new Error("Unknown inbox item");
        await githubWorkItemComment(item.projectPath, item.repo, githubKind, item.number, body, {
          inReplyTo: replyTo?.threadId,
        });
      }
      // Only a confirmed write clears the originating draft. A failed read-back
      // has its own retry and must never resubmit the provider mutation.
      setReplyTo(null);
      await refreshPostedThread();
    } catch (err: unknown) {
      setPostError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      postingRef.current = false;
      setPosting(false);
    }
  };

  const identityRow = (
    <div
      data-inbox-detail-identity
      data-inbox-detail-fixed-header={panel ? "" : undefined}
      className={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ui-caption text-(--ui-text-secondary) ${
        panel ? "h-9 shrink-0 border-b border-(--ui-tone-neutral-border) px-4 pr-[34px]" : ""
      }`}
    >
      <InboxProviderMark provider={item.provider} className="icon-sm shrink-0" />
      <span className="shrink-0">
        {item.kind === "pr" ? (gitlab ? t("Merge request") : t("Pull request")) : t("Issue")}
      </span>
      <span className="shrink-0 tabular-nums">{inboxItemRef(item)}</span>
      <span className={`flex shrink-0 items-center gap-1 ${statusMark.className}`}>
        <statusMark.Icon className="icon-sm" strokeWidth={1.75} />
        {status}
      </span>
      {attentionLabel ? (
        <span className="shrink-0 text-(--ui-tone-accent-fg)">{attentionLabel}</span>
      ) : null}
      {source ? <span className="min-w-0 wrap-anywhere">{source}</span> : null}
      {panel ? (
        <Button
          variant="ghost"
          type="button"
          tooltip={externalActionLabel}
          aria-label={externalActionLabel}
          disabled={!item.url}
          disabledReason={item.url ? undefined : t("No link available")}
          onClick={() => void openUrl(item.url)}
        >
          <ExternalLink className="icon-sm" strokeWidth={1.75} />
          <span className="@max-[420px]/linked:hidden">{externalActionLabel}</span>
        </Button>
      ) : null}
    </div>
  );

  return (
    <Tabs
      id={tabsId}
      value={tab}
      onValueChange={(next) => {
        if (next === "code") setDiffFocusPath(undefined);
        setTab(next);
      }}
      panels="shared"
    >
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        {panel ? identityRow : null}
        <div
          ref={panel ? detailLock : undefined}
          data-inbox-detail-scroll={panel ? "" : undefined}
          className={panel ? "min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-none" : "contents"}
        >
          <div
            data-inbox-detail-header
            className={`relative border-b border-(--ui-tone-neutral-border) ${panel ? "" : "shrink-0"}`}
          >
            <div
              className={`flex w-full min-w-0 flex-col gap-2 px-4 pt-3 ${isPr ? "" : "pb-3"}`}
            >
              <header className={`flex flex-col ${panel ? "gap-2" : "gap-2.5"}`}>
                <h1
                  title={item.title}
                  className={`break-words font-medium leading-tight text-(--ui-tone-neutral-fg) ${
                    panel ? "text-ui-heading" : "text-ui-heading"
                  }`}
                >
                  {item.title}
                </h1>
                {panel ? null : identityRow}
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ui-caption text-(--ui-text-secondary)">
                  {authorName ? (
                    <InboxPerson
                      name={authorName}
                      avatarUrl={inboxPersonAvatarUrl(
                        item.provider,
                        authorName,
                        details?.authorAvatarUrl,
                      )}
                      size="sm"
                    />
                  ) : null}
                  {showAssignment ? (
                    <>
                      {authorName ? <span aria-hidden>·</span> : null}
                      {extraAssignees.length > 0 ? (
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                          {extraAssignees.map((person) => (
                            <InboxPerson
                              key={person.login}
                              name={person.login}
                              avatarUrl={inboxPersonAvatarUrl(
                                item.provider,
                                person.login,
                                person.avatarUrl,
                              )}
                              size="sm"
                            />
                          ))}
                        </span>
                      ) : (
                        <span>{t("Unassigned")}</span>
                      )}
                    </>
                  ) : null}
                  {item.createdAt && formatRelativeTime(item.createdAt) ? (
                    <>
                      <span aria-hidden>·</span>
                      <time
                        dateTime={item.createdAt}
                        title={new Date(item.createdAt).toLocaleString(getLocale())}
                      >
                        {t("Created ")}
                        {formatRelativeTime(item.createdAt)}
                      </time>
                    </>
                  ) : null}
                  {formatRelativeTime(item.updatedAt) ? (
                    <>
                      <span aria-hidden>·</span>
                      <span>
                        {t("Updated ")}
                        {formatRelativeTime(item.updatedAt)}
                      </span>
                    </>
                  ) : null}
                  {baseRef && headRef ? (
                    <>
                      <span aria-hidden>·</span>
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <GitCompare className="icon-xs shrink-0" strokeWidth={1.75} />
                        <span className="min-w-0 wrap-anywhere">
                          {baseRef} ← {headRef}
                        </span>
                        <CopyBranchNameButton branch={headRef} />
                      </span>
                    </>
                  ) : null}
                  {reviewLabel ? (
                    <Badge
                      tone={
                        reviewDecision.toUpperCase() === "APPROVED"
                          ? "success"
                          : reviewDecision.toUpperCase() === "CHANGES_REQUESTED"
                            ? "danger"
                            : "neutral"
                      }
                    >
                      {reviewLabel}
                    </Badge>
                  ) : null}
                </div>
                {item.labels.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {item.labels.map((label) => (
                      <InboxLabel key={label.name} label={label} />
                    ))}
                  </div>
                ) : null}
                {!panel && relatedSessions.length > 0 ? (
                  <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
                    <span className="mr-0.5 inline-flex shrink-0 items-center gap-1 text-ui-micro text-(--ui-text-secondary)">
                      <MessageMultiple className="icon-sm" strokeWidth={1.75} />
                      {t("Related")} {relatedSessions.length === 1 ? t("thread") : t("threads")}
                    </span>
                    {relatedSessions.map((session) => {
                      const title = sessionDisplayTitle(session.title, session.harness);
                      return (
                        <Button
                          variant="ghost"
                          key={session.id}
                          type="button"
                          tooltip={t("Open thread: {p0}", { p0: title })}
                          onClick={() => void onOpenSession?.(session.id)}
                          className="min-w-0 max-w-64"
                        >
                          <span className="truncate">{title}</span>
                          {session.archived ? (
                            <span className="shrink-0 text-(--ui-text-secondary)">
                              {t("Archived")}
                            </span>
                          ) : null}
                        </Button>
                      );
                    })}
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-0.5" data-inbox-detail-actions>
                <div role="group" aria-label={t("Agent actions")} data-inbox-actions="agent" className="flex flex-wrap items-center gap-2">
                  {onStart && item.kind !== "pr" ? (
                    <>
                      <Button
                        variant="primary"
                        type="button"
                        disabled={
                          starting ||
                          (chooseStartProject &&
                            (projects.length === 0 || !startProject || loading || !!error))
                        }
                        onClick={() => {
                          if (starting) return;
                          setStarting(true);
                          setStartError(null);
                          const next = chooseStartProject
                            ? { ...item, projectPath: startProject }
                            : item;
                          void Promise.resolve(onStart(next, tracker ? details?.body : undefined))
                            .catch((err: unknown) => {
                              setStartError(err instanceof Error ? err.message : String(err));
                            })
                            .finally(() => setStarting(false));
                        }}
                      >
                        {starting ? t("Sending...") : t("Send to agent")}
                      </Button>
                      {!chooseStartProject && item.repo ? (
                        <span className="min-w-0 max-w-48 truncate text-ui-caption text-(--ui-text-secondary)">
                          {t("in {p0}", { p0: item.repo })}
                        </span>
                      ) : null}
                      {chooseStartProject ? (
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="text-ui-caption text-(--ui-text-secondary)">{t("Agent working folder")}</span>
                          <InboxProjectPicker projects={projects} value={startProject} onChange={setStartProject} />
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  {onDiscuss ? (
                    <Button variant="secondary" type="button" onClick={onDiscuss}>
                      <MessageSquare className="icon-sm" strokeWidth={1.75} /> {t("Ask")}
                    </Button>
                  ) : null}
                </div>
                <div role="group" aria-label={t("Provider actions")} data-inbox-actions="public" className="flex flex-wrap items-center gap-2">
                  {githubKind === "pr" ? (
                    <GithubPrActions
                      item={item}
                      baseRef={baseRef}
                      headRef={headRef}
                      reviewedHeadOid={prDiff?.headOid || details?.headRefOid}
                      onChange={onItemChange}
                    />
                  ) : null}
                  {panel ? null : (
                    <Button
                      variant="ghost"
                      type="button"
                      disabled={!item.url}
                      disabledReason={item.url ? undefined : t("No link available")}
                      onClick={() => void openUrl(item.url)}
                    >
                      <ExternalLink className="icon-sm" strokeWidth={1.75} />
                      {externalActionLabel}
                    </Button>
                  )}
                </div>
                </div>
                {startError ? <InlineError>{startError}</InlineError> : null}
              </header>
              {isPr ? (
                <div className="flex h-9 items-center">
                  <TabList
                    label={gitlab ? t("Merge request sections") : t("Pull request sections")}
                  >
                    <Tab value="summary">{t("Summary")}</Tab>
                    <Tab
                      value="code"
                      count={panel ? prDiff?.files.length : undefined}
                      countLabel={
                        panel && prDiff
                          ? t(
                              prDiff.files.length === 1
                                ? "{p0} changed file"
                                : "{p0} changed files",
                              { p0: prDiff.files.length },
                            )
                          : undefined
                      }
                      onClick={() => {
                        // Choosing Code again also clears a file focused from the summary.
                        if (tab === "code") setDiffFocusPath(undefined);
                      }}
                    >
                      {t("Code")}
                    </Tab>
                    {prChecksOverall ? <PrChecksTab overall={prChecksOverall} /> : null}
                  </TabList>
                </div>
              ) : null}
            </div>
          </div>
          <DetailBody
            tabbed={isPr}
            ref={panel ? undefined : detailLock}
            data-inbox-detail-scroll={panel ? undefined : ""}
            className={panel ? "min-w-0" : "min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-none"}
          >
            <div
              className={`flex w-full min-w-0 flex-col gap-4 px-4 py-4 ${tab === "code" ? "" : tab === "checks" ? "mx-auto max-w-5xl" : "mx-auto max-w-3xl"}`}
            >
              {isPr && tab === "code" ? (
                diffLoading && !prDiff ? (
                  <LoadingText className="justify-center py-10" />
                ) : diffError && !prDiff ? (
                  <Alert tone="info" role="alert">
                    {diffError}
                  </Alert>
                ) : prDiff ? (
                  <>
                    {diffLoading ? <LoadingText /> : null}
                    {diffError ? (
                      <Alert tone="info" role="alert">
                        {diffError}
                      </Alert>
                    ) : null}
                    <InboxPrDiff
                      key={inboxItemKey(item)}
                      diff={prDiff}
                      fullFile={fullFile}
                      focusPath={diffFocusPath}
                      contextControl={inboxShowsFullFileDiff(item) ? (
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <SegmentedControl
                            label={t("Diff context")}
                            selectionRole="pressed"
                            value={diffMode}
                            onValueChange={(next) => setDiffMode(next === "full" ? "full" : "hunks")}
                            options={[{ value: "hunks", label: t("Hunks") }, { value: "full", label: t("Full file") }]}
                          />
                          {baseRef && headRef ? (
                            <span className="inline-flex min-w-0 items-center gap-1 text-ui-caption text-(--ui-text-secondary)">
                              <GitCompare className="icon-xs shrink-0" aria-hidden="true" />
                              <span className="wrap-anywhere">{baseRef} ← {headRef}</span>
                              <CopyBranchNameButton branch={headRef} />
                            </span>
                          ) : null}
                        </div>
                      ) : undefined}
                    />
                  </>
                ) : (
                  <EmptyState size="inline" kind="empty" description={t("No file changes")} />
                )
              ) : isPr && tab === "checks" ? (
                <InboxPrChecks
                  view={prChecksView}
                  onRefresh={prChecksView.refresh}
                  cwd={item.projectPath || cwd}
                  repo={item.repo}
                  repair={
                    onRepairChecks && prChecksEnabled && item.projectPath
                      ? {
                          number: item.number,
                          provider: prChecksView.provider,
                          instance: prChecksView.checks?.instance,
                          url: item.url,
                          onOpenSession,
                          sessions: (repairSessions ?? []).filter(
                            (session) =>
                              !session.archived &&
                              !session.orchestrationLeadId &&
                              sameProjectPath(session.cwd, item.projectPath),
                          ),
                          onStart: (request, sessionId) => onRepairChecks(item, request, sessionId),
                        }
                      : undefined
                  }
                />
              ) : loading && !details ? (
                <LoadingText className="justify-center py-10" />
              ) : error && !details ? (
                <Alert tone="info" role="alert">
                  {error}
                </Alert>
              ) : (
                <>
                  {error ? (
                    <Alert tone="info" role="alert">
                      {error}
                    </Alert>
                  ) : null}
                  {panel ? (
                    <InboxDescriptionSummary body={details?.body ?? ""} cwd={markdownCwd} />
                  ) : details?.body.trim() ? (
                    <SurfaceSelection cwd={markdownCwd} contentVersion={details.body}>
                      <AgentMarkdown text={details.body} cwd={markdownCwd} allowRemoteMedia />
                    </SurfaceSelection>
                  ) : (
                    <EmptyState size="inline" kind="empty" description={t("No description")} />
                  )}
                  {panel && isPr ? (
                    <InboxPrChangesGlance
                      diff={prDiff}
                      loading={diffLoading}
                      error={diffError}
                      onOpenFile={(path) => {
                        setDiffFocusPath(path);
                        setTab("code");
                      }}
                    />
                  ) : null}
                  <InboxComments
                    thread={thread}
                    loading={threadLoading}
                    error={threadError}
                    cwd={markdownCwd}
                    provider={item.provider}
                    replyMode={
                      linear ? "parent" : jira || gitlab || azuredevops ? undefined : "thread"
                    }
                    onReply={(next) => { if (!posting) setReplyTo(next); }}
                  />
                  {postRefreshError ? (
                    <Alert tone="warning" role="status" action={
                      <Button loading={threadRefreshing} onClick={() => void refreshPostedThread()}>{t("Retry refresh")}</Button>
                    }>
                      <p>{t("Comment sent. Could not refresh the conversation.")}</p>
                      <p className="wrap-anywhere text-ui-caption">{postRefreshError}</p>
                    </Alert>
                  ) : null}
                  <InboxCommentForm
                    draftKey={`${commentScope}:${replyTo?.threadId || replyTo?.id || "comment"}`}
                    target={providerLabel(item.provider)}
                    replyTo={replyTo}
                    posting={posting}
                    error={postError}
                    onCancelReply={() => {
                      setReplyTo(null);
                      setPostError(null);
                    }}
                    onSubmit={postComment}
                  />
                </>
              )}
            </div>
          </DetailBody>
        </div>
      </div>
    </Tabs>
  );
}

/**
 * Copies the head branch name. One write at a time; the outcome belongs to the
 * branch it was requested for, so a write that settles after the branch changed
 * is ignored. A failure stays visible next to the control until it is retried.
 */
export function CopyBranchNameButton({ branch }: { branch: string }) {
  useLocale();
  const [outcome, setOutcome] = useState<{
    branch: string;
    status: "pending" | "copied" | "failed";
  } | null>(null);
  const timer = useRef<number | null>(null);
  const pending = useRef(false);
  const generation = useRef(0);
  const clearTimer = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => {
    generation.current += 1;
    pending.current = false;
    clearTimer();
    return () => {
      generation.current += 1;
      clearTimer();
    };
  }, [branch]);

  const status = outcome?.branch === branch ? outcome.status : null;
  const label =
    status === "copied"
      ? t("Copied")
      : status === "failed"
        ? t("Copy failed. Try again.")
        : t("Copy branch name");

  const copy = () => {
    if (pending.current) return;
    pending.current = true;
    const requested = generation.current;
    const target = branch;
    clearTimer();
    setOutcome({ branch: target, status: "pending" });
    const settle = (next: "copied" | "failed") => {
      if (generation.current !== requested) return;
      pending.current = false;
      setOutcome({ branch: target, status: next });
      if (next === "copied") {
        playCue("copy");
        timer.current = window.setTimeout(() => setOutcome(null), 2000);
      }
    };
    void copyText(target).then(
      () => settle("copied"),
      () => settle("failed"),
    );
  };

  return (
    <>
      <Button
        variant="ghost"
        type="button"
        iconOnly
        label={label}
        className="shrink-0"
        loading={status === "pending"}
        onClick={copy}
      >
        {status === "copied" ? (
          <Check className="icon-xs" strokeWidth={1.75} />
        ) : (
          <Copy className="icon-xs" strokeWidth={1.75} />
        )}
      </Button>
      {status === "failed" ? (
        <InlineError live="polite" className="shrink-0">
          {t("Copy failed. Try again.")}
        </InlineError>
      ) : null}
    </>
  );
}
