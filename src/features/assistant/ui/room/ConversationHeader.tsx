import { Tooltip } from "../../../../shared/ui/Tooltip";
import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { Text } from "../../../../shared/ui/Text";
import { useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { t } from "../../../../shared/i18n";
import { Badge } from "../../../../shared/ui/Badge";
import { Button } from "../../../../shared/ui/Button";
import { DropdownMenu } from "../../../../shared/ui/DropdownMenu";
import { MoreHorizontal, RefreshCw } from "../../../../shared/ui/icons";
import { hasAssistantSummaryRefresh } from "../../model/assistantSummaryRefresh";
import { AssistantRemoteAccess } from "../AssistantRemoteAccess";
import styles from "./Conversation.module.css";
import type { ConversationContext } from "./ConversationTypes";

export function ConversationHeader({
  c,
  onFailure,
}: {
  c: ConversationContext;
  onFailure: (cause: unknown) => void;
}) {
  const {
    snapshot,
    threadLabel,
    threadId,
    environmentId,
    roomSourceStatus,
    pending,
    clearing,
    summaryRefreshing,
    summaryLabel,
    summaryError,
    summaryState,
    summaryScopeVisible,
    threadMenu,
    setThreadMenu,
    refreshSummary,
    openDraftRecovery,
    clearConversation,
  } = c;
  const [remoteOpen, setRemoteOpen] = useState(false);
  const summaryFailed = summaryError?.threadId === threadId && !summaryRefreshing;
  const summaryRefreshable =
    !pending && !clearing && !summaryRefreshing && !!environmentId && summaryScopeVisible(threadId);
  return (
    <div {...surfaceAttributes({ frame: "pane", edge: "block-end" }, styles.header)}>
      <div className={styles.identity}>
        <Text as="strong" size="title" tone="inherit" weight="medium" leading="inherit" truncate>
          {snapshot.profile.name}
        </Text>
        <Badge key={threadId} size="xs" className={styles.threadChip}>
          {threadLabel}
        </Badge>
        <div className={styles.summaryStatus}>
          {(summaryRefreshing || summaryLabel || summaryFailed) && (
            <>
              {!summaryFailed && (summaryRefreshing || summaryState?.status !== "blocked") ? (
                <Text
                  as="p"
                  size="caption"
                  tone="secondary"
                  leading="inherit"
                  className={styles.summaryText}
                >
                  {t("Updating conversation summary")}
                </Text>
              ) : (
                <Tooltip label={summaryFailed ? summaryError?.text : undefined} asChild>
                  <Badge size="xs" tone={summaryFailed ? "neutral" : "warning"}>
                    {summaryFailed ? t("Summary unavailable") : summaryLabel}
                  </Badge>
                </Tooltip>
              )}
              <Button
                iconOnly
                label={t("Refresh conversation summary")}
                disabled={!summaryRefreshable}
                loading={summaryRefreshing}
                onClick={() => void refreshSummary().catch(onFailure)}
              >
                <RefreshCw className="icon-xs" />
              </Button>
            </>
          )}
        </div>
      </div>
      {threadId && (
        <div className={styles.actions}>
          <Button
            iconOnly
            label={t("Conversation actions")}
            disabled={pending || clearing || summaryRefreshing}
            loading={clearing || summaryRefreshing}
            onClick={(event) => setThreadMenu(event.currentTarget)}
          >
            <MoreHorizontal className="icon-md" />
          </Button>
        </div>
      )}
      {threadId && (
        <AssistantRemoteAccess
          key={`${environmentId ?? ""}:${threadId}`}
          threadId={threadId}
          environmentId={environmentId}
          sourceStatus={roomSourceStatus}
          open={remoteOpen}
          onClose={() => setRemoteOpen(false)}
        />
      )}
      {threadMenu && (
        <DropdownMenu
          anchor={threadMenu}
          label={t("Conversation actions")}
          onClose={() => setThreadMenu(null)}
          onPick={(id) => {
            setThreadMenu(null);
            if (id === "summary") void refreshSummary().catch(onFailure);
            else if (id === "recover-draft") openDraftRecovery();
            else if (id === "remote") setRemoteOpen(true);
            else if (id === "clear") clearConversation();
          }}
          items={[
            ...(isTauri()
              ? [
                  {
                    kind: "item" as const,
                    id: "recover-draft",
                    label: t("Recover draft"),
                    disabled: !environmentId || pending || clearing,
                  },
                ]
              : []),
            {
              kind: "item",
              id: "summary",
              label: t(
                hasAssistantSummaryRefresh(localStorage, environmentId, threadId)
                  ? "Retry summary refresh"
                  : "Refresh conversation summary",
              ),
              disabled: !summaryRefreshable,
            },
            {
              kind: "item",
              id: "remote",
              label: t("Remote Room access…"),
              disabled: !threadId || !environmentId,
            },
            {
              kind: "item",
              id: "clear",
              label: t("Clear conversation..."),
              danger: true,
              disabled: pending || clearing || summaryRefreshing,
            },
          ]}
        />
      )}
    </div>
  );
}
