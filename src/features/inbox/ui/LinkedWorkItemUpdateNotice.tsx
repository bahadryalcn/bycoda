import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { ClampText } from "../../../shared/ui/ClampText";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";
import { t, useLocale } from "../../../shared/i18n";
import { openUrlSafely } from "../../../shared/lib/openUrlSafely";
import { useEffect, useState } from "react";
import {
  linkedWorkItemActivityPrompt,
  linkedWorkItemTerminalState,
  linkedWorkItemUpdateSummary,
  type LinkedWorkItemActivityEntry,
  type LinkedWorkItemUpdateCard,
} from "../model/linkedWorkItemActivity";
import { formatRelativeTime } from "../model/githubTasks";
import { announceLinkedActivity } from "../../settings/model/sounds";
import { TransientNotice } from "../../../shared/ui/TransientNotice";
import {
  Archive,
  Check,
  CircleDot,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  MessageSquare,
  Trash2,
} from "../../../shared/ui/icons";

type Props = {
  sessionId: string;
  card?: LinkedWorkItemUpdateCard;
  onAcknowledge: () => void;
  onDismiss: () => void;
  onOpenDiscussion: () => void;
  onAddToChat: (text: string) => void;
  onArchiveSession?: () => Promise<boolean>;
  onDeleteSession?: () => Promise<boolean>;
};

function entryKindLabel(entry: LinkedWorkItemActivityEntry): string {
  switch (entry.kind) {
    case "commit":
      return `Commit ${entry.id.slice(0, 7)}`;
    case "review":
      return "Review";
    case "review_comment":
      return "Review comment";
    default:
      return "Comment";
  }
}

function ActivityIcon({ entry }: { entry: LinkedWorkItemActivityEntry }) {
  useLocale();
  if (entry.kind === "commit") {
    return <GitBranch className="icon-sm shrink-0" strokeWidth={1.75} />;
  }
  if (entry.kind === "review") {
    return <Check className="icon-sm shrink-0" strokeWidth={1.75} />;
  }
  return <MessageSquare className="icon-sm shrink-0" strokeWidth={1.75} />;
}

export function LinkedWorkItemUpdateNotice({
  sessionId,
  card,
  onAcknowledge,
  onDismiss,
  onOpenDiscussion,
  onAddToChat,
  onArchiveSession,
  onDeleteSession,
}: Props) {
  useLocale();
  const [cleanupAction, setCleanupAction] = useState<"archive" | "delete" | undefined>();
  useEffect(() => {
    announceLinkedActivity(sessionId, card);
  }, [sessionId, card]);
  if (!card || card.status === "loading") return null;

  const KindIcon = card.kind === "pr" ? GitPullRequest : CircleDot;
  const kindLabel = card.kind === "pr" ? "Pull request" : "Issue";
  const latest = card.entries[0];
  const discussion =
    latest?.kind === "comment" || latest?.kind === "review" || latest?.kind === "review_comment";
  const openLabel =
    latest?.kind === "commit" ? "Open commit" : `Open ${card.kind === "pr" ? "PR" : "issue"}`;
  const agentLabel = discussion
    ? "Address with agent"
    : latest?.kind === "commit"
      ? "Review with agent"
      : "Continue with agent";
  const terminalState = linkedWorkItemTerminalState(card);
  const terminalLabel =
    terminalState === "pr_merged"
      ? "Pull request merged"
      : terminalState === "pr_closed"
        ? "Pull request closed"
        : terminalState === "issue_closed"
          ? "Issue closed"
          : "";
  const TerminalIcon =
    terminalState === "pr_merged"
      ? GitMerge
      : terminalState === "pr_closed"
        ? GitPullRequestClosed
        : Check;

  const openActivity = () => {
    onAcknowledge();
    if (discussion) {
      onOpenDiscussion();
      return;
    }
    openUrlSafely(latest?.url || card.url);
  };
  const dismiss = () => {
    onAcknowledge();
    onDismiss();
  };
  const runCleanup = async (
    action: "archive" | "delete",
    handler: (() => Promise<boolean>) | undefined,
  ) => {
    if (!handler || cleanupAction) return;
    setCleanupAction(action);
    try {
      if (await handler()) onAcknowledge();
    } finally {
      setCleanupAction(undefined);
    }
  };

  return (
    <TransientNotice
      tone="info"
      anchor="container"
      placement="top-end"
      width="lg"
      durationMs={null}
      aria-label={t("New activity on {p0} {p1}", { p0: kindLabel, p1: card.number })}
      title={`${kindLabel} #${card.number} · ${card.repo}`}
      onDismiss={dismiss}
    >
      <div className="linked-activity-notice mt-1 flex min-w-0 flex-col gap-2">
        <Button
          variant="ghost"
          type="button"
          onClick={() => {
            onAcknowledge();
            openUrlSafely(card.url);
          }}
          className="block w-full text-left"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <KindIcon tone="secondary" className="icon-sm shrink-0" strokeWidth={1.75} />
            <Text
              as="span"
              size="secondary"
              weight="medium"
              tone="inherit"
              truncate
              className="hover:underline"
            >
              {card.title}
            </Text>
          </span>
        </Button>
        <Text as="p" size="micro" tone="secondary">
          {linkedWorkItemUpdateSummary(card)}
        </Text>

        {card.entries.length > 0 ? (
          <div className="max-h-52 overflow-y-auto border-t border-(--ui-tone-neutral-border) divide-y divide-stroke">
            {card.entries.slice(0, 3).map((entry) => (
              <Button
                variant="ghost"
                key={`${entry.kind}:${entry.id}`}
                type="button"
                disabled={!entry.url}
                onClick={() => {
                  if (entry.url) {
                    onAcknowledge();
                    openUrlSafely(entry.url);
                  }
                }}
                className="w-full text-left"
              >
                <Text size="inherit" tone="secondary" className="mt-0.5">
                  <ActivityIcon entry={entry} />
                </Text>
                <span className="min-w-0 flex-1">
                  <Text size="micro" tone="inherit" className="flex min-w-0 items-center gap-1.5">
                    <Text size="inherit" tone="secondary" weight="medium">
                      {entryKindLabel(entry)}
                    </Text>
                    {entry.author ? (
                      <Text size="inherit" tone="secondary" truncate className="min-w-0">
                        @{entry.author}
                      </Text>
                    ) : null}
                    <Text size="inherit" tone="secondary" className="ml-auto shrink-0">
                      {formatRelativeTime(entry.createdAt)}
                    </Text>
                  </Text>
                  <ClampText
                    as="span"
                    lines={2}
                    expandable={false}
                    size="caption"
                    tone="secondary"
                    className="mt-0.5"
                  >
                    {entry.text || t("No message")}
                  </ClampText>
                </span>
              </Button>
            ))}
          </div>
        ) : null}

        {terminalState ? (
          <div {...surfaceAttributes({ frame: "neutral", edge: "top" }, "pt-2")}>
            <Text as="div" size="micro" tone="inherit" className="flex items-center gap-2">
              <Badge
                tone={terminalState === "pr_merged" ? "accent" : "success"}
                size="xs"
                appearance="subtle"
                icon={<TerminalIcon strokeWidth={1.75} />}
              >
                {terminalLabel}
              </Badge>
              <Text size="inherit" tone="secondary">
                {t("Clean up this session")}
              </Text>
            </Text>
            <div className="mt-2 flex items-center gap-1.5">
              <Button
                variant="ghost"
                type="button"
                disabled={Boolean(cleanupAction) || !onArchiveSession}
                onClick={() => void runCleanup("archive", onArchiveSession)}
                className="min-w-0"
              >
                {cleanupAction === "archive" ? (
                  <Spinner size="xs" />
                ) : (
                  <Archive className="icon-xs shrink-0" strokeWidth={1.75} />
                )}
                <Text size="inherit" tone="inherit" truncate className="min-w-0 whitespace-nowrap">
                  {t("Archive session")}
                </Text>
              </Button>
              <Button
                variant="ghost"
                tone="danger"
                type="button"
                disabled={Boolean(cleanupAction) || !onDeleteSession}
                onClick={() => void runCleanup("delete", onDeleteSession)}
                className="ml-auto min-w-0"
              >
                {cleanupAction === "delete" ? (
                  <Spinner size="xs" />
                ) : (
                  <Trash2 className="icon-xs shrink-0" strokeWidth={1.75} />
                )}
                <Text size="inherit" tone="inherit" truncate className="min-w-0 whitespace-nowrap">
                  {t("Delete…")}
                </Text>
              </Button>
            </div>
          </div>
        ) : null}

        <Text
          as="div"
          size="micro"
          tone="inherit"
          {...surfaceAttributes(
            { frame: "neutral", edge: "top" },
            "flex min-w-0 items-center gap-1.5 pt-2",
          )}
        >
          <Button
            variant="ghost"
            type="button"
            tooltip={agentLabel}
            tooltipWhen="overflow"
            truncate
            className="min-w-0 flex-1"
            onClick={() => {
              onAcknowledge();
              onAddToChat(linkedWorkItemActivityPrompt(card));
            }}
          >
            {agentLabel}
          </Button>
          <Button
            variant="ghost"
            type="button"
            tooltip={openLabel}
            tooltipWhen="overflow"
            truncate
            className="min-w-0 flex-1"
            onClick={openActivity}
          >
            {openLabel}
          </Button>
        </Text>
      </div>
    </TransientNotice>
  );
}
