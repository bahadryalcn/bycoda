import { useEffect, useRef } from "react";
import { t } from "../../../../shared/i18n";
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
          <div className={styles.bubble}>
            <span className="sr-only">{turn.role === "owner" ? t("You") : t("Reply")}: </span>
            {turn.text}
          </div>
        </div>
      ))}
    </div>
  );
}
