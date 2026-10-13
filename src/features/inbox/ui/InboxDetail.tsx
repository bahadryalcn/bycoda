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
import { useEffect, useRef, useState } from "react";
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
  ACTION_FILLED,
  ACTION_OUTLINE,
  ACTION_PANEL_HEADER,
  ACTION_GHOST,
} from "./InboxPresentation";
import { InboxDescriptionSummary, InboxPrChangesGlance } from "./InboxPrOverview";
import { useInboxDetailData } from "./useInboxDetailData";

export function InboxDetailTab({
  label,
  count,
  selected,
  onSelect,
}: {
  label: string;
  count?: number;
  selected: boolean;
  onSelect: () => void;
}) {
  useLocale();
  return (
    <button
      type="button"
      role="tab"
      aria-label={label}
      aria-selected={selected}
      onClick={onSelect}
      className={`relative flex h-9 items-center text-[12px] leading-none ${
        selected ? "text-content" : "text-content/50 hover:text-content"
      }`}
    >
      {label}
      {count != null ? (
        <span className="ml-1.5 rounded-full bg-content/10 px-1.5 py-0.5 text-[10px] tabular-nums text-content/60">
          {count}
        </span>
      ) : null}
      {selected ? <span className="absolute inset-x-0 bottom-0 h-0.5 bg-content" /> : null}
    </button>
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
  const reviewClass =
    reviewDecision.toUpperCase() === "APPROVED"
      ? "text-emerald-400/90"
      : reviewDecision.toUpperCase() === "CHANGES_REQUESTED"
        ? "text-rose-400/90"
        : "text-content/50";
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
      className={`flex min-w-0 items-center gap-2 text-[12px] text-content/50 ${
        panel ? "h-9 shrink-0 border-b border-stroke px-4 pr-[34px]" : ""
      }`}
    >
      <InboxProviderMark provider={item.provider} className="size-3.5 shrink-0" />
      <span className="shrink-0">
        {item.kind === "pr" ? (gitlab ? t("Merge request") : t("Pull request")) : t("Issue")}
      </span>
      <span className="shrink-0 tabular-nums">{inboxItemRef(item)}</span>
      <span className={`flex shrink-0 items-center gap-1 ${statusMark.className}`}>
        <statusMark.Icon className="size-3.5" strokeWidth={1.75} />
        {status}
      </span>
      {attentionLabel ? <span className="shrink-0 text-accent">{attentionLabel}</span> : null}
      {source ? <span className="min-w-0 truncate">{source}</span> : null}
      {panel ? (
        <button
          type="button"
          title={item.url ? externalActionLabel : t("No link available")}
          aria-label={externalActionLabel}
          disabled={!item.url}
          onClick={() => void openUrl(item.url)}
          className={`${ACTION_PANEL_HEADER} ml-auto shrink-0 disabled:opacity-40`}
        >
          <ExternalLink className="size-3.5" strokeWidth={1.75} />
          <span className="@max-[420px]/linked:hidden">{externalActionLabel}</span>
        </button>
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
          className={`relative border-b border-stroke ${panel ? "" : "z-10 shrink-0"}`}
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
                className={`line-clamp-2 font-semibold leading-tight text-content ${
                  panel ? "text-[18px]" : "text-[20px]"
                }`}
              >
                {item.title}
              </h1>
              <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-[12px] text-content/50">
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
                      <span className="flex min-w-0 items-center gap-2 overflow-hidden">
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
                      <GitCompare className="size-3 shrink-0" strokeWidth={1.75} />
                      <span className="min-w-0 truncate">
                        {baseRef} ← {headRef}
                      </span>
                      <CopyBranchNameButton branch={headRef} />
                    </span>
                  </>
                ) : null}
                {reviewLabel ? (
                  <>
                    <span aria-hidden>·</span>
                    <span className={reviewClass}>{reviewLabel}</span>
                  </>
                ) : null}
              </div>
              {!panel && relatedSessions.length > 0 ? (
                <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                  <span className="mr-0.5 inline-flex shrink-0 items-center gap-1 text-[11px] text-content/45">
                    <MessageMultiple className="size-3.5" strokeWidth={1.75} />
                    {t("Related")} {relatedSessions.length === 1 ? t("thread") : t("threads")}
                  </span>
                  {relatedSessions.map((session) => {
                    const title = sessionDisplayTitle(session.title, session.harness);
                    return (
                      <button
                        key={session.id}
                        type="button"
                        title={t("Open thread: {p0}", { p0: title })}
                        onClick={() => void onOpenSession?.(session.id)}
                        className="inline-flex min-w-0 max-w-64 items-center gap-1 rounded-md bg-content/5 px-2 py-1 text-[11px] text-content/70 hover:bg-content/10 hover:text-content"
                      >
                        <span className="truncate">{title}</span>
                        {session.archived ? (
                          <span className="shrink-0 text-content/40">{t("Archived")}</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                {onStart && item.kind !== "pr" ? (
                  <>
                    <button
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
                      className={`${ACTION_FILLED} disabled:cursor-default disabled:opacity-40`}
                    >
                      {starting ? t("Sending...") : t("Send to agent")}
                    </button>
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
                    onChange={onItemChange}
                  />
                ) : null}
                {onDiscuss ? (
                  <button type="button" onClick={onDiscuss} className={ACTION_OUTLINE}>
                    <MessageSquare className="size-3.5" strokeWidth={1.75} /> {t("Ask")}
                  </button>
                ) : null}
                {panel ? null : (
                  <button
                    type="button"
                    title={item.url ? externalActionLabel : t("No link available")}
                    disabled={!item.url}
                    onClick={() => void openUrl(item.url)}
                    className={`${ACTION_GHOST} disabled:opacity-40`}
                  >
                    <ExternalLink className="size-3.5" strokeWidth={1.75} />
                    {externalActionLabel}
                  </button>
                )}
              </div>
              {startError ? <p className="text-[12px] text-red-400/90">{startError}</p> : null}
            </header>
            {isPr ? (
              <div className="flex h-9 items-stretch gap-4">
                <div
                  role="tablist"
                  aria-label={gitlab ? t("Merge request sections") : t("Pull request sections")}
                  className="flex items-stretch gap-4"
                >
                  <InboxDetailTab
                    label={t("Summary")}
                    selected={tab === "summary"}
                    onSelect={() => setTab("summary")}
                  />
                  <InboxDetailTab
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
                      overall={prChecksOverall}
                      selected={tab === "checks"}
                      onSelect={() => setTab("checks")}
                    />
                  ) : null}
                </div>
                {tab === "code" && inboxShowsFullFileDiff(item) ? (
                  <div
                    role="group"
                    aria-label={t("Diff context")}
                    className="ml-auto flex items-center self-center rounded-md border border-content/10 bg-content/[0.03] p-0.5"
                  >
                    <button
                      type="button"
                      aria-pressed={diffMode === "hunks"}
                      onClick={() => setDiffMode("hunks")}
                      className={`rounded px-2.5 py-1 text-[11px] leading-none ${
                        diffMode === "hunks"
                          ? "bg-selection text-content"
                          : "text-content/45 hover:text-content/70"
                      }`}
                    >
                      {t("Hunks")}
                    </button>
                    <button
                      type="button"
                      aria-pressed={diffMode === "full"}
                      onClick={() => setDiffMode("full")}
                      className={`rounded px-2.5 py-1 text-[11px] leading-none ${
                        diffMode === "full"
                          ? "bg-selection text-content"
                          : "text-content/45 hover:text-content/70"
                      }`}
                    >
                      {t("Full file")}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div
          ref={panel ? undefined : detailLock}
          data-inbox-detail-scroll={panel ? undefined : ""}
          className={panel ? "min-w-0" : "min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-none"}
        >
          <div
            className={`mx-auto flex w-full max-w-5xl flex-col ${
              panel ? "linked-work-item-content-enter gap-6 px-4 py-5" : "gap-5 px-8 py-5"
            }`}
          >
            {item.labels.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {item.labels.map((label) => (
                  <InboxLabel key={label.name} label={label} />
                ))}
              </div>
            ) : null}
            {isPr && tab === "code" ? (
              diffLoading ? (
                <div className="flex justify-center py-10 text-content/40">
                  <LoaderCircle className="size-4 animate-spin" strokeWidth={1.75} />
                </div>
              ) : diffError && !prDiff ? (
                <p role="alert" className="text-[13px] text-content/50">
                  {diffError}
                </p>
              ) : prDiff ? (
                <>
                  {diffError ? (
                    <p role="alert" className="text-[13px] text-content/50">
                      {diffError}
                    </p>
                  ) : null}
                  <InboxPrDiff
                    key={`${item.projectPath}:${item.number}:${revision}:${diffMode}`}
                    diff={prDiff}
                    fullFile={fullFile}
                    focusPath={diffFocusPath}
                  />
                </>
              ) : (
                <p className="text-[13px] text-content/45">{t("No file changes")}</p>
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
              <div className="flex justify-center py-10 text-content/40">
                <LoaderCircle className="size-4 animate-spin" strokeWidth={1.75} />
              </div>
            ) : error && !details ? (
              <p role="alert" className="text-[13px] text-content/50">
                {error}
              </p>
            ) : (
              <>
                {error ? (
                  <p role="alert" className="text-[13px] text-content/50">
                    {error}
                  </p>
                ) : null}
                {panel ? (
                  <InboxDescriptionSummary body={details?.body ?? ""} cwd={markdownCwd} />
                ) : details?.body.trim() ? (
                  <AgentMarkdown text={details.body} cwd={markdownCwd} allowRemoteMedia />
                ) : (
                  <p className="text-[13px] text-content/45">{t("No description")}</p>
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
    <button
      type="button"
      title={copied ? t("Copied") : t("Copy branch name")}
      aria-label={copied ? t("Copied") : t("Copy branch name")}
      className="shrink-0 rounded p-0.5 text-content/40 hover:bg-content/8 hover:text-content/70"
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
        <Check className="size-3" strokeWidth={1.75} />
      ) : (
        <Copy className="size-3" strokeWidth={1.75} />
      )}
    </button>
  );
}
