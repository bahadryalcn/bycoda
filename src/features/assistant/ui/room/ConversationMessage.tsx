import { Text } from "../../../../shared/ui/Text";
import type { AssistantMessage } from "../../../../shared/model/host-contracts/assistant";
import { t } from "../../../../shared/i18n";
import type { MessageTimelineItem } from "../../../../shared/ui/MessageTimeline";
import { Tooltip } from "../../../../shared/ui/Tooltip";
import { Button } from "../../../../shared/ui/Button";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { Trash2, TriangleAlert } from "../../../../shared/ui/icons";
import { assistantChatItem } from "./AssistantChat";
import styles from "./Conversation.module.css";
import { recordedActionLabel } from "./recordedActionLabels";

/** One room message as a shared timeline item. */
export function conversationMessageItem({
  message,
  authorName,
  jobs,
  clearing,
  onOpenSession,
  onJob,
  onDelete,
}: {
  message: AssistantMessage;
  authorName: string;
  jobs: readonly { id: string; title: string }[];
  clearing: boolean;
  onOpenSession?: (id: string) => void | Promise<void>;
  onJob: (id: string) => void;
  onDelete: (message: AssistantMessage) => void;
}): MessageTimelineItem {
  return assistantChatItem({
    id: message.id,
    role: message.role,
    text: message.text,
    time: message.createdAt,
    author: message.role === "user" ? undefined : authorName,
    meta: message.via === "voice" ? <span>{t("Voice")}</span> : undefined,
    actions: [
      {
        id: "delete",
        label: t("Delete message"),
        icon: <Trash2 className="icon-xs" />,
        disabled: clearing,
        onSelect: () => onDelete(message),
      },
    ],
    children: (
      <>
        {message.ownerQuestionId && (
          <Text size="caption" tone="secondary" leading="inherit">
            {message.ownerQuestionAction === "snooze"
              ? t("Question postponed")
              : t("Answer recorded")}
          </Text>
        )}
        {!!message.toolActions?.length && (
          <Disclosure size="sm" summary={t("Recorded actions")} count={message.toolActions.length}>
            <ul className={styles.detailsList}>
              {message.toolActions.map((action) => (
                <li key={action.id}>
                  <span>{recordedActionLabel(action.action)}</span>
                  {action.status === "completed" ? null : (
                    <Tooltip
                      asChild
                      label={t("Outcome unknown")}
                      details={[t("The Host has not confirmed that this action finished.")]}
                    >
                      <span role="img" aria-label={t("Outcome unknown")}>
                        <TriangleAlert className="icon-xs" tone="warning" />
                      </span>
                    </Tooltip>
                  )}
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
        {message.sessionId && onOpenSession && (
          <Button variant="link" onClick={() => onOpenSession(message.sessionId!)}>
            {t("Open session")}
          </Button>
        )}
        {!!message.jobIds.length && (
          <Disclosure size="sm" summary={t("Jobs")} count={message.jobIds.length}>
            <div className={styles.links}>
              {message.jobIds.map((id) => {
                const job = jobs.find((item) => item.id === id);
                return job ? (
                  <Button key={id} variant="link" onClick={() => onJob(id)}>
                    {job.title}
                  </Button>
                ) : (
                  <Text key={id} size="caption" tone="secondary" leading="inherit">
                    {t("Job unavailable")}
                  </Text>
                );
              })}
            </div>
          </Disclosure>
        )}
      </>
    ),
  });
}
