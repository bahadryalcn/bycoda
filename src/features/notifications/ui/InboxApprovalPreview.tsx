import { surfaceAttributes } from "../../../shared/ui/Surface";
import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { Text } from "../../../shared/ui/Text";
import { useT } from "../../../shared/i18n";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { MiddleTruncate } from "../../../shared/ui/MiddleTruncate";
import { Surface } from "../../../shared/ui/Surface";
import { AgentMarkdown } from "../../sessions/public/AgentMarkdown";
import type { InboxApprovalComment, InboxApprovalDetails } from "../model/inboxApprovalDetails";

const EVENTS: Record<string, { label: string; tone: BadgeTone }> = {
  COMMENT: { label: "Comment", tone: "info" },
  APPROVE: { label: "Approve", tone: "success" },
  REQUEST_CHANGES: { label: "Request changes", tone: "warning" },
};

function lines(comment: InboxApprovalComment) {
  return comment.startLine ? `L${comment.startLine}–${comment.line}` : `L${comment.line}`;
}

/** Markdown without remote media: an approval preview never fetches agent-chosen URLs. */
function Body({ text, cwd }: { text: string; cwd: string }) {
  return <AgentMarkdown className="inbox-comment-md" text={text} cwd={cwd} />;
}

/**
 * Inbox write approval rendered the way it will read on the provider: review verdict, summary
 * and each line comment under its file. The exact native text stays one click away.
 */
export function InboxApprovalPreview({
  details,
  message,
}: {
  details: InboxApprovalDetails;
  message: string;
}) {
  const t = useT();
  const review = details.review;
  const event = review ? EVENTS[review.event] : undefined;
  return (
    <Text as="div" size="body" tone="inherit" className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Text as="strong" size="inherit" tone="inherit" truncate className="min-w-0">
          {details.target}
        </Text>
        <Badge size="xs" tone="neutral">
          {details.provider}
        </Badge>
        {review ? (
          <Badge size="xs" tone={event?.tone ?? "neutral"}>
            {event ? t(event.label) : review.event}
          </Badge>
        ) : null}
      </div>
      <DescriptionList size="sm">
        <DescriptionItem term={t("Project")} truncate monospace>
          {details.project}
        </DescriptionItem>
        {review ? (
          <DescriptionItem term={t("Commit")} monospace>
            {review.commitId.slice(0, 12)}
          </DescriptionItem>
        ) : null}
        {details.replyTo ? (
          <DescriptionItem term={t("Replying to")} truncate monospace>
            {details.replyTo}
          </DescriptionItem>
        ) : null}
        {details.prAction ? (
          <DescriptionItem term={t("Pull request change")}>{details.prAction}</DescriptionItem>
        ) : null}
        {details.headSha ? (
          <DescriptionItem term={t("Reviewed head")} monospace>
            {details.headSha.slice(0, 12)}
          </DescriptionItem>
        ) : null}
      </DescriptionList>
      {details.thread ? (
        <OutputBlock
          size="caption"
          tone="secondary"
          frame="card"
          className="max-h-32 overflow-auto break-words"
        >
          {details.thread}
        </OutputBlock>
      ) : null}
      {details.body ? <Body text={details.body} cwd={details.project} /> : null}
      {review?.body ? <Body text={review.body} cwd={details.project} /> : null}
      {review?.comments.length ? (
        <section aria-label={t("Line comments")} className="flex flex-col gap-2">
          <Text size="caption" tone="secondary">
            {t("Line comments")} · {review.comments.length}
          </Text>
          {review.comments.map((comment, index) => (
            <Surface
              key={`${comment.path}:${comment.line}:${index}`}
              as="article"
              variant="outline"
              padding="none"
              className="min-w-0 overflow-hidden"
            >
              <Text
                as="header"
                size="caption"
                tone="inherit"
                {...surfaceAttributes(
                  { frame: "pane", edge: "bottom" },
                  "flex min-w-0 items-center gap-2 border-(--ui-pane-border) px-3 py-1.5 font-mono",
                )}
              >
                <MiddleTruncate mode="path" className="min-w-0">
                  {comment.path}
                </MiddleTruncate>
                <Text size="inherit" tone="secondary" className="shrink-0">
                  {lines(comment)}
                </Text>
                {comment.side === "LEFT" ? (
                  <Badge size="xs" tone="neutral">
                    {t("Old side")}
                  </Badge>
                ) : null}
              </Text>
              <div className="px-3 py-2">
                <Body text={comment.body} cwd={details.project} />
              </div>
            </Surface>
          ))}
        </section>
      ) : null}
      <Disclosure size="sm" summary={t("Exact request text")}>
        <OutputBlock size="caption" tone="secondary" className="break-words">
          {message}
        </OutputBlock>
      </Disclosure>
    </Text>
  );
}
