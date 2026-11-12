import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { BlockQuote, Copy, Info, X } from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import { copyMessage } from "../../../platform/tauri/clipboard";
import { chatCitationPreview, chatCitationToken, type ChatCitation } from "../model/chatCitation";
import { SkillTokenText } from "./SkillTokenText";
import { tokenLabel } from "../model/attachmentTokens";
import { findCitationTokens } from "../model/citationTokens";
import { highlightChatCitation } from "../model/chatCitationHighlight";
import styles from "./ChatCitationText.module.css";
import { providerForAlias } from "../../inbox/public/workItemMentions";

/** Display every tracker token, including repeats beyond the context lookup limit. */
export function workItemMentionParts(text: string): { text: string; workItem?: true }[] {
  const parts: { text: string; workItem?: true }[] = [];
  const tokens = /(^|[\s([{])(@([a-z]+):[a-z0-9](?:[a-z0-9_./#!-]*[a-z0-9])?)/gi;
  let end = 0;
  for (const match of text.matchAll(tokens)) {
    if (!providerForAlias(match[3])) continue;
    const start = match.index + match[1].length;
    if (start > end) parts.push({ text: text.slice(end, start) });
    parts.push({ text: match[2], workItem: true });
    end = start + match[2].length;
  }
  if (end < text.length) parts.push({ text: text.slice(end) });
  return parts;
}

/** Tracker refs lack a persisted URL; preserve literal, selectable text without a guessed link. */
export function WorkItemMentionText({ text }: { text: string }) {
  return workItemMentionParts(text).map((part, index) =>
    part.workItem ? (
      <Text key={index} size="inherit" tone="accent" data-work-item-mention="">
        {part.text}
      </Text>
    ) : (
      <SkillTokenText key={index} text={part.text} />
    ),
  );
}

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
      <Text
        as="span"
        size="inherit"
        tone={unavailable ? "secondary" : "accent"}
        {...surfaceAttributes({ radius: "control" }, styles.token)}
        data-unavailable={unavailable || undefined}
      >
        <BlockQuote className={styles.tokenIcon} aria-hidden />
        {/* Brackets stay in the DOM so selecting and copying give the token back. */}
        <span className="sr-only">[</span>
        {tokenLabel(token)}
        <span className="sr-only">]</span>
      </Text>
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
          {token ? (
            <Text
              as="span"
              size="inherit"
              tone="accent"
              {...surfaceAttributes({ radius: "control" }, styles.token)}
            >
              {tokenLabel(token)}
            </Text>
          ) : null}
          <Text size="inherit" tone="inherit" truncate className={styles.label}>
            {chatCitationPreview(citation)}
          </Text>
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
        <Text size="caption" tone="secondary" className={styles.fallback} role="status">
          {t("Source changed or unavailable. The saved quote is preserved.")}
          <span className={styles.excerpt}>{citation.text}</span>
        </Text>
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
            <Text as="div" tone="inherit" leading="inherit" className={styles.header}>
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
            </Text>
            <Text as="blockquote" size="secondary" leading="inherit" className={styles.quote}>
              {citation.text}
            </Text>
            {citation.comment ? (
              <Text
                as="p"
                size="secondary"
                tone="inherit"
                leading="inherit"
                className={styles.comment}
              >
                {citation.comment}
              </Text>
            ) : null}
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
