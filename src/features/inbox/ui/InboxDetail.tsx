import { errorText } from "../../../shared/lib/errors";
import { Text } from "../../../shared/ui/Text";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Timestamp } from "../../../shared/ui/Timestamp";
import { InboxStatusBadge } from "./InboxStatusBadge";
import { Alert } from "../../../shared/ui/Alert";
import { InboxLoadError } from "./InboxLoadError";
import { Heading } from "../../../shared/ui/Heading";
import { Badge } from "../../../shared/ui/Badge";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { Button } from "../../../shared/ui/Button";
import { CopyButton } from "../../../shared/ui/CopyButton";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Tab, TabList, TabPanel, Tabs } from "../../../shared/ui/Tabs";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { t, useT, useFormat } from "../../../shared/i18n";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { useGithubPrChecks } from "../hooks/useGithubPrChecks";
import { useJiraWorkingProject } from "../hooks/useJiraWorkingProject";
import { summarizePrChecks } from "../model/githubPrChecks";
import { openUrlSafely } from "../../../shared/lib/openUrlSafely";
import { ExternalLink, GitCompare, MessageSquare, MessageMultiple } from "../../../shared/ui/icons";
import { useId, useRef, useState, type ComponentPropsWithRef } from "react";
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
import { InboxRelativeTime, hasInboxRelativeTime } from "./InboxRelativeTime";
import { InboxPrChecks, PrChecksTab } from "./InboxPrChecks";
import { GithubPrActions } from "./InboxPrActions";
import {
  InboxProjectOption,
  inboxStatusMark,
  InboxPerson,
  InboxProjectPicker,
  inboxLabelItems,
  CiRepairProps,
} from "./InboxPresentation";
import { InboxDescriptionSummary, InboxPrChangesGlance } from "./InboxPrOverview";
import { useInboxDetailData } from "./useInboxDetailData";

/** The body is the PR tabs' one shared panel; an issue has no tabs and stays a plain region. */
function DetailBody({ tabbed, ...props }: ComponentPropsWithRef<"div"> & { tabbed: boolean }) {
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
  const t = useT();
  const { formatNumber } = useFormat();
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
    retrying,
    retry,
    prDiff,
    diffLoading,
    diffError,
    thread,
    setThread,
    threadLoading,
    threadError,
  } = useInboxDetailData(item, revision, tab, fullFile, panel);
  const externalActionLabel = t(
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
              : "Open on GitHub",
  );
  const commentScope = `${cwd}:${item.projectPath}:${inboxItemKey(item)}`;
  const [replyTo, setReplyTo] = useRetainedState<InboxReplyTarget | null>(
    `inbox:reply:${commentScope}`,
    null,
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
  const [startError, setStartError] = useState<string | null>(null);
  const [startProject, setStartProject] = useJiraWorkingProject(
    item,
    defaultProject,
    setStartError,
  );
  const [starting, setStarting] = useState(false);
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
    ? summarizePrChecks(
        {
          loading: prChecksView.loading,
          error: prChecksView.error,
          checks: prChecksView.checks?.checks ?? null,
        },
        t,
        formatNumber,
      )
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
              ? await azureDevOpsWorkItemThread(item.repo, azureDevOpsKind, item.number, {
                  force: true,
                })
              : githubKind
                ? await githubWorkItemThread(item.projectPath, item.repo, githubKind, item.number, {
                    force: true,
                  })
                : null;
      if (next) setThread(next);
      setPostRefreshError(null);
    } catch (err: unknown) {
      setPostRefreshError(errorText(err));
    } finally {
      setThreadRefreshing(false);
    }
  };

  const postComment = async (
    body: string,
    images?: import("../model/jiraCommentDocument").JiraCommentImage[],
  ) => {
    if (postingRef.current) throw new Error("Comment already in progress");
    postingRef.current = true;
    setPosting(true);
    setPostError(null);
    try {
      if (linear) {
        await linearIssueComment(item.id ?? "", body, { parentId: replyTo?.id });
      } else if (jira) {
        await jiraIssueComment({ id: item.id ?? "", key: jiraKey }, body, images);
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
      setPostError(errorText(err));
      throw err;
    } finally {
      postingRef.current = false;
      setPosting(false);
    }
  };

  const githubWorkspace = item.provider === "github" && !panel;
  const identityRow = (
    <Text
      as="div"
      data-inbox-detail-identity
      data-inbox-detail-fixed-header={panel ? "" : undefined}
      {...surfaceAttributes(
        {
          frame: panel ? "pane" : undefined,
          edge: panel ? "bottom" : undefined,
        },
        `flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 ${panel ? "h-9 shrink-0 px-4 pe-10" : ""}`,
      )}
    >
      <InboxProviderMark provider={item.provider} className="icon-sm shrink-0" />
      <span className="shrink-0">
        {item.kind === "pr" ? (gitlab ? t("Merge request") : t("Pull request")) : t("Issue")}
      </span>
      <span className="shrink-0 tabular-nums">{inboxItemRef(item)}</span>
      <InboxStatusBadge mark={statusMark} label={status} attention={attentionLabel} />
      {source ? <span className="min-w-0 wrap-anywhere">{source}</span> : null}
      {panel ? (
        <Button
          variant="ghost"
          type="button"
          tooltip={externalActionLabel}
          tooltipWhen="overflow"
          aria-label={externalActionLabel}
          disabled={!item.url}
          disabledReason={item.url ? undefined : t("No link available")}
          onClick={() => openUrlSafely(item.url)}
        >
          <ExternalLink className="icon-sm" strokeWidth={1.75} />
          <span className="@max-[420px]/linked:hidden">{externalActionLabel}</span>
        </Button>
      ) : null}
    </Text>
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
            {...surfaceAttributes(
              { frame: "pane", edge: "bottom" },
              `relative ${panel ? "" : "shrink-0"}`,
            )}
          >
            <div
              className={`flex w-full min-w-0 flex-col gap-2 px-4 pt-3 ${isPr ? "" : "pb-3"} ${githubWorkspace ? "mx-auto max-w-3xl" : ""}`}
            >
              <header className={`flex flex-col ${panel ? "gap-2" : "gap-2.5"}`}>
                {githubWorkspace ? identityRow : null}
                <Heading size="page" lines={3} className="break-words">
                  {item.title}
                </Heading>
                {panel || githubWorkspace ? null : identityRow}
                <Text
                  as="div"
                  size="caption"
                  tone="secondary"
                  className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
                >
                  {authorName ? (
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <Text size="inherit" tone="muted">
                        {jira ? t("Reporter") : t("Author")}
                      </Text>
                      <InboxPerson
                        name={authorName}
                        avatarUrl={inboxPersonAvatarUrl(
                          item.provider,
                          authorName,
                          details?.authorAvatarUrl,
                        )}
                        size="sm"
                      />
                    </span>
                  ) : null}
                  {showAssignment ? (
                    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                      <Text size="inherit" tone="muted">
                        {t("Assignee")}
                      </Text>
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
                    </span>
                  ) : null}
                  {item.createdAt && hasInboxRelativeTime(item.createdAt) ? (
                    <>
                      {githubWorkspace ? null : <span aria-hidden>·</span>}
                      <Timestamp
                        value={Date.parse(item.createdAt)}
                        format="relative"
                        prefix={t("Created")}
                      />
                    </>
                  ) : null}
                  {hasInboxRelativeTime(item.updatedAt) ? (
                    <>
                      {githubWorkspace ? null : <span aria-hidden>·</span>}
                      <span>
                        {t("Updated ")}
                        <InboxRelativeTime at={item.updatedAt} />
                      </span>
                    </>
                  ) : null}
                  {baseRef && headRef ? (
                    <>
                      {githubWorkspace ? null : <span aria-hidden>·</span>}
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
                            : reviewDecision.toUpperCase() === "REVIEW_REQUIRED"
                              ? "warning"
                              : "neutral"
                      }
                    >
                      {t(reviewLabel)}
                    </Badge>
                  ) : null}
                  {githubWorkspace ? null : (
                    <BadgeList
                      label={t("Labels")}
                      rows={1}
                      items={inboxLabelItems(item.labels)}
                      className="min-w-0 max-w-full"
                    />
                  )}
                </Text>
                {githubWorkspace ? (
                  <BadgeList label={t("Labels")} rows={2} items={inboxLabelItems(item.labels)} />
                ) : null}
                {!panel && relatedSessions.length > 0 ? (
                  <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
                    <Text
                      size="micro"
                      tone="secondary"
                      className="mr-0.5 inline-flex shrink-0 items-center gap-1"
                    >
                      <MessageMultiple className="icon-sm" strokeWidth={1.75} />
                      {t("Related")} {relatedSessions.length === 1 ? t("thread") : t("threads")}
                    </Text>
                    {relatedSessions.map((session) => {
                      const title = sessionDisplayTitle(session.title, session.harness);
                      return (
                        <Button
                          variant="ghost"
                          key={session.id}
                          type="button"
                          tooltip={title}
                          tooltipWhen="overflow"
                          onClick={() => void onOpenSession?.(session.id)}
                          className="min-w-0 max-w-64"
                        >
                          <Text size="inherit" tone="inherit" truncate>
                            {title}
                          </Text>
                          {session.archived ? (
                            <Text size="inherit" tone="secondary" className="shrink-0">
                              {t("Archived")}
                            </Text>
                          ) : null}
                        </Button>
                      );
                    })}
                  </div>
                ) : null}
                <div
                  className="flex min-w-0 flex-wrap items-center gap-2 pt-0.5"
                  data-inbox-detail-actions
                >
                  <div
                    role="group"
                    aria-label={t("Agent actions")}
                    data-inbox-actions="agent"
                    className="flex min-w-0 flex-wrap items-center gap-2"
                  >
                    {onStart && item.kind !== "pr" ? (
                      <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
                        <Button
                          variant="primary"
                          size="md"
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
                                setStartError(errorText(err));
                              })
                              .finally(() => setStarting(false));
                          }}
                        >
                          {starting ? t("Sending…") : t("Send to agent")}
                        </Button>
                        {!chooseStartProject && item.repo && !githubWorkspace ? (
                          <Text
                            size="caption"
                            tone="secondary"
                            truncate
                            className="min-w-0 max-w-48"
                          >
                            {t("in {p0}", { p0: item.repo })}
                          </Text>
                        ) : null}
                        {chooseStartProject ? (
                          <div className="min-w-0 max-w-full">
                            <InboxProjectPicker
                              projects={projects}
                              value={startProject}
                              onChange={setStartProject}
                            />
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {onDiscuss ? (
                      <Button variant="secondary" size="md" type="button" onClick={onDiscuss}>
                        <MessageSquare className="icon-sm" strokeWidth={1.75} /> {t("Ask")}
                      </Button>
                    ) : null}
                  </div>
                  <div
                    role="group"
                    aria-label={t("Provider actions")}
                    data-inbox-actions="public"
                    className="ms-auto flex min-w-0 flex-wrap items-center gap-2"
                  >
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
                        variant="secondary"
                        size="md"
                        type="button"
                        disabled={!item.url}
                        disabledReason={item.url ? undefined : t("No link available")}
                        onClick={() => openUrlSafely(item.url)}
                      >
                        <ExternalLink className="icon-sm" strokeWidth={1.75} />
                        {externalActionLabel}
                      </Button>
                    )}
                  </div>
                </div>
                {startError ? (
                  <InlineError details={startError}>{t("Could not start the session.")}</InlineError>
                ) : null}
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
                  <LoadingText inset="panel" className="justify-center" />
                ) : diffError && !prDiff ? (
                  <InboxLoadError title={t("Could not load the code changes.")} error={diffError} />
                ) : prDiff ? (
                  <>
                    {diffLoading ? <LoadingText /> : null}
                    {diffError ? <InboxLoadError title={t("Could not load the code changes.")} error={diffError} /> : null}
                    <InboxPrDiff
                      key={inboxItemKey(item)}
                      diff={prDiff}
                      fullFile={fullFile}
                      focusPath={diffFocusPath}
                      contextControl={
                        inboxShowsFullFileDiff(item) ? (
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <SegmentedControl
                              label={t("Diff context")}
                              selectionRole="pressed"
                              value={diffMode}
                              onValueChange={(next) =>
                                setDiffMode(next === "full" ? "full" : "hunks")
                              }
                              options={[
                                { value: "hunks", label: t("Hunks") },
                                { value: "full", label: t("Full file") },
                              ]}
                            />
                            {baseRef && headRef ? (
                              <Text
                                size="caption"
                                tone="secondary"
                                className="inline-flex min-w-0 items-center gap-1"
                              >
                                <GitCompare className="icon-xs shrink-0" aria-hidden="true" />
                                <span className="wrap-anywhere">
                                  {baseRef} ← {headRef}
                                </span>
                                <CopyBranchNameButton branch={headRef} />
                              </Text>
                            ) : null}
                          </div>
                        ) : undefined
                      }
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
                <LoadingText inset="panel" className="justify-center" />
              ) : error && !details ? (
                <InboxLoadError
                  title={t("Could not load this item.")}
                  error={error}
                  retrying={retrying}
                  disabled={false}
                  onRetry={() => void retry()}
                />
              ) : (
                <>
                  {error ? (
                    <InboxLoadError
                      title={t("Could not refresh this item.")}
                      error={error}
                      retrying={retrying}
                      disabled={false}
                      onRetry={() => void retry()}
                    />
                  ) : null}
                  {panel ? (
                    <InboxDescriptionSummary
                      body={details?.body ?? ""}
                      cwd={markdownCwd}
                      remoteMediaBaseUrl={item.url}
                    />
                  ) : details?.body.trim() ? (
                    <SurfaceSelection cwd={markdownCwd} contentVersion={details.body}>
                      <AgentMarkdown
                        text={details.body}
                        cwd={markdownCwd}
                        allowRemoteMedia
                        remoteMediaBaseUrl={item.url}
                      />
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
                    onReply={(next) => {
                      if (!posting) setReplyTo(next);
                    }}
                  />
                  {postRefreshError ? (
                    <Alert
                      tone="warning"
                      action={{
                        label: t("Retry refresh"),
                        pending: threadRefreshing,
                        onClick: () => void refreshPostedThread(),
                      }}
                    >
                      <p>{t("Comment sent. Could not refresh the conversation.")}</p>
                      <ErrorDetails detail={postRefreshError} />
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
  return (
    <CopyButton
      iconOnly
      type="button"
      className="shrink-0"
      label={t("Copy branch name")}
      resetKeys={[branch]}
      onCopy={async () => {
        await copyText(branch);
        playCue("copy");
      }}
    />
  );
}
