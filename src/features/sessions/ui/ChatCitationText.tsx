import { useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { BlockQuote, Copy, Info, X } from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import { copyMessage } from "../../../platform/tauri/clipboard";
import type { ChatCitation } from "../model/chatCitation";
import { highlightChatCitation } from "../model/chatCitationHighlight";
import styles from "./ChatCitationText.module.css";

function Citation({ citation }: { citation: ChatCitation }) {
  const t = useT();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "pending" | "copied" | "error">("idle");
  const label = citation.comment.trim() || citation.text;
  return (
    <div className={styles.item}>
      <div className={styles.row}>
        <Button
          variant="link"
          size="sm"
          layout="text"
          motion="none"
          className={styles.source}
          tooltip={citation.text}
          onPointerEnter={() => highlightChatCitation(citation)}
          onFocus={() => highlightChatCitation(citation)}
          onClick={(event) => {
            event.stopPropagation();
            setUnavailable(
              !highlightChatCitation(citation, {
                navigate: true,
                onUnavailable: () => setUnavailable(true),
              }),
            );
          }}
        >
          <BlockQuote className="icon-sm shrink-0" />
          <span className={styles.label}>{label}</span>
        </Button>
        <Button
          iconOnly
          label={t("Quoted reply")}
          variant="ghost"
          size="sm"
          tooltip={t("Quoted reply")}
          aria-expanded={Boolean(anchor)}
          onClick={(event) => {
            event.stopPropagation();
            setAnchor(event.currentTarget);
          }}
        >
          <Info className="icon-sm" />
        </Button>
      </div>
      {unavailable ? (
        <span className={styles.fallback} role="status">
          {t("Source changed or unavailable. The saved quote is preserved.")}
          <span className={styles.excerpt}>{citation.text}</span>
        </span>
      ) : null}
      {anchor ? (
        <Popover
          anchor={anchor}
          side="top"
          align="end"
          width={360}
          onDismiss={() => setAnchor(null)}
        >
          <div className={styles.details}>
            <div className={styles.header}>
              <strong>{t("Quoted reply")}</strong>
              <Button
                iconOnly
                label={t("Close")}
                variant="ghost"
                size="sm"
                onClick={() => setAnchor(null)}
              >
                <X className="icon-sm" />
              </Button>
            </div>
            <blockquote className={styles.quote}>{citation.text}</blockquote>
            {citation.comment ? <p className={styles.comment}>{citation.comment}</p> : null}
            <Button
              variant="ghost"
              size="sm"
              loading={copyState === "pending"}
              onClick={async () => {
                if (copyState === "pending") return;
                setCopyState("pending");
                try {
                  await copyMessage(citation.text);
                  setCopyState("copied");
                } catch {
                  setCopyState("error");
                }
              }}
            >
              <Copy className="icon-sm" />
              {copyState === "copied" ? t("Quote copied") : t("Copy quote")}
            </Button>
            {copyState === "error" ? (
              <InlineError>{t("Could not copy quote. Please try again.")}</InlineError>
            ) : null}
          </div>
        </Popover>
      ) : null}
    </div>
  );
}

/** Sent-message references preserve a readable snapshot even when the source is gone. */
export function ChatCitationList({ citations }: { citations: readonly ChatCitation[] }) {
  if (!citations.length) return null;
  return (
    <div className={styles.list}>
      {citations.map((citation, index) => (
        <Citation key={`${citation.id}:${index}`} citation={citation} />
      ))}
    </div>
  );
}
