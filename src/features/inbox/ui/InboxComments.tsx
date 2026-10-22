import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { providerLabel } from "../../../shared/lib/providerLabel";
import { t, useLocale } from "../../../shared/i18n";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { CheckCircle, CircleX, LoaderCircle, MessageSquare, X } from "../../../shared/ui/icons";
import {
  formatRelativeTime,
  githubReviewStateLabel,
  inboxPersonAvatarUrl,
  type InboxProvider,
} from "../model/githubTasks";
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
      return (
        <Alert tone="info" role="alert">
          {error}
        </Alert>
      );
    }
    if (loading) return <CommentsPending />;
    return null;
  }

  const count = thread.comments.reduce(
    (total, comment) =>
      thread.commits && isReviewEvent(comment) ? total : total + 1 + comment.replies.length,
    0,
  );
  const label = count === 1 ? "1 comment" : `${count} comments`;
  const commitLabel = commitCount === 1 ? "1 commit" : `${commitCount} commits`;
  const moreOn = providerLabel(provider);

  return (
    <section className="flex flex-col gap-3 border-t border-(--ui-tone-neutral-border) pt-5">
      <div className="flex items-center gap-2 text-[12px] text-(--ui-text-secondary)">
        {thread.commits ? (
          <>
            <h2 className="text-(--ui-text-secondary)">{t("Activity")}</h2>
            <span>
              {label}
              {commitCount > 0 ? ` · ${commitLabel}` : ""}
            </span>
          </>
        ) : (
          <h2 className="text-(--ui-text-secondary)">{label}</h2>
        )}
        {thread.truncated ? (
          <span>
            {t("Latest comments · more on ")}
            {moreOn}
          </span>
        ) : null}
        {loading ? (
          <LoaderCircle
            className="size-3 animate-spin text-(--ui-text-secondary)"
            strokeWidth={1.75}
          />
        ) : null}
      </div>
      {error ? (
        <Alert tone="info" role="alert">
          {error}
        </Alert>
      ) : null}
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

export function InboxCommentForm({
  replyTo,
  posting,
  error,
  onCancelReply,
  onSubmit,
}: {
  replyTo: InboxReplyTarget | null;
  posting: boolean;
  error: string | null;
  onCancelReply: () => void;
  onSubmit: (body: string) => Promise<void>;
}) {
  useLocale();
  const [draft, setDraft] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const canPost = draft.trim().length > 0 && !posting;

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
    if (!body || posting) return;
    try {
      await onSubmit(body);
      setDraft("");
    } catch {
      // Parent keeps the error next to the button.
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
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
      className="flex flex-col gap-2 border-t border-(--ui-tone-neutral-border) pt-5"
    >
      {replyTo ? (
        <div className="flex items-center gap-2 text-[12px] text-(--ui-text-secondary)">
          <span className="min-w-0 truncate">
            {t("Replying to ")}
            {replyTo.author || t("comment")}
          </span>
          <Button
            iconOnly
            label={t("Cancel reply")}
            variant="ghost"
            type="button"
            title={t("Cancel reply")}
            aria-label={t("Cancel reply")}
            onClick={onCancelReply}
            className="shrink-0"
          >
            <X className="size-3" strokeWidth={1.75} />
          </Button>
        </div>
      ) : null}
      <div className="space-y-1">
        <TextareaField
          hideLabel
          label=""
          ref={field}
          rows={2}
          value={draft}
          disabled={posting}
          placeholder={
            replyTo
              ? t("Write a reply ({p0}↩)", { p0: MOD })
              : t("Leave a comment ({p0}↩)", { p0: MOD })
          }
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          fieldClassName="w-full"
          className="resize-none"
        />
        <div className="flex items-center justify-end px-2 pb-2">
          <Button variant="primary" size="sm" type="submit" disabled={!canPost} loading={posting}>
            {posting ? t("Posting...") : replyTo ? t("Reply") : t("Comment")}
          </Button>
        </div>
      </div>
      {error ? <p className="text-[12px] text-(--ui-tone-danger-fg)">{error}</p> : null}
    </form>
  );
}

function CommentsPending() {
  useLocale();
  return (
    <div className="flex items-center gap-2 border-t border-(--ui-tone-neutral-border) pt-5 text-[12px] text-(--ui-text-secondary)">
      <LoaderCircle className="size-3.5 animate-spin" strokeWidth={1.75} />
      {t("Loading comments")}
    </div>
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
  const meta = [review, location, comment.resolved ? "Resolved" : "", time].filter(
    (part) => part.length > 0,
  );
  const hasBody = comment.body.trim().length > 0;
  const hasReplies = !nested && comment.replies.length > 0;
  const canReply =
    onReply != null &&
    (replyMode === "parent" ||
      (replyMode === "thread" && (comment.threadId ?? "").trim().length > 0));

  const inner = (
    <>
      <header
        className={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-(--ui-text-secondary) ${
          nested ? "" : timeline ? "min-h-9 px-3 py-1.5" : "px-3 py-2"
        } ${!nested && (hasBody || hasReplies) ? "border-b border-(--ui-tone-neutral-border)" : ""}`}
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
                title={
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
                onClick={() => void openUrl(comment.url)}
              >
                {part}
              </Button>
            ) : (
              <span
                className={
                  comment.state === "APPROVED"
                    ? "text-(--ui-tone-success-fg)"
                    : comment.state === "CHANGES_REQUESTED"
                      ? "text-(--ui-tone-danger-fg)"
                      : comment.resolved && part === "Resolved"
                        ? "text-(--ui-tone-success-fg)"
                        : "min-w-0 truncate"
                }
              >
                {part}
              </span>
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
      </header>
      {hasBody ? (
        <SurfaceSelection
          cwd={cwd}
          contentVersion={comment.body}
          className={nested ? "mt-2" : "px-3 py-2.5"}
        >
          {timeline ? (
            <CollapsibleBody>
              <AgentMarkdown
                className="inbox-comment-md"
                text={comment.body}
                cwd={cwd}
                allowRemoteMedia
              />
            </CollapsibleBody>
          ) : (
            <AgentMarkdown
              className="inbox-comment-md"
              text={comment.body}
              cwd={cwd}
              allowRemoteMedia
            />
          )}
        </SurfaceSelection>
      ) : null}
      {hasReplies ? (
        <div className="border-t border-(--ui-tone-neutral-border) px-3">
          {comment.replies.map((reply, index) => (
            <div
              key={reply.id}
              className={`py-2.5 ${index > 0 ? "border-t border-(--ui-tone-neutral-border)" : ""}`}
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
    <article className="overflow-hidden rounded-md border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised)">
      {inner}
    </article>
  );
}

const CLAMPED_BODY_PX = 180;

/** Bot reviews and long write-ups start clamped so the timeline stays scannable. */
function CollapsibleBody({ children }: { children: ReactNode }) {
  useLocale();
  const inner = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const el = inner.current;
    if (!el) return;
    // A little slack so a body barely over the limit just shows in full.
    const measure = () => setOverflows(el.scrollHeight > CLAMPED_BODY_PX + 48);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const clamped = overflows && !expanded;
  return (
    <>
      <div
        style={clamped ? { maxHeight: CLAMPED_BODY_PX } : undefined}
        className={
          clamped
            ? "overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]"
            : ""
        }
      >
        <div ref={inner}>{children}</div>
      </div>
      {overflows ? (
        <Button
          variant="ghost"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          className="mt-1.5"
        >
          {expanded ? t("Show less") : t("Show more")}
        </Button>
      ) : null}
    </>
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

/**
 * Rail column shared by every stop. The lead segment sets where the node sits,
 * so avatars, review icons and commit dots all land on their row's centre.
 */
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
      <span className={`w-px shrink-0 ${lead} ${first ? "" : "bg-(--ui-surface-raised)"}`} />
      <div className="flex size-5 shrink-0 items-center justify-center">{children}</div>
      {last ? null : <span className="w-px flex-1 bg-(--ui-surface-raised)" />}
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
    const Icon =
      state === "APPROVED" ? CheckCircle : state === "CHANGES_REQUESTED" ? CircleX : MessageSquare;
    return (
      <TimelineStop
        first={first}
        last={last}
        node={
          <Icon
            className={`size-4 ${
              state === "APPROVED"
                ? "text-(--ui-tone-success-fg)"
                : state === "CHANGES_REQUESTED"
                  ? "text-(--ui-tone-danger-fg)"
                  : "text-(--ui-text-secondary)"
            }`}
            strokeWidth={1.75}
          />
        }
      >
        <TimelineEventLine name={author} action={verb} time={time} />
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
          action={`added ${commits.length === 1 ? "a commit" : `${commits.length} commits`}`}
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
    <p className="flex h-5 min-w-0 items-center gap-1.5 text-[12px] text-(--ui-text-secondary)">
      <span className="min-w-0 truncate font-medium text-(--ui-tone-neutral-fg)">{name}</span>
      <span className="shrink-0">{action}</span>
      {time ? (
        <>
          <span aria-hidden>·</span>
          <span className="shrink-0">{time}</span>
        </>
      ) : null}
    </p>
  );
}

function InboxCommitStop({ commit, last }: { commit: InboxCommit; last: boolean }) {
  useLocale();
  return (
    <li className="flex gap-3">
      {/* The rail runs through commit dots, so a push reads as one stretch. */}
      <div aria-hidden className="flex w-5 shrink-0 flex-col items-center">
        <span className="h-1.5 w-px shrink-0 bg-(--ui-surface-raised)" />
        <span className="size-2 shrink-0 rounded-full border-[1.5px] border-(--ui-tone-neutral-border)" />
        {last ? null : <span className="w-px flex-1 bg-(--ui-surface-raised)" />}
      </div>
      <div className={`min-w-0 flex-1 ${last ? "" : TIMELINE_GAP}`}>
        <Button
          variant="item"
          type="button"
          title={commit.url ? t("Open commit") : commit.messageHeadline}
          disabled={!commit.url}
          onClick={() => void openUrl(commit.url)}
          className="w-full min-w-0 text-left"
        >
          <span className="min-w-0 flex-1 truncate text-(--ui-text-secondary) group-hover:text-(--ui-tone-neutral-fg) group-disabled:text-(--ui-text-secondary)">
            {commit.messageHeadline}
          </span>
          <span className="shrink-0 font-mono text-[11px] text-(--ui-text-secondary) group-hover:text-(--ui-text-secondary)">
            {commit.oid.slice(0, 7)}
          </span>
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
    return <span className="min-w-0 truncate font-medium text-(--ui-tone-neutral-fg)">{name}</span>;
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <InboxAvatar name={name} avatarUrl={avatarUrl} />
      <span className="min-w-0 truncate font-medium text-(--ui-tone-neutral-fg)">{name}</span>
    </span>
  );
}

function InboxAvatar({ name, avatarUrl }: { name: string; avatarUrl: string }) {
  useLocale();
  const [failed, setFailed] = useState(!avatarUrl);
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  useEffect(() => {
    setFailed(!avatarUrl);
  }, [avatarUrl]);

  return avatarUrl && !failed ? (
    <img
      src={avatarUrl}
      alt=""
      width={20}
      height={20}
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailed(true)}
      className="size-5 shrink-0 rounded-full bg-(--ui-surface-raised) object-cover"
    />
  ) : (
    <span
      aria-hidden
      className="grid size-5 shrink-0 place-items-center rounded-full bg-(--ui-surface-raised) text-[10px] font-medium text-(--ui-text-secondary)"
    >
      {initial}
    </span>
  );
}
