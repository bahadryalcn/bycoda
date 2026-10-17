import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { openUrl } from "@tauri-apps/plugin-opener";
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
import { GlassBackdrop } from "../../../app/shell/GlassBackdrop";
import {
  Archive,
  Check,
  CircleDot,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  Loader,
  MessageSquare,
  Trash2,
  X,
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
    return <GitBranch className="size-3.5 shrink-0" strokeWidth={1.75} />;
  }
  if (entry.kind === "review") {
    return <Check className="size-3.5 shrink-0" strokeWidth={1.75} />;
  }
  return <MessageSquare className="size-3.5 shrink-0" strokeWidth={1.75} />;
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
    void openUrl(latest?.url || card.url);
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
    <section
      aria-label={t("New activity on {p0} {p1}", { p0: kindLabel, p1: card.number })}
      aria-live="polite"
      className="pointer-events-auto absolute top-3 right-3 z-40 isolate w-[min(320px,calc(100%_-_24px))] overflow-hidden rounded-xl border border-(--ui-tone-neutral-border) text-(--ui-tone-neutral-fg) shadow-xl"
    >
      <GlassBackdrop />
      <div className="linked-activity-notice relative z-[1]">
        <div className="relative z-[1] flex items-center justify-between gap-0.5 border-b border-(--ui-tone-neutral-border) px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="size-2 shrink-0 rounded-full bg-(--ui-tone-accent-subtle)" />
            <KindIcon className="size-3.5 text-(--ui-text-secondary)" strokeWidth={1.75} />
            <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">
              {t("GitHub activity")}
            </span>
          </div>
          <Button
            iconOnly
            label={t("Dismiss updates for {p0} {p1}", { p0: kindLabel, p1: card.number })}
            variant="ghost"
            type="button"
            title={t("Dismiss")}
            aria-label={t("Dismiss updates for {p0} {p1}", { p0: kindLabel, p1: card.number })}
            onClick={dismiss}
            className="shrink-0"
          >
            <X className="size-3" strokeWidth={2} />
          </Button>
        </div>

        <div className="relative z-[1] px-3 py-2.5">
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              onAcknowledge();
              void openUrl(card.url);
            }}
            className="block w-full text-left"
          >
            <span className="block text-[11px] text-(--ui-text-secondary)">
              {kindLabel} #{card.number} · {card.repo}
            </span>
            <span className="mt-0.5 block truncate text-[13px] font-medium hover:underline">
              {card.title}
            </span>
          </Button>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-(--ui-text-secondary)">
            <span>{linkedWorkItemUpdateSummary(card)}</span>
          </div>
        </div>

        {card.entries.length > 0 ? (
          <div className="relative z-[1] max-h-52 overflow-y-auto border-t border-(--ui-tone-neutral-border) divide-y divide-stroke">
            {card.entries.slice(0, 3).map((entry) => (
              <Button
                variant="ghost"
                key={`${entry.kind}:${entry.id}`}
                type="button"
                disabled={!entry.url}
                onClick={() => {
                  if (entry.url) {
                    onAcknowledge();
                    void openUrl(entry.url);
                  }
                }}
                className="w-full text-left"
              >
                <span className="mt-0.5 text-(--ui-text-secondary)">
                  <ActivityIcon entry={entry} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5 text-[11px]">
                    <span className="font-medium text-(--ui-text-secondary)">
                      {entryKindLabel(entry)}
                    </span>
                    {entry.author ? (
                      <span className="min-w-0 truncate text-(--ui-text-secondary)">
                        @{entry.author}
                      </span>
                    ) : null}
                    <span className="ml-auto shrink-0 text-(--ui-text-secondary)">
                      {formatRelativeTime(entry.createdAt)}
                    </span>
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-[12px] leading-relaxed text-(--ui-text-secondary)">
                    {entry.text || t("No message")}
                  </span>
                </span>
              </Button>
            ))}
          </div>
        ) : null}

        {terminalState ? (
          <div className="relative z-[1] border-t border-(--ui-tone-neutral-border) px-3 py-2.5">
            <div className="flex items-center gap-2 text-[11px]">
              <TerminalIcon
                className={
                  terminalState === "pr_merged"
                    ? "size-3.5 shrink-0 text-(--ui-tone-accent-fg)"
                    : "size-3.5 shrink-0 text-(--ui-tone-success-fg)"
                }
                strokeWidth={1.75}
              />
              <span className="font-medium text-(--ui-text-secondary)">{terminalLabel}</span>
              <span className="text-(--ui-text-secondary)">{t("Clean up this session")}</span>
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <Button
                variant="ghost"
                type="button"
                title={t("Archive session")}
                disabled={Boolean(cleanupAction) || !onArchiveSession}
                onClick={() => void runCleanup("archive", onArchiveSession)}
                className="min-w-0"
              >
                {cleanupAction === "archive" ? (
                  <Loader className="size-3 shrink-0 animate-spin" />
                ) : (
                  <Archive className="size-3 shrink-0" strokeWidth={1.75} />
                )}
                <span className="min-w-0 truncate whitespace-nowrap">{t("Archive session")}</span>
              </Button>
              <Button
                variant="ghost"
                type="button"
                title={t("Delete session")}
                disabled={Boolean(cleanupAction) || !onDeleteSession}
                onClick={() => void runCleanup("delete", onDeleteSession)}
                className="min-w-0"
              >
                {cleanupAction === "delete" ? (
                  <Loader className="size-3 shrink-0 animate-spin" />
                ) : (
                  <Trash2 className="size-3 shrink-0" strokeWidth={1.75} />
                )}
                <span className="min-w-0 truncate whitespace-nowrap">{t("Delete…")}</span>
              </Button>
            </div>
          </div>
        ) : null}

        <div className="relative z-[1] flex min-w-0 items-center gap-1.5 border-t border-(--ui-tone-neutral-border) px-3 py-2.5 text-[11px]">
          <Button
            variant="ghost"
            type="button"
            title={agentLabel}
            className="min-w-0 flex-1 truncate"
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
            title={openLabel}
            className="min-w-0 flex-1 truncate"
            onClick={openActivity}
          >
            {openLabel}
          </Button>
        </div>
      </div>
    </section>
  );
}
