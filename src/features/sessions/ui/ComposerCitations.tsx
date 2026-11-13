import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { useEffect, useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Popover } from "../../../shared/ui/Popover";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { InlineError } from "../../../shared/ui/InlineError";
import { LiveText } from "../../../shared/ui/LiveText";
import { BlockQuote, Copy, Pencil, X } from "../../../shared/ui/icons";
import { copyMessage } from "../../../platform/tauri/clipboard";
import { chatCitationPreview, chatCitationToken, type ChatCitation } from "../model/chatCitation";
import { tokenLabel } from "../model/attachmentTokens";
import { highlightChatCitation } from "../model/chatCitationHighlight";
import styles from "./ComposerCitations.module.css";

// Module level: React Compiler cannot lower try/finally inside a component.
async function copyCitation(
  citation: ChatCitation,
  {
    copying,
    setCopied,
    setCopyingId,
    setError,
    failure,
  }: {
    copying: { current: boolean };
    setCopied: (id: string | null) => void;
    setCopyingId: (id: string | null) => void;
    setError: (message: string) => void;
    failure: string;
  },
) {
  try {
    await copyMessage(citation.text);
    setCopied(citation.id);
    setError("");
  } catch {
    setError(failure);
  } finally {
    copying.current = false;
    setCopyingId(null);
  }
}

/** Quote chips above the composer; each names the `[quoteN]` token the draft text uses. */
export function ComposerCitations({
  citations,
  disabled,
  onChange,
}: {
  citations: readonly ChatCitation[];
  disabled?: boolean;
  /** `removed` is the index taken out, so its inline token can go with it. */
  onChange: (citations: ChatCitation[], removed?: number) => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState<{
    id: string;
    comment: string;
    anchor: HTMLElement;
  } | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const copying = useRef(false);
  const commentDrafts = useRef(new Map<string, string>());
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const editingCitation = citations.find((c) => c.id === editing?.id);
  if (!citations.length) return null;
  const preview = (citation: ChatCitation, navigate = false) => {
    if (
      !highlightChatCitation(citation, {
        navigate,
        onUnavailable: () =>
          setError(t("Source changed or unavailable. The saved quote is preserved.")),
      }) &&
      navigate
    )
      setError(t("Source changed or unavailable. The saved quote is preserved."));
    else if (navigate) setError("");
  };
  return (
    <div className={styles.root} role="group" aria-label={t("Quoted reply")}>
      {citations.map((citation, index) => (
        <div
          {...surfaceAttributes({ frame: "stroke", edge: "all", radius: "card" }, styles.row)}
          key={`${citation.id}:${index}`}
        >
          <Button
            variant="ghost"
            size="sm"
            align="start"
            className={styles.source}
            aria-label={citation.comment.trim() || citation.text}
            startIcon={<BlockQuote />}
            tooltip={citation.text}
            tooltipWide
            onPointerEnter={() => preview(citation)}
            onFocus={() => preview(citation)}
            onClick={() => preview(citation, true)}
          >
            <Text
              as="span"
              size="inherit"
              tone="accent"
              {...surfaceAttributes(
                { radius: "control", tone: "accent", ring: "tone-accent" },
                styles.token,
              )}
            >
              {tokenLabel(chatCitationToken(index))}
            </Text>
            <Text size="inherit" tone="secondary" truncate className={styles.excerpt}>
              {chatCitationPreview(citation)}
            </Text>
          </Button>
          <Button
            iconOnly
            label={t("Copy quote")}
            variant="ghost"
            size="sm"
            loading={copyingId === citation.id}
            disabled={copyingId !== null && copyingId !== citation.id}
            onClick={async () => {
              if (copying.current) return;
              copying.current = true;
              setCopied(null);
              setCopyingId(citation.id);
              await copyCitation(citation, {
                copying,
                setCopied,
                setCopyingId,
                setError,
                failure: t("Could not copy quote. Please try again."),
              });
            }}
          >
            <Copy />
          </Button>
          <Button
            iconOnly
            label={t("Edit citation comment")}
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={(event) =>
              setEditing({
                id: citation.id,
                comment: commentDrafts.current.get(citation.id) ?? citation.comment,
                anchor: event.currentTarget,
              })
            }
          >
            <Pencil />
          </Button>
          <Button
            iconOnly
            label={t("Remove citation")}
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() =>
              onChange(
                citations.filter((_, i) => i !== index),
                index,
              )
            }
          >
            <X />
          </Button>
        </div>
      ))}
      <LiveText
        className={styles.feedback}
        size="micro"
        tone="secondary"
        leading="inherit"
        text={copied ? t("Quote copied") : ""}
      />
      {error ? <InlineError>{error}</InlineError> : null}
      {editing && editingCitation ? (
        <Popover
          anchor={editing.anchor}
          side="top"
          align="start"
          width={340}
          kind="dialog"
          aria-label={t("Edit citation comment")}
          onDismiss={() => setEditing(null)}
          flow="scroll"
        >
          <div className={styles.editor}>
            <Text
              as="blockquote"
              size="caption"
              leading="relaxed"
              {...surfaceAttributes({ bar: "info" }, styles.quote)}
            >
              {editingCitation.text}
            </Text>
            <TextareaField
              label={t("Comment (optional)")}
              value={editing.comment}
              minRows={2}
              maxRows={6}
              maxLength={64_000}
              fieldSize="sm"
              onChange={(event) => {
                commentDrafts.current.set(editing.id, event.currentTarget.value);
                setEditing({ ...editing, comment: event.currentTarget.value });
              }}
            />
            <div className={styles.actions}>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  commentDrafts.current.delete(editing.id);
                  setEditing(null);
                }}
              >
                {t("Cancel")}
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={disabled}
                onClick={() => {
                  onChange(
                    citations.map((c) =>
                      c.id === editing.id ? { ...c, comment: editing.comment } : c,
                    ),
                  );
                  commentDrafts.current.delete(editing.id);
                  setEditing(null);
                }}
              >
                {t("Save comment")}
              </Button>
            </div>
          </div>
        </Popover>
      ) : null}
    </div>
  );
}
