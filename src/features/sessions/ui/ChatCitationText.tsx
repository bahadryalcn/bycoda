import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { Badge } from "../../../shared/ui/Badge";
import { useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { CopyButton } from "../../../shared/ui/CopyButton";
import {
  BlockQuote,
  Info,
  MessageSquare,
  StickyNote,
  UsersRound,
  X,
} from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import { copyMessage } from "../../../platform/tauri/clipboard";
import {
  chatCitationPreview,
  chatCitationToken,
  fileCommentLabel,
  type ChatCitation,
  type ComposerCitation,
  type FileCommentCitation,
} from "../model/chatCitation";
import { SkillTokenText } from "./SkillTokenText";
import { WorkItemMentionChip } from "./WorkItemMentionChip";
import { tokenLabel } from "../model/attachmentTokens";
import { findCitationTokens } from "../model/citationTokens";
import { highlightChatCitation } from "../model/chatCitationHighlight";
import styles from "./ChatCitationText.module.css";
import { scopedMentionParts } from "../model/composerMentionScopes";

/** Tracker tokens keep their lookup action. Crew and note tokens retain their source text. */
export function ScopedMentionText({ text }: { text: string }) {
  return scopedMentionParts(text).map((part, index) =>
    part.kind === "work-item" ? (
      <WorkItemMentionChip key={index} token={part.text} />
    ) : part.kind ? (
      <Badge
        key={index}
        size="xs"
        appearance="subtle"
        tone="accent"
        icon={part.kind === "crew" ? <UsersRound /> : <StickyNote />}
        data-scoped-mention={part.kind}
      >
        {part.text}
      </Badge>
    ) : (
      <SkillTokenText key={index} text={part.text} />
    ),
  );
}

/** An inline `[quoteN]` in sent text: hover highlights the source, click jumps to it. */
export function CitationTokenPill({
  token,
  citation,
}: {
  token: string;
  citation: ComposerCitation;
}) {
  return citation.file ? (
    <FileCommentPill citation={citation} />
  ) : (
    <ConversationCitationToken token={token} citation={citation} />
  );
}

function FileCommentPill({ citation }: { citation: FileCommentCitation }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const label = fileCommentLabel(citation.file);
  return (
    <>
      <Button
        variant="link"
        layout="text"
        motion="none"
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={Boolean(anchor)}
        onClick={(event) => {
          event.stopPropagation();
          setAnchor(event.currentTarget);
        }}
      >
        <Text as="span" size="inherit" tone="feature" className={styles.token}>
          <MessageSquare className={styles.tokenIcon} aria-hidden />
          {label}
        </Text>
      </Button>
      {anchor ? (
        <Popover
          anchor={anchor}
          side="top"
          width={360}
          kind="dialog"
          aria-label={label}
          onDismiss={() => setAnchor(null)}
          flow="scroll"
        >
          <div className={styles.details}>
            <Text size="caption" tone="secondary" wrap="anywhere">
              {citation.file.path}
            </Text>
            <Text as="blockquote" size="secondary" className={styles.quote}>
              {citation.text}
            </Text>
            <Text as="p" size="secondary" className={styles.comment}>
              {citation.comment}
            </Text>
          </div>
        </Popover>
      ) : null}
    </>
  );
}

function ConversationCitationToken({ token, citation }: { token: string; citation: ChatCitation }) {
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
        {...surfaceAttributes(
          {
            radius: "control",
            tone: unavailable ? "neutral" : "accent",
            ring: unavailable ? "tone-neutral" : "tone-accent",
          },
          styles.token,
        )}
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
  const label = citation.comment.trim() || citation.text;
  return (
    <div {...surfaceAttributes({ variant: "card", radius: "card" }, styles.item)}>
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
              {...surfaceAttributes(
                { radius: "control", tone: "accent", ring: "tone-accent" },
                styles.token,
              )}
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
          variant="panel"
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
            <blockquote className={styles.quote}>
              <Text size="secondary" leading="inherit">
                {citation.text}
              </Text>
            </blockquote>
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
            <CopyButton
              variant="ghost"
              size="sm"
              label={t("Copy quote")}
              copiedLabel={t("Quote copied")}
              onCopy={() => copyMessage(citation.text)}
            />
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
  citations: readonly ComposerCitation[];
  text: string;
}) {
  const used = new Set(findCitationTokens(text, citations.length).map((match) => match.index));
  if (!citations.some((citation, index) => !citation.file || !used.has(index))) return null;
  return (
    <div className={styles.list}>
      {citations.map((citation, index) =>
        citation.file ? (
          used.has(index) ? null : (
            <FileCommentPill key={`${citation.id}:${index}`} citation={citation} />
          )
        ) : (
          <Citation
            key={`${citation.id}:${index}`}
            citation={citation}
            token={used.has(index) ? chatCitationToken(index) : undefined}
          />
        ),
      )}
    </div>
  );
}
