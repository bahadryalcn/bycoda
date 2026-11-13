import { useEffect, useRef } from "react";
import { t } from "../../../../shared/i18n";
import { Text } from "../../../../shared/ui/Text";
import { surfaceAttributes } from "../../../../shared/ui/Surface";
import type { VoiceChatTurn } from "./voiceCompanionTypes";
import styles from "./VoiceCompanionParts.module.css";

/** Owner speech on the right, assistant replies on the left; the newest line stays in view. */
export function VoiceChatTranscript({ turns }: { turns: readonly VoiceChatTurn[] }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = list.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [turns]);
  if (!turns.length) return null;
  return (
    <div ref={list} className={styles.chat} role="list" aria-label={t("Conversation")}>
      {turns.map((turn) => (
        <div className={styles.row} data-role={turn.role} key={turn.id} role="listitem">
          <Text
            as="div"
            size="secondary"
            tone="inherit"
            leading="normal"
            {...surfaceAttributes(
              {
                radius: "popup",
                tone: turn.role === "owner" ? "accent" : undefined,
                variant: turn.role === "assistant" ? "neutral-hover" : undefined,
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
