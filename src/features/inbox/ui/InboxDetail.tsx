import { Alert } from "../../../shared/ui/Alert";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
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
  LoaderCircle,
  MessageMultiple,
} from "../../../shared/ui/icons";
import { useEffect, useId, useRef, useState } from "react";
import { InboxProviderMark } from "./InboxProviderMark";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import {
  githubReviewDecisionLabel,
  githubWorkItemComment,
  githubWorkItemThread,
  gitlabAttentionLabel,
  inboxItemRef,
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

export function InboxDetailTab({
  id,
  controls,
  label,
  count,
  selected,
  onSelect,
}: {
  id?: string;
  controls?: string;
  label: string;
  count?: number;
  selected: boolean;
  onSelect: () => void;
}) {
  useLocale();
  return (
    <Button
      variant="tab"
      type="button"
      role="tab"
      id={id}
      aria-controls={controls}
      tabIndex={selected ? 0 : -1}
      aria-label={label}
      aria-selected={selected}
      onClick={onSelect}
    >
      {label}
      {count != null ? (
        <Badge tone="neutral" className="ml-1.5">
          {count}
        </Badge>
      ) : null}
      {selected ? (
        <span className="absolute inset-x-0 bottom-0 h-0.5 bg-(--ui-tone-neutral-solid)" />
      ) : null}
    </Button>
  );
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
  const tabPanelId = `${tabsId}-panel`;
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
  const [replyTo, setReplyTo] = useState<InboxReplyTarget | null>(null);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const defaultProject =
    projects.find((project) => sameProjectPath(project.path, cwd))?.path ??
    projects[0]?.path ??
    cwd;
  const [startProject, setStartProject] = useState(defaultProject);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const chooseStartProject = tracker || ((gitlab || azuredevops) && !item.projectPath);
  const status = tracker ? item.state || inboxItemStatus(item) : inboxItemStatus(item);
  const statusMark = inboxStatusMark(item);

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

  const postComment = async (body: string) => {
    setPosting(true);
    setPostError(null);
    try {
      if (linear) {
        const id = item.id ?? "";
        await linearIssueComment(id, body, { parentId: replyTo?.id });
        setReplyTo(null);
        try {
          setThread(await linearIssueThread(id, { force: true }));
        } catch (err: unknown) {
          setPostError(err instanceof Error ? err.message : String(err));
        }
        return;
      }
      if (jira) {
        await jiraIssueComment({ id: item.id ?? "", key: jiraKey }, body);
        setReplyTo(null);
        try {
          setThread(await jiraIssueThread(jiraKey, { force: true }));
        } catch (err: unknown) {
          setPostError(err instanceof Error ? err.message : String(err));
        }
        return;
      }
      if (gitlabKind) {
        await gitlabWorkItemComment(item.repo, gitlabKind, item.number, body);
        setReplyTo(null);
        try {
          setThread(
            await gitlabWorkItemThread(item.repo, gitlabKind, item.number, {
              force: true,
            }),
          );
        } catch (err: unknown) {
          setPostError(err instanceof Error ? err.message : String(err));
        }
        return;
      }
      if (azureDevOpsKind) {
        await azureDevOpsWorkItemComment(item.repo, azureDevOpsKind, item.number, body);
        setReplyTo(null);
        try {
          setThread(
            await azureDevOpsWorkItemThread(item.repo, azureDevOpsKind, item.number, {
              force: true,
            }),
          );
        } catch (err: unknown) {
          setPostError(err instanceof Error ? err.message : String(err));
        }
        return;
      }
      if (!githubKind) throw new Error("Unknown inbox item");
      await githubWorkItemComment(item.projectPath, item.repo, githubKind, item.number, body, {
        inReplyTo: replyTo?.threadId,
      });
      setReplyTo(null);
      try {
        setThread(
          await githubWorkItemThread(item.projectPath, item.repo, githubKind, item.number, {
            force: true,
          }),
        );
      } catch (err: unknown) {
        setPostError(err instanceof Error ? err.message : String(err));
      }
    } catch (err: unknown) {
      setPostError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setPosting(false);
    }
  };

  const identityRow = (
    <div
      data-inbox-detail-identity
      data-inbox-detail-fixed-header={panel ? "" : undefined}
      className={`flex min-w-0 items-center gap-2 whitespace-nowrap text-ui-caption text-(--ui-text-secondary) ${
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
      {source ? <span className="min-w-0 truncate">{source}</span> : null}
      {panel ? (
        <Button
          variant="ghost"
          type="button"
          title={item.url ? externalActionLabel : t("No link available")}
          aria-label={externalActionLabel}
          disabled={!item.url}
          onClick={() => void openUrl(item.url)}
        >
          <ExternalLink className="icon-sm" strokeWidth={1.75} />
          <span className="@max-[420px]/linked:hidden">{externalActionLabel}</span>
        </Button>
      ) : null}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {panel ? identityRow : null}
      <div
        ref={panel ? detailLock : undefined}
        data-inbox-detail-scroll={panel ? "" : undefined}
        className={panel ? "min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-none" : "contents"}
      >
        <div
          data-inbox-detail-header
          className={`relative border-b border-(--ui-tone-neutral-border) ${panel ? "" : "z-10 shrink-0"}`}
        >
          <div
            className={`mx-auto flex w-full max-w-5xl flex-col ${
              panel ? "gap-2 px-4 pt-4" : "gap-2.5 px-8 pt-5"
            } ${isPr ? "" : panel ? "pb-4" : "pb-5"}`}
          >
            <header className={`flex flex-col ${panel ? "gap-2" : "gap-2.5"}`}>
              {panel ? null : identityRow}
              <h1
                title={item.title}
                className={`break-words font-medium leading-tight text-(--ui-tone-neutral-fg) ${
                  panel ? "text-ui-heading" : "text-ui-heading"
                }`}
              >
                {item.title}
              </h1>
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ui-caption text-(--ui-text-secondary)">
                {authorName ? (
                  <InboxPerson
                    name={authorName}
                    avatarUrl={inboxPersonAvatarUrl(
                      item.provider,
                      authorName,
                      details?.authorAvatarUrl,
                    )}
                    size={16}
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
                            size={16}
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
                      <span className="min-w-0 truncate">
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
                <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
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
                        title={t("Open thread: {p0}", { p0: title })}
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
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
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
                      <InboxProjectPicker
                        projects={projects}
                        value={startProject}
                        onChange={setStartProject}
                      />
                    ) : null}
                  </>
                ) : null}
                {githubKind === "pr" ? (
                  <GithubPrActions
                    item={item}
                    baseRef={baseRef}
                    headRef={headRef}
                    reviewedHeadOid={prDiff?.headOid || details?.headRefOid}
                    onChange={onItemChange}
                  />
                ) : null}
                {onDiscuss ? (
                  <Button variant="secondary" type="button" onClick={onDiscuss}>
                    <MessageSquare className="icon-sm" strokeWidth={1.75} /> {t("Ask")}
                  </Button>
                ) : null}
                {panel ? null : (
                  <Button
                    variant="ghost"
                    type="button"
                    title={item.url ? externalActionLabel : t("No link available")}
                    disabled={!item.url}
                    onClick={() => void openUrl(item.url)}
                  >
                    <ExternalLink className="icon-sm" strokeWidth={1.75} />
                    {externalActionLabel}
                  </Button>
                )}
              </div>
              {startError ? (
                <p className="text-ui-caption text-(--ui-tone-danger-fg)">{startError}</p>
              ) : null}
            </header>
            {isPr ? (
              <div className="flex h-9 items-stretch gap-4">
                <div
                  role="tablist"
                  aria-label={gitlab ? t("Merge request sections") : t("Pull request sections")}
                  onKeyDown={(event) => {
                    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                    const tabs = [
                      ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
                    ];
                    const index = tabs.indexOf(event.target as HTMLButtonElement);
                    if (index < 0) return;
                    event.preventDefault();
                    const next =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? tabs.length - 1
                          : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
                            tabs.length;
                    tabs[next]?.focus();
                    tabs[next]?.click();
                  }}
                  className="flex items-stretch gap-4"
                >
                  <InboxDetailTab
                    id={`${tabsId}-summary`}
                    controls={tabPanelId}
                    label={t("Summary")}
                    selected={tab === "summary"}
                    onSelect={() => setTab("summary")}
                  />
                  <InboxDetailTab
                    id={`${tabsId}-code`}
                    controls={tabPanelId}
                    label={t("Code")}
                    count={panel ? prDiff?.files.length : undefined}
                    selected={tab === "code"}
                    onSelect={() => {
                      setDiffFocusPath(undefined);
                      setTab("code");
                    }}
                  />
                  {prChecksOverall ? (
                    <PrChecksTab
                      id={`${tabsId}-checks`}
                      controls={tabPanelId}
                      overall={prChecksOverall}
                      selected={tab === "checks"}
                      onSelect={() => setTab("checks")}
                    />
                  ) : null}
                </div>
                {tab === "code" && inboxShowsFullFileDiff(item) ? (
                  <SegmentedControl
                    className="ml-auto self-center"
                    label={t("Diff context")}
                    selectionRole="pressed"
                    value={diffMode}
                    onValueChange={(next) => setDiffMode(next === "full" ? "full" : "hunks")}
                    options={[
                      { value: "hunks", label: t("Hunks") },
                      { value: "full", label: t("Full file") },
                    ]}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div
          ref={panel ? undefined : detailLock}
          id={isPr ? tabPanelId : undefined}
          role={isPr ? "tabpanel" : undefined}
          aria-labelledby={isPr ? `${tabsId}-${tab}` : undefined}
          data-inbox-detail-scroll={panel ? undefined : ""}
          className={panel ? "min-w-0" : "min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-none"}
        >
          <div
            className={`mx-auto flex w-full max-w-5xl flex-col ${
              panel ? "linked-work-item-content-enter gap-6 px-4 py-5" : "gap-5 px-8 py-5"
            }`}
          >
            {isPr && tab === "code" ? (
              diffLoading ? (
                <div className="flex justify-center py-10 text-(--ui-text-secondary)">
                  <LoaderCircle className="icon-md animate-spin" strokeWidth={1.75} />
                </div>
              ) : diffError && !prDiff ? (
                <Alert tone="info" role="alert">
                  {diffError}
                </Alert>
              ) : prDiff ? (
                <>
                  {diffError ? (
                    <Alert tone="info" role="alert">
                      {diffError}
                    </Alert>
                  ) : null}
                  <InboxPrDiff
                    key={`${item.projectPath}:${item.number}:${revision}:${diffMode}`}
                    diff={prDiff}
                    fullFile={fullFile}
                    focusPath={diffFocusPath}
                  />
                </>
              ) : (
                <p className="text-ui-secondary text-(--ui-text-secondary)">
                  {t("No file changes")}
                </p>
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
            ) : loading ? (
              <div className="flex justify-center py-10 text-(--ui-text-secondary)">
                <LoaderCircle className="icon-md animate-spin" strokeWidth={1.75} />
              </div>
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
                  <p className="text-ui-secondary text-(--ui-text-secondary)">
                    {t("No description")}
                  </p>
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
                  onReply={setReplyTo}
                />
                <InboxCommentForm
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
        </div>
      </div>
    </div>
  );
}

export function CopyBranchNameButton({ branch }: { branch: string }) {
  useLocale();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    setCopied(false);
    return () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    };
  }, [branch]);

  return (
    <Button
      variant="ghost"
      type="button"
      title={copied ? t("Copied") : t("Copy branch name")}
      aria-label={copied ? t("Copied") : t("Copy branch name")}
      className="shrink-0"
      onClick={() => {
        void copyText(branch).then(
          () => {
            playCue("copy");
            setCopied(true);
            if (timer.current != null) window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => setCopied(false), 2000);
          },
          () => {},
        );
      }}
    >
      {copied ? (
        <Check className="icon-xs" strokeWidth={1.75} />
      ) : (
        <Copy className="icon-xs" strokeWidth={1.75} />
      )}
    </Button>
  );
}
