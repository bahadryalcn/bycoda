import { Text } from "../../../shared/ui/Text";
import { InboxReviewBadge } from "./InboxReviewBadge";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { ClampText } from "../../../shared/ui/ClampText";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Spinner } from "../../../shared/ui/Spinner";
import { surfaceAttributes, Surface } from "../../../shared/ui/Surface";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { JiraCommentEditor } from "./JiraCommentEditor";
import { InboxCommentPreview } from "./InboxCommentPreview";
import type { JiraCommentImage } from "../model/jiraCommentDocument";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { providerLabel } from "../../../shared/lib/providerLabel";
import { formatNumber, t, useLocale } from "../../../shared/i18n";
import { isImeComposition } from "../../../shared/lib/keyboard";
import { openUrlSafely } from "../../../shared/lib/openUrlSafely";
import {
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { X } from "../../../shared/ui/icons";
import {
  formatRelativeTime,
  githubReviewStateLabel,
  inboxPersonAvatarUrl,
  type InboxProvider,
} from "../model/githubTasks";
import { InboxAvatar } from "./InboxPresentation";
import { MOD } from "../../../platform/tauri/platform";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import { SurfaceSelection } from "../../sessions/ui/SurfaceSelection";

export type InboxReplyTarget = {
  id: string;
  author: string;
  threadId: string;
};

type InboxComment = {
  id: string;
  kind: string;
  author: string;
  authorAvatarUrl?: string;
  body: string;
  createdAt: string;
  url: string;
  state: string;
  path: string;
  line: number | null;
  resolved: boolean;
  threadId?: string;
  replies: InboxComment[];
};

type InboxCommit = {
  oid: string;
  messageHeadline: string;
  author: string;
  committedDate: string;
  url: string;
};

type InboxThread = {
  comments: InboxComment[];
  /** When present, commits interleave with comments in time order. */
  commits?: InboxCommit[];
  truncated: boolean;
};

type ActivityEntry =
  | { kind: "comment"; at: number; comment: InboxComment }
  | { kind: "commit"; at: number; commit: InboxCommit };

/** Comments and commits as one stream, oldest first. */
export function activityTimeline(thread: InboxThread): ActivityEntry[] {
  return [
    ...thread.comments.map((comment): ActivityEntry => ({
      kind: "comment",
      at: Date.parse(comment.createdAt) || 0,
      comment,
    })),
    ...(thread.commits ?? []).map((commit): ActivityEntry => ({
      kind: "commit",
      at: Date.parse(commit.committedDate) || 0,
      commit,
    })),
  ].sort((left, right) => left.at - right.at);
}

type TimelineItem =
  | { kind: "comment"; comment: InboxComment }
  | { kind: "commits"; author: string; commits: InboxCommit[] };

/** Back-to-back commits by one author read as a single push on the rail. */
function timelineItems(entries: ActivityEntry[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const entry of entries) {
    if (entry.kind === "comment") {
      items.push({ kind: "comment", comment: entry.comment });
      continue;
    }
    const last = items[items.length - 1];
    if (last?.kind === "commits" && last.author === entry.commit.author) {
      last.commits.push(entry.commit);
    } else {
      items.push({
        kind: "commits",
        author: entry.commit.author,
        commits: [entry.commit],
      });
    }
  }
  return items;
}

type Props = {
  thread: InboxThread | null;
  loading: boolean;
  error: string | null;
  cwd: string;
  provider: InboxProvider;
  replyMode?: "thread" | "parent";
  onReply?: (target: InboxReplyTarget) => void;
};

export function InboxComments({
  thread,
  loading,
  error,
  cwd,
  provider,
  replyMode,
  onReply,
}: Props) {
  useLocale();
  const commitCount = thread?.commits?.length ?? 0;
  if (thread && thread.comments.length === 0 && commitCount === 0 && !thread.truncated && !error) {
    if (loading) return <CommentsPending />;
    return null;
  }
  if (!thread) {
    if (error) {
      return <Alert tone="danger">{error}</Alert>;
    }
    if (loading) return <CommentsPending />;
    return null;
  }

  const count = thread.comments.reduce(
    (total, comment) =>
      thread.commits && isReviewEvent(comment) ? total : total + 1 + comment.replies.length,
    0,
  );
  const label = t(count === 1 ? "{p0} comment" : "{p0} comments", { p0: formatNumber(count) });
  const commitLabel = t(commitCount === 1 ? "{p0} commit" : "{p0} commits", {
    p0: formatNumber(commitCount),
  });
  const moreOn = providerLabel(provider);

  return (
    <section {...surfaceAttributes({ frame: "neutral", edge: "top" }, "flex flex-col gap-3 pt-5")}>
      <Text as="div" size="caption" tone="secondary" className="flex items-center gap-2">
        {thread.commits ? (
          <>
            <SectionLabel as="h2">{t("Activity")}</SectionLabel>
            <span>
              {label}
              {commitCount > 0 ? ` · ${commitLabel}` : ""}
            </span>
          </>
        ) : (
          <SectionLabel as="h2">{label}</SectionLabel>
        )}
        {thread.truncated ? (
          <span>
            {t("Latest comments · more on ")}
            {moreOn}
          </span>
        ) : null}
        {loading ? <Spinner size="xs" tone="secondary" /> : null}
      </Text>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {thread.commits ? (
        <ol className="flex flex-col">
          {timelineItems(activityTimeline(thread)).map((item, index, items) =>
            item.kind === "commits" ? (
              <InboxCommitRun
                key={item.commits[0].oid}
                author={item.author}
                commits={item.commits}
                provider={provider}
                first={index === 0}
                last={index === items.length - 1}
              />
            ) : (
              <InboxTimelineComment
                key={item.comment.id}
                comment={item.comment}
                cwd={cwd}
                provider={provider}
                replyMode={replyMode}
                onReply={onReply}
                first={index === 0}
                last={index === items.length - 1}
              />
            ),
          )}
        </ol>
      ) : (
        <ol className="flex flex-col gap-2">
          {thread.comments.map((comment) => (
            <li key={comment.id}>
              <InboxComment
                comment={comment}
                cwd={cwd}
                provider={provider}
                replyMode={replyMode}
                onReply={onReply}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// Keep only active writes here. A remounted composer must not submit the same
// originating draft again while its first provider request is still running.
const pendingCommentDrafts = new Set<string>();
const pendingCommentListeners = new Set<() => void>();
function subscribePendingComments(listener: () => void) {
  pendingCommentListeners.add(listener);
  return () => {
    pendingCommentListeners.delete(listener);
  };
}
function setCommentPending(key: string, pending: boolean) {
  if (pending) pendingCommentDrafts.add(key);
  else pendingCommentDrafts.delete(key);
  for (const listener of pendingCommentListeners) listener();
}

export function InboxCommentForm({
  replyTo,
  posting,
  error,
  onCancelReply,
  onSubmit,
  target,
  draftKey,
}: {
  /** Window-lifetime draft, scoped by record and reply identity by the caller. */
  draftKey?: string;
  /** Human-readable destination service, shown beside the submit action. */
  target?: string;
  replyTo: InboxReplyTarget | null;
  posting: boolean;
  error: string | null;
  onCancelReply: () => void;
  onSubmit: (body: string, images?: JiraCommentImage[]) => Promise<void>;
}) {
  useLocale();
  const localDraftId = useId();
  const draftIdentity = `inbox:comment:${draftKey ?? localDraftId}`;
  const [draft, setDraft, retireDraft] = useRetainedState(draftIdentity, "");
  const [imageDraft, setImageDraft, retireImages] = useRetainedState<JiraCommentImage[] | null>(
    `${draftIdentity}:images`,
    null,
  );
  const images = imageDraft ?? [];
  const [readingImages] = useRetainedState(`${draftIdentity}:image-reading`, false);
  const jiraEditor = target === "Jira";
  const pending = useSyncExternalStore(
    subscribePendingComments,
    () => pendingCommentDrafts.has(draftIdentity),
    () => false,
  );
  const busy = posting || pending || readingImages;
  const submitting = useRef(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const canPost = (draft.trim().length > 0 || (jiraEditor && images.length > 0)) && !busy;

  useEffect(() => {
    if (!replyTo) return;
    field.current?.focus();
  }, [replyTo]);

  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const submit = async () => {
    const body = draft.trim();
    if (
      (!body && !(jiraEditor && images.length)) ||
      busy ||
      submitting.current ||
      pendingCommentDrafts.has(draftIdentity)
    )
      return;
    submitting.current = true;
    setCommentPending(draftIdentity, true);
    try {
      if (jiraEditor) await onSubmit(body, images);
      else await onSubmit(body);
      retireDraft(draft, "");
      if (jiraEditor) retireImages(imageDraft, null);
    } catch {
      // Parent keeps the error next to the button.
    } finally {
      submitting.current = false;
      setCommentPending(draftIdentity, false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isImeComposition(event.nativeEvent)) return;
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    void submit();
  };

  const onFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  return (
    <form
      onSubmit={onFormSubmit}
      {...surfaceAttributes({ frame: "neutral", edge: "top" }, "flex flex-col gap-2 pt-5")}
    >
      {replyTo ? (
        <Text as="div" size="caption" tone="secondary" className="flex items-center gap-2">
          <Text size="inherit" tone="inherit" truncate className="min-w-0">
            {t("Replying to ")}
            {replyTo.author || t("comment")}
          </Text>
          <Button
            iconOnly
            label={t("Cancel reply")}
            variant="ghost"
            type="button"
            disabled={busy}
            onClick={onCancelReply}
            className="shrink-0"
          >
            <X className="icon-xs" strokeWidth={1.75} />
          </Button>
        </Text>
      ) : null}
      <div className="space-y-1">
        {jiraEditor ? (
          <JiraCommentEditor
            key={draftIdentity}
            draftIdentity={draftIdentity}
            value={draft}
            onChange={setDraft}
            images={images}
            onImages={(next) => setImageDraft(next.length ? next : null)}
            disabled={busy}
            onSubmit={submit}
          />
        ) : (
          <InboxCommentPreview draftIdentity={draftIdentity} value={draft}>
            <TextareaField
              hideLabel
              label={replyTo ? t("Reply") : t("Comment")}
              ref={field}
              rows={2}
              value={draft}
              disabled={busy}
              placeholder={
                replyTo
                  ? t("Write a reply ({p0}↩)", { p0: MOD })
                  : t("Leave a comment ({p0}↩)", { p0: MOD })
              }
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              fieldClassName="w-full"
              resize="none"
            />
          </InboxCommentPreview>
        )}
        <div className="flex items-center justify-end gap-2">
          {target ? (
            <Text size="caption" tone="secondary" truncate className="min-w-0">
              {t("Posts publicly to {p0}", { p0: target })}
            </Text>
          ) : null}
          <Button
            variant="primary"
            size="sm"
            type="submit"
            disabled={!canPost}
            loading={busy}
            loadingLabel={t("Posting...")}
            className="shrink-0"
          >
            {replyTo ? t("Reply") : t("Comment")}
          </Button>
        </div>
      </div>
      {error ? <InlineError>{error}</InlineError> : null}
    </form>
  );
}

function CommentsPending() {
  useLocale();
  return (
    <LoadingText {...surfaceAttributes({ frame: "neutral", edge: "top" }, "pt-5")}>
      {t("Loading comments")}
    </LoadingText>
  );
}

function InboxComment({
  comment,
  cwd,
  provider,
  nested = false,
  timeline = false,
  replyMode,
  onReply,
}: {
  comment: InboxComment;
  cwd: string;
  provider: InboxProvider;
  nested?: boolean;
  /** The rail already shows the avatar, and long bodies start clamped. */
  timeline?: boolean;
  replyMode?: "thread" | "parent";
  onReply?: (target: InboxReplyTarget) => void;
}) {
  useLocale();
  const time = formatRelativeTime(comment.createdAt);
  const review = githubReviewStateLabel(comment.state);
  const location = commentLocation(comment);
  const resolvedLabel = t("Resolved");
  const meta = [
    review ? t(review) : "",
    location,
    comment.resolved ? resolvedLabel : "",
    time,
  ].filter((part) => part.length > 0);
  const hasBody = comment.body.trim().length > 0;
  const hasReplies = !nested && comment.replies.length > 0;
  const canReply =
    onReply != null &&
    (replyMode === "parent" ||
      (replyMode === "thread" && (comment.threadId ?? "").trim().length > 0));

  const inner = (
    <>
      <Text
        as="header"
        {...surfaceAttributes(
          {
            frame: !nested && (hasBody || hasReplies) ? "neutral" : undefined,
            edge: !nested && (hasBody || hasReplies) ? "bottom" : undefined,
          },
          `flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 ${
            nested ? "" : timeline ? "min-h-9 px-3 py-1.5" : "px-3 py-2"
          }`,
        )}
      >
        <InboxCommentPerson
          avatar={!timeline}
          name={comment.author || "ghost"}
          avatarUrl={inboxPersonAvatarUrl(provider, comment.author, comment.authorAvatarUrl)}
        />
        {meta.map((part, index) => (
          <span key={`${part}-${index}`} className="flex min-w-0 items-center gap-2">
            <span aria-hidden>·</span>
            {comment.url && part === time ? (
              <Button
                variant="ghost"
                type="button"
                tooltip={
                  provider === "linear"
                    ? t("Open in Linear")
                    : provider === "jira"
                      ? t("Open in Jira")
                      : provider === "gitlab"
                        ? t("Open on GitLab")
                        : provider === "azuredevops"
                          ? t("Open on ADO")
                          : t("Open on GitHub")
                }
                onClick={() => openUrlSafely(comment.url)}
              >
                {part}
              </Button>
            ) : (
              <InboxReviewBadge
                state={comment.state}
                resolved={comment.resolved && part === resolvedLabel}
              >
                {part}
              </InboxReviewBadge>
            )}
          </span>
        ))}
        {canReply ? (
          <span className="flex items-center gap-2">
            <span aria-hidden>·</span>
            <Button
              variant="ghost"
              type="button"
              onClick={() =>
                onReply({
                  id: comment.id,
                  author: comment.author || "ghost",
                  threadId: (comment.threadId ?? "").trim(),
                })
              }
            >
              {t("Reply")}
            </Button>
          </span>
        ) : null}
      </Text>
      {hasBody ? (
        <SurfaceSelection
          cwd={cwd}
          contentVersion={comment.body}
          className={nested ? "mt-2" : "px-3 py-2.5"}
        >
          {timeline ? (
            <ClampText lines={9}>
              <AgentMarkdown
                className="inbox-comment-md"
                text={comment.body}
                cwd={cwd}
                allowRemoteMedia
                remoteMediaBaseUrl={comment.url}
              />
            </ClampText>
          ) : (
            <AgentMarkdown
              className="inbox-comment-md"
              text={comment.body}
              cwd={cwd}
              allowRemoteMedia
              remoteMediaBaseUrl={comment.url}
            />
          )}
        </SurfaceSelection>
      ) : null}
      {hasReplies ? (
        <div {...surfaceAttributes({ frame: "neutral", edge: "top" }, "px-3")}>
          {comment.replies.map((reply, index) => (
            <div
              key={reply.id}
              {...surfaceAttributes(
                {
                  frame: index > 0 ? "neutral" : undefined,
                  edge: index > 0 ? "top" : undefined,
                },
                "py-2.5",
              )}
            >
              <InboxComment
                comment={reply}
                cwd={cwd}
                provider={provider}
                nested
                replyMode={replyMode}
                onReply={onReply}
              />
            </div>
          ))}
        </div>
      ) : null}
    </>
  );

  if (nested) return <article>{inner}</article>;
  return (
    <Surface as="article" variant="outline" padding="none" className="overflow-hidden">
      {inner}
    </Surface>
  );
}

/** Reviews without a note are events, not conversation. */
function isReviewEvent(comment: InboxComment): boolean {
  return (
    comment.kind === "review" && comment.body.trim().length === 0 && comment.replies.length === 0
  );
}

/** The single space between any two rail stops: headings, commits, reviews, comments. */
const TIMELINE_GAP = "pb-3";

/** One stop on the activity rail: a node, and a line down to the next stop. */
function TimelineStop({
  node,
  first,
  last,
  card = false,
  children,
}: {
  node: ReactNode;
  first: boolean;
  last: boolean;
  /** Centres the node on a comment card's header instead of a 20px row. */
  card?: boolean;
  children: ReactNode;
}) {
  useLocale();
  return (
    <li className="flex gap-3">
      <TimelineRail first={first} last={last} lead={card ? "h-2" : "h-0"}>
        {node}
      </TimelineRail>
      <div className={`min-w-0 flex-1 ${last ? "" : TIMELINE_GAP}`}>{children}</div>
    </li>
  );
}

/** Shared lead segment centers avatars, review icons and commit dots on their row. */
function TimelineRail({
  first,
  last,
  lead,
  children,
}: {
  first: boolean;
  last: boolean;
  lead: string;
  children: ReactNode;
}) {
  useLocale();
  return (
    <div aria-hidden className="flex w-5 shrink-0 flex-col items-center">
      <span
        {...surfaceAttributes(
          { variant: first ? undefined : "neutral-boundary" },
          `w-px shrink-0 ${lead}`,
        )}
      />
      <div className="flex icon-lg shrink-0 items-center justify-center">{children}</div>
      {last ? null : (
        <span {...surfaceAttributes({ variant: "neutral-boundary" }, "w-px flex-1")} />
      )}
    </div>
  );
}

function InboxTimelineComment({
  comment,
  cwd,
  provider,
  replyMode,
  onReply,
  first,
  last,
}: {
  comment: InboxComment;
  cwd: string;
  provider: InboxProvider;
  replyMode?: "thread" | "parent";
  onReply?: (target: InboxReplyTarget) => void;
  first: boolean;
  last: boolean;
}) {
  useLocale();
  const author = comment.author || "ghost";
  const state = comment.state.trim().toUpperCase();
  if (isReviewEvent(comment)) {
    const time = formatRelativeTime(comment.createdAt);
    const verb =
      state === "APPROVED"
        ? "approved"
        : state === "CHANGES_REQUESTED"
          ? "requested changes"
          : state === "DISMISSED"
            ? "had a review dismissed"
            : "reviewed";
    return (
      <TimelineStop first={first} last={last} node={<InboxReviewBadge state={state} />}>
        <TimelineEventLine name={author} action={t(verb)} time={time} />
      </TimelineStop>
    );
  }

  return (
    <TimelineStop
      first={first}
      last={last}
      card
      node={
        <InboxAvatar
          name={author}
          avatarUrl={inboxPersonAvatarUrl(provider, comment.author, comment.authorAvatarUrl)}
        />
      }
    >
      <InboxComment
        comment={comment}
        cwd={cwd}
        provider={provider}
        timeline
        replyMode={replyMode}
        onReply={onReply}
      />
    </TimelineStop>
  );
}

function InboxCommitRun({
  author,
  commits,
  provider,
  first,
  last,
}: {
  author: string;
  commits: InboxCommit[];
  provider: InboxProvider;
  first: boolean;
  last: boolean;
}) {
  useLocale();
  const name = author || "ghost";
  const time = formatRelativeTime(commits[commits.length - 1].committedDate);
  return (
    <>
      <TimelineStop
        first={first}
        last={false}
        node={<InboxAvatar name={name} avatarUrl={inboxPersonAvatarUrl(provider, author)} />}
      >
        <TimelineEventLine
          name={name}
          action={
            commits.length === 1
              ? t("added a commit")
              : t("added {p0} commits", { p0: formatNumber(commits.length) })
          }
          time={time}
        />
      </TimelineStop>
      {commits.map((commit, index) => (
        <InboxCommitStop
          key={commit.oid}
          commit={commit}
          last={last && index === commits.length - 1}
        />
      ))}
    </>
  );
}

/** "name action · time" on a 20px row, the height every rail row shares. */
function TimelineEventLine({ name, action, time }: { name: string; action: string; time: string }) {
  useLocale();
  return (
    <Text as="p" size="caption" tone="secondary" className="flex h-5 min-w-0 items-center gap-1.5">
      <Text size="inherit" tone="neutral" weight="medium" truncate className="min-w-0">
        {name}
      </Text>
      <span className="shrink-0">{action}</span>
      {time ? (
        <>
          <span aria-hidden>·</span>
          <span className="shrink-0">{time}</span>
        </>
      ) : null}
    </Text>
  );
}

function InboxCommitStop({ commit, last }: { commit: InboxCommit; last: boolean }) {
  useLocale();
  return (
    <li className="flex gap-3">
      {/* The rail runs through commit dots, so a push reads as one stretch. */}
      <div aria-hidden className="flex w-5 shrink-0 flex-col items-center">
        <span {...surfaceAttributes({ variant: "neutral-boundary" }, "h-1.5 w-px shrink-0")} />
        <span
          {...surfaceAttributes({ radius: "pill", frame: "neutral-marker" }, "size-2 shrink-0")}
        />
        {last ? null : (
          <span {...surfaceAttributes({ variant: "neutral-boundary" }, "w-px flex-1")} />
        )}
      </div>
      <div className={`min-w-0 flex-1 ${last ? "" : TIMELINE_GAP}`}>
        <Button
          variant="item"
          type="button"
          tooltip={commit.url ? t("Open commit") : commit.messageHeadline}
          tooltipWhen={commit.url ? "always" : "overflow"}
          disabled={!commit.url}
          onClick={() => openUrlSafely(commit.url)}
          className="w-full min-w-0 text-left"
        >
          <Text as="span" size="inherit" tone="secondary" truncate className="min-w-0 flex-1">
            {commit.messageHeadline}
          </Text>
          <Text as="span" size="micro" tone="secondary" className="shrink-0 font-mono">
            {commit.oid.slice(0, 7)}
          </Text>
        </Button>
      </div>
    </li>
  );
}

function commentLocation(comment: InboxComment): string {
  const path = comment.path.trim();
  if (!path) return "";
  if (comment.line && comment.line > 0) return `${path}:${comment.line}`;
  return path;
}

function InboxCommentPerson({
  name,
  avatarUrl,
  avatar = true,
}: {
  name: string;
  avatarUrl: string;
  avatar?: boolean;
}) {
  useLocale();
  if (!avatar) {
    return (
      <Text size="inherit" tone="neutral" weight="medium" truncate className="min-w-0">
        {name}
      </Text>
    );
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <InboxAvatar name={name} avatarUrl={avatarUrl} />
      <Text size="inherit" tone="neutral" weight="medium" truncate className="min-w-0">
        {name}
      </Text>
    </span>
  );
}
