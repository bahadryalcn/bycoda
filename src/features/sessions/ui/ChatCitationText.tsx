import { useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { BlockQuote, Copy, Info, X } from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import { copyMessage } from "../../../platform/tauri/clipboard";
import { chatCitationPreview, chatCitationToken, type ChatCitation } from "../model/chatCitation";
import { tokenLabel } from "../model/attachmentTokens";
import { findCitationTokens } from "../model/citationTokens";
import { highlightChatCitation } from "../model/chatCitationHighlight";
import styles from "./ChatCitationText.module.css";

/** An inline `[quoteN]` in sent text: hover highlights the source, click jumps to it. */
export function CitationTokenPill({ token, citation }: { token: string; citation: ChatCitation }) {
  const [unavailable, setUnavailable] = useState(false);
  return (
    <Button
      variant="link"
      layout="text"
      motion="none"
      type="button"
      aria-label={`${tokenLabel(token)}: ${citation.comment.trim() || citation.text}`}
      tooltip={citation.text}
      tooltipWide
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
      <span className={styles.token} data-unavailable={unavailable || undefined}>
        <BlockQuote className={styles.tokenIcon} aria-hidden />
        {/* Brackets stay in the DOM so selecting and copying give the token back. */}
        <span className="sr-only">[</span>
        {tokenLabel(token)}
        <span className="sr-only">]</span>
      </span>
    </Button>
  );
}

function Citation({ citation, token }: { citation: ChatCitation; token?: string }) {
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
          aria-label={label}
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
          {token ? <span className={styles.token}>{tokenLabel(token)}</span> : null}
          <span className={styles.label}>{chatCitationPreview(citation)}</span>
        </Button>
        <Button
          iconOnly
          label={t("Quoted reply")}
          variant="ghost"
          size="sm"
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

/**
 * Sent-message references preserve a readable snapshot even when the source is gone.
 * A row names its `quoteN` token only when `text` mentions it, so older messages look unchanged.
 */
export function ChatCitationList({
  citations,
  text,
}: {
  citations: readonly ChatCitation[];
  text: string;
}) {
  if (!citations.length) return null;
  const used = new Set(findCitationTokens(text, citations.length).map((match) => match.index));
  return (
    <div className={styles.list}>
      {citations.map((citation, index) => (
        <Citation
          key={`${citation.id}:${index}`}
          citation={citation}
          token={used.has(index) ? chatCitationToken(index) : undefined}
        />
      ))}
    </div>
  );
}
