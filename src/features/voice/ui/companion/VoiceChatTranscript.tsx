import { useEffect, useRef } from "react";
import { t } from "../../../../shared/i18n";
import { Text } from "../../../../shared/ui/Text";
import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { isAtChatTail } from "./voiceChatScroll";
import type { VoiceChatTurn } from "./voiceCompanionTypes";
import styles from "./VoiceCompanionParts.module.css";

/**
 * Owner speech on the right, assistant replies on the left. The newest line stays in view while
 * the reader rests at the end; scrolling up to older turns stops the follow until they return.
 */
export function VoiceChatTranscript({ turns }: { turns: readonly VoiceChatTurn[] }) {
  const list = useRef<HTMLDivElement>(null);
  // Whether the reader was at the end before the latest update; only their own scrolling changes
  // it, so growth from new or streamed text never reads as the reader leaving.
  const following = useRef(true);
  useEffect(() => {
    // Runs after each transcript update: keeps the end in view only for a reader who is following it.
    if (!turns.length) following.current = true;
    const node = list.current;
    if (node && following.current) node.scrollTop = node.scrollHeight;
  }, [turns]);
  if (!turns.length) return null;
  return (
    <div
      ref={list}
      className={styles.chat}
      role="list"
      aria-label={t("Conversation")}
      onScroll={(event) => {
        following.current = isAtChatTail(event.currentTarget);
      }}
    >
      {turns.map((turn) => (
        <div className={styles.row} data-role={turn.role} key={turn.id} role="listitem">
          <Text
            as="div"
            size="body"
            tone="inherit"
            leading="normal"
            {...surfaceAttributes(
              {
                radius: "popup",
                tone: turn.role === "owner" ? "accent" : undefined,
              },
              styles.bubble,
            )}
          >
            <span className="sr-only">{turn.role === "owner" ? t("You") : t("Reply")}: </span>
            {turn.text}
          </Text>
        </div>
      ))}
    </div>
  );
}
