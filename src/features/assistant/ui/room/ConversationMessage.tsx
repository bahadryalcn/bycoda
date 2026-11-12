import { Text } from "../../../../shared/ui/Text";
import type { AssistantMessage } from "../../../../shared/model/host-contracts/assistant";
import { formatDate, t } from "../../../../shared/i18n";
import { formatRelativeTime } from "../../../../shared/i18n/format";
import { useMinuteNow } from "../../../../shared/hooks/useMinuteNow";
import { Button } from "../../../../shared/ui/Button";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { Trash2 } from "../../../../shared/ui/icons";
import { Tooltip } from "../../../../shared/ui/Tooltip";
import { ActionHost, InlineAction } from "../../../../shared/ui/ActionHost";
import styles from "./Conversation.module.css";
import { date } from "./assistantRoomHelpers";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** "Today" and "Yesterday" for the last two days, a full date before that. */
export function ConversationDayLabel({ at }: { at: number }) {
  const start = (value: number) => new Date(new Date(value).setHours(0, 0, 0, 0)).getTime();
  const now = useMinuteNow();
  const days = Math.round((start(now) - start(at)) / DAY);
  return (
    <Text as="div" size="caption" tone="secondary" leading="inherit" className={styles.dayDivider}>
      {days === 0
        ? t("Today")
        : days === 1
          ? t("Yesterday")
          : formatDate(at, { day: "numeric", month: "long", year: "numeric" })}
    </Text>
  );
}

/** Relative inside the hour ("5 min. ago"), clock time after that; full precision in the tooltip. */
function ConversationMessageTime({ at }: { at: number }) {
  const now = useMinuteNow();
  const recent = now - at < HOUR;
  return (
    <Tooltip label={date(at)} asChild>
      <span className={styles.metaTime}>
        {recent
          ? formatRelativeTime(at, { style: "short" })
          : formatDate(at, { hour: "numeric", minute: "2-digit" })}
      </span>
    </Tooltip>
  );
}

export function ConversationMessage({
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
}) {
  return (
    <article className={styles.message} data-author={message.role}>
      <div className={styles.bubble}>
        {message.ownerQuestionId && (
          <Text size="caption" tone="secondary" leading="inherit" className={styles.note}>
            {t(message.ownerQuestionAction === "snooze" ? "Question postponed" : "Answer recorded")}
          </Text>
        )}
        <Text as="p" size="body" tone="inherit" leading="relaxed" className={styles.bubbleText}>
          {message.text}
        </Text>
        {!!message.toolActions?.length && (
          <Disclosure size="sm" summary={t("Recorded actions")} count={message.toolActions.length}>
            <ul className={styles.detailsList}>
              {message.toolActions.map((action) => (
                <li key={action.id}>
                  {action.family} · {action.action} —{" "}
                  {t(action.status === "completed" ? "Completed" : "Outcome unknown")}
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
                  <Text
                    size="caption"
                    tone="secondary"
                    leading="inherit"
                    key={id}
                    className={styles.note}
                  >
                    {id}
                  </Text>
                );
              })}
            </div>
          </Disclosure>
        )}
      </div>
      <ActionHost className={styles.meta}>
        <Text
          as="div"
          size="micro"
          tone="secondary"
          leading="inherit"
          className={styles.metaContent}
        >
          {message.role !== "user" && <span>{authorName}</span>}
          {message.via === "voice" && <span>{t("Voice")}</span>}
          <ConversationMessageTime at={message.createdAt} />
          <InlineAction
            reveal="always"
            label={t("Delete message")}
            disabled={clearing}
            onClick={() => onDelete(message)}
          >
            <Trash2 className="icon-xs" />
          </InlineAction>
        </Text>
      </ActionHost>
    </article>
  );
}
