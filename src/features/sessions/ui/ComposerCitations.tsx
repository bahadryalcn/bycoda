import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Popover } from "../../../shared/ui/Popover";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { InlineError } from "../../../shared/ui/InlineError";
import { CopyButton } from "../../../shared/ui/CopyButton";
import { BlockQuote, MessageSquare, Pencil, X } from "../../../shared/ui/icons";
import { copyMessage } from "../../../platform/tauri/clipboard";
import {
  chatCitationPreview,
  chatCitationToken,
  fileCommentLabel,
  type ChatCitation,
  type ComposerCitation,
} from "../model/chatCitation";
import { tokenLabel } from "../model/attachmentTokens";
import { findCitationTokens } from "../model/citationTokens";
import { highlightChatCitation } from "../model/chatCitationHighlight";
import styles from "./ComposerCitations.module.css";

/** Quote chips above the composer; each names the `[quoteN]` token the draft text uses. */
export function ComposerCitations({
  citations,
  disabled,
  onChange,
  inlineText,
  openFileComment,
  onCloseFileComment,
  drafts,
}: {
  citations: readonly ComposerCitation[];
  disabled?: boolean;
  /** `removed` is the index taken out, so its inline token can go with it. */
  onChange: (citations: ComposerCitation[], removed?: number) => void;
  inlineText?: string;
  openFileComment?: { id: string; anchor: HTMLElement };
  onCloseFileComment?: () => void;
  drafts?: { current: Map<string, string> };
}) {
  const t = useT();
  const [editing, setEditing] = useState<{
    id: string;
    comment: string;
    anchor: HTMLElement;
  } | null>(() =>
    openFileComment
      ? {
          ...openFileComment,
          comment:
            drafts?.current.get(openFileComment.id) ??
            citations.find((c) => c.id === openFileComment.id)?.comment ??
            "",
        }
      : null,
  );
  const [error, setError] = useState("");
  const localDrafts = useRef(new Map<string, string>());
  const commentDrafts = drafts ?? localDrafts;
  const editingCitation = citations.find((c) => c.id === editing?.id);
  const inlineFileComments =
    inlineText && citations.some((citation) => citation.file)
      ? new Set(
          findCitationTokens(inlineText, citations.length)
            .filter(({ index }) => citations[index]?.file)
            .map(({ index }) => index),
        )
      : undefined;
  const hasRows = !openFileComment && citations.some((_, index) => !inlineFileComments?.has(index));
  if (!hasRows && !editingCitation) return null;
  const closeEditor = () => {
    setEditing(null);
    onCloseFileComment?.();
  };
  const editComment = (citation: ComposerCitation, anchor: HTMLElement) =>
    setEditing({
      id: citation.id,
      comment: commentDrafts.current.get(citation.id) ?? citation.comment,
      anchor,
    });
  const removeCitation = (index: number) => {
    commentDrafts.current.delete(citations[index].id);
    onChange(
      citations.filter((_, i) => i !== index),
      index,
    );
  };
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
    <div className={hasRows ? styles.root : undefined} role="group" aria-label={t("Quoted reply")}>
      {hasRows
        ? citations.map(
            (citation, index) =>
              !inlineFileComments?.has(index) && (
                <div
                  {...surfaceAttributes({ frame: "card", edge: "all", radius: "card" }, styles.row)}
                  key={`${citation.id}:${index}`}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    align="start"
                    className={styles.source}
                    aria-label={
                      citation.file
                        ? fileCommentLabel(citation.file)
                        : citation.comment.trim() || citation.text
                    }
                    startIcon={citation.file ? <MessageSquare tone="feature" /> : <BlockQuote />}
                    tooltip={citation.file?.path ?? citation.text}
                    tooltipWide
                    onPointerEnter={() => !citation.file && preview(citation)}
                    onFocus={() => !citation.file && preview(citation)}
                    onClick={(event) =>
                      citation.file
                        ? editComment(citation, event.currentTarget)
                        : preview(citation, true)
                    }
                  >
                    <Text
                      as="span"
                      size="inherit"
                      tone={citation.file ? "feature" : "accent"}
                      {...surfaceAttributes(
                        { radius: "control", tone: "accent", ring: "tone-accent" },
                        styles.token,
                      )}
                    >
                      {citation.file
                        ? fileCommentLabel(citation.file)
                        : tokenLabel(chatCitationToken(index))}
                    </Text>
                    <Text size="inherit" tone="secondary" truncate className={styles.excerpt}>
                      {chatCitationPreview(citation)}
                    </Text>
                  </Button>
                  <CopyButton
                    iconOnly
                    label={t("Copy quote")}
                    copiedLabel={t("Quote copied")}
                    size="sm"
                    resetKeys={[citation.id, citation.text]}
                    onCopy={() => copyMessage(citation.text)}
                  />
                  <Button
                    iconOnly
                    label={t("Edit citation comment")}
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    onClick={(event) => editComment(citation, event.currentTarget)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    iconOnly
                    label={t("Remove citation")}
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    onClick={() => removeCitation(index)}
                  >
                    <X />
                  </Button>
                </div>
              ),
          )
        : null}
      {error ? <InlineError>{error}</InlineError> : null}
      {editing && editingCitation ? (
        <Popover
          anchor={editing.anchor}
          side="top"
          align="start"
          width={340}
          kind="dialog"
          aria-label={t("Edit citation comment")}
          variant="panel"
          onDismiss={(reason) => {
            if (
              openFileComment &&
              reason === "outside" &&
              editing.comment !== editingCitation.comment
            )
              return;
            closeEditor();
          }}
          flow="scroll"
        >
          <div className={styles.editor}>
            {editingCitation.file ? (
              <Text size="caption" tone="secondary" wrap="anywhere">
                {editingCitation.file.path}
              </Text>
            ) : null}
            <blockquote className={styles.quote}>
              <Text size="caption" leading="relaxed">
                {editingCitation.text}
              </Text>
            </blockquote>
            <TextareaField
              label={t("Comment (optional)")}
              value={editing.comment}
              minRows={2}
              maxRows={6}
              maxLength={64_000}
              fieldSize="sm"
              readOnly={disabled}
              onChange={(event) => {
                commentDrafts.current.set(editing.id, event.currentTarget.value);
                setEditing({ ...editing, comment: event.currentTarget.value });
              }}
            />
            <div className={styles.actions}>
              {openFileComment ? (
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  label={t("Remove citation")}
                  disabled={disabled}
                  onClick={() => {
                    removeCitation(citations.indexOf(editingCitation));
                    closeEditor();
                  }}
                >
                  <X />
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  commentDrafts.current.delete(editing.id);
                  closeEditor();
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
                  closeEditor();
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
