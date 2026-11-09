import { Fragment, memo, useEffect, useState, type ReactNode, type RefObject } from "react";
import { ExternalLink, StickyNote } from "../../../shared/ui/icons";
import { useLocale } from "../../../shared/i18n";
import type { ProjectFile } from "../../../platform/tauri/fs";
import { FileTypeIcon } from "../../files/public/FileTypeIcon";
import { fileMentionParts } from "../../files/public/fileMentions";
import { isNoteMentionPath } from "../../notes";
import type { Attachment } from "../model/session";
import { mcpTagParts, type McpTag } from "../model/mcpPicker";
import { userLinkRanges } from "../model/linkPreview";
import { ComposerAttachmentHighlight } from "./ComposerAttachmentHighlight";
import { openExternal } from "../../../platform/tauri/openExternal";
import styles from "./ComposerHighlight.module.css";
import { ModeCommandText, type ModeCommandToken } from "./modeCommands";

/** Overlay that paints skill, mention, MCP, attachment and quote tokens under the textarea. */
export const ComposerHighlight = memo(function ComposerHighlight({
  text,
  mode,
  names,
  skillParts,
  mentions,
  mcpTags,
  attachments,
  citations,
  field,
}: {
  text: string;
  mode: ModeCommandToken | null;
  names: ReadonlySet<string>;
  /** Splits text into skill and plain runs; owned by the skills feature. */
  skillParts: (
    text: string,
    names: ReadonlySet<string>,
  ) => readonly { text: string; skill?: unknown }[];
  mentions: ReadonlyMap<string, ProjectFile>;
  mcpTags: McpTag[];
  attachments: Attachment[];
  /** Draft citation count; their `[quoteN]` tokens are painted as pills. */
  citations: number;
  /** The textarea under the overlay; a link holding its caret shows in full. */
  field?: RefObject<HTMLTextAreaElement | null>;
}) {
  useLocale();
  const edited = useEditedLink(text, field);
  const rest = mode ? text.slice(mode.end) : text;
  return (
    <>
      {mode ? <ModeCommandText text={text} mode={mode} /> : null}
      <ComposerAttachmentHighlight
        text={rest}
        attachments={attachments}
        citations={citations}
        renderText={(text) => (
          <LinkRuns
            text={text}
            edited={edited}
            renderText={(plain) =>
              skillParts(plain, names).map((part, index) =>
                part.skill ? (
                  <span key={index} className="text-skill">
                    {part.text}
                  </span>
                ) : (
                  // Skill tokens always end on whitespace, so each remaining run still
                  // starts on a boundary `@mention` matching can rely on.
                  <MentionRuns key={index} text={part.text} mentions={mentions} mcpTags={mcpTags} />
                ),
              )
            }
          />
        )}
      />
      {text.endsWith("\n") ? "\n" : null}
    </>
  );
});

/** The draft text of the link holding the caret or selection, which then shows in full. */
function useEditedLink(text: string, field?: RefObject<HTMLTextAreaElement | null>) {
  const [selection, setSelection] = useState<string | null>(null);
  useEffect(() => {
    const el = field?.current;
    if (!el) return;
    const sync = () =>
      setSelection(
        document.activeElement === el ? `${el.selectionStart}:${el.selectionEnd}` : null,
      );
    document.addEventListener("selectionchange", sync);
    el.addEventListener("focus", sync);
    el.addEventListener("blur", sync);
    el.addEventListener("input", sync);
    return () => {
      document.removeEventListener("selectionchange", sync);
      el.removeEventListener("focus", sync);
      el.removeEventListener("blur", sync);
      el.removeEventListener("input", sync);
    };
  }, [field]);
  if (selection === null) return null;
  const [start, end] = selection.split(":").map(Number);
  const range = userLinkRanges(text).find((link) => start <= link.end && end >= link.start);
  return range ? text.slice(range.start, range.end) : null;
}

/**
 * Boxes each web link with an open badge at its end. The textarea underneath keeps the
 * raw text, so the box only rearranges its own characters: the hidden `https://` gives
 * the box its padding and the badge its room. A link being edited shows in full, so the
 * caret stays on the character it sits before.
 * shortcut: a link that wraps may break a few characters apart from the textarea;
 * measure the wrapped fragments if long wrapped links need exact alignment.
 */
function LinkRuns({
  text,
  edited,
  renderText,
}: {
  text: string;
  edited: string | null;
  renderText: (text: string) => ReactNode;
}) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const range of userLinkRanges(text)) {
    parts.push(<Fragment key={`t${last}`}>{renderText(text.slice(last, range.start))}</Fragment>);
    const link = text.slice(range.start, range.end);
    const scheme = link.indexOf("://") + 3;
    parts.push(
      link === edited ? (
        <span key={`l${range.start}`} className={styles.link} data-composer-link-token="">
          {link}
        </span>
      ) : (
        <Fragment key={`l${range.start}`}>
          <span className={styles.link} data-composer-link-token="">
            <span className={styles.hidden}>{link[0]}</span>
            {link.slice(scheme)}
            <span className={styles.badge}>
              {link.slice(1, scheme - 1)}
              {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- Pointer shortcut in the aria-hidden overlay; the link stays editable text in the textarea. */}
              <span
                className={styles.open}
                data-composer-link-open=""
                // Keeps focus, and so the caret, in the message box.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() =>
                  openExternal(range.link.url).catch((error: unknown) =>
                    console.error("Failed to open composer link:", error),
                  )
                }
              >
                <ExternalLink className={styles.openIcon} strokeWidth={2} />
              </span>
            </span>
          </span>
          <span className={styles.hidden}>{link[scheme - 1]}</span>
        </Fragment>
      ),
    );
    last = range.end;
  }
  parts.push(<Fragment key={`t${last}`}>{renderText(text.slice(last))}</Fragment>);
  return parts;
}

function MentionRuns({
  text,
  mentions,
  mcpTags,
}: {
  text: string;
  mentions: ReadonlyMap<string, ProjectFile>;
  mcpTags: McpTag[];
}) {
  useLocale();
  return (
    <>
      {mcpTagParts(text, mcpTags).map((part, index) =>
        part.tag ? (
          <span key={index} className="text-mention" data-mcp-tag={part.tag.token}>
            {part.text}
          </span>
        ) : (
          <FileMentionRuns key={index} text={part.text} mentions={mentions} />
        ),
      )}
    </>
  );
}

function FileMentionRuns({
  text,
  mentions,
}: {
  text: string;
  mentions: ReadonlyMap<string, ProjectFile>;
}) {
  useLocale();
  const parts = fileMentionParts(text, mentions);
  return (
    <>
      {parts.map((part, index) =>
        part.file ? (
          <span key={index} className="text-mention">
            {/* The `@` keeps its width so the textarea underneath stays in
                lockstep; the file icon sits on top of it. */}
            <span className="relative text-transparent">
              {"@"}
              {/* `indent-0`: a leading mode command indents the first line,
                  and this box would otherwise inherit that indent. */}
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 indent-0">
                {part.file && isNoteMentionPath(part.file.path) ? (
                  <StickyNote className="icon-sm" strokeWidth={1.75} />
                ) : (
                  <FileTypeIcon name={part.file.name} isDir={Boolean(part.file.isDir)} size="sm" />
                )}
              </span>
            </span>
            {part.text.slice(1)}
          </span>
        ) : (
          part.text
        ),
      )}
    </>
  );
}
