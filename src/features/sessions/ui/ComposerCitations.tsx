import { useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Popover } from "../../../shared/ui/Popover";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { InlineError } from "../../../shared/ui/InlineError";
import { Copy, MessageSquarePlus, Pencil, X } from "../../../shared/ui/icons";
import { copyMessage } from "../../../platform/tauri/clipboard";
import type { ChatCitation } from "../model/chatCitation";
import { highlightChatCitation } from "../model/chatCitationHighlight";
import styles from "./ComposerCitations.module.css";

export function ComposerCitations({
  citations,
  disabled,
  onChange,
}: {
  citations: readonly ChatCitation[];
  disabled?: boolean;
  onChange: (citations: ChatCitation[]) => void;
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
    <div className={styles.root}>
      <div className={styles.label}>{t("Quoted reply")}</div>
      {citations.map((citation, index) => (
        <div className={styles.row} key={`${citation.id}:${index}`}>
          <Button
            variant="ghost"
            size="sm"
            align="start"
            className={styles.source}
            startIcon={<MessageSquarePlus />}
            tooltip={citation.text}
            tooltipWide
            onPointerEnter={() => preview(citation)}
            onFocus={() => preview(citation)}
            onClick={() => preview(citation, true)}
          >
            <span className={styles.excerpt}>{citation.comment.trim() || citation.text}</span>
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
              setCopyingId(citation.id);
              try {
                await copyMessage(citation.text);
                setCopied(citation.id);
                setError("");
              } catch {
                setError(t("Could not copy quote. Please try again."));
              } finally {
                copying.current = false;
                setCopyingId(null);
              }
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
            onClick={() => onChange(citations.filter((_, i) => i !== index))}
          >
            <X />
          </Button>
        </div>
      ))}
      {copied ? (
        <span role="status" className={styles.feedback}>
          {t("Quote copied")}
        </span>
      ) : null}
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
            <blockquote className={styles.quote}>{editingCitation.text}</blockquote>
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
