import {
  Fragment,
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { ExternalLink, Server, SkillGroupIcon, StickyNote } from "../../../shared/ui/icons";
import { DraftToken } from "../../../shared/ui/DraftToken";
import { UserLinkIcon } from "./UserLinkIcon";
import { useLocale } from "../../../shared/i18n";
import type { ProjectFile } from "../../../platform/tauri/fs";
import { FileTypeIcon } from "../../files/public/FileTypeIcon";
import { fileMentionParts } from "../../files/public/fileMentions";
import { isNoteMentionPath } from "../../notes";
import type { Attachment } from "../model/session";
import { mcpTagParts, type McpTag } from "../model/mcpPicker";
import { userLinkRanges, type UserLinkRange } from "../model/linkPreview";
import { ComposerAttachmentHighlight } from "./ComposerAttachmentHighlight";
import { openExternal } from "../../../platform/tauri/openExternal";
import { observeResize } from "../../../shared/lib/observeResize";
import styles from "./ComposerHighlight.module.css";
import { ModeCommandText, type ModeCommandToken } from "./modeCommands";
import { workItemMentionParts } from "./ChatCitationText";
import { ComposerWorkItemToken } from "./WorkItemMentionChip";
import { ComposerSkillGroupHover, type ComposerSkillGroup } from "./ComposerSkillGroupHover";

const NO_GROUPS: readonly { invocation: string; name: string; members: readonly string[] }[] = [];

/** Overlay that paints skill, mention, MCP, attachment and quote tokens under the textarea. */
export const ComposerHighlight = memo(function ComposerHighlight({
  text,
  mode,
  names,
  skillParts,
  skillGroups = NO_GROUPS,
  mentions,
  mcpTags,
  attachments,
  citations,
  field,
  modeIndent,
  modeIconClassName,
}: {
  text: string;
  mode: ModeCommandToken | null;
  names: ReadonlySet<string>;
  /** Splits text into skill and plain runs; owned by the skills feature. */
  skillParts: (
    text: string,
    names: ReadonlySet<string>,
  ) => readonly { text: string; skill?: unknown }[];
  /** Group tokens kept whole in the draft; painted with the group's name. */
  skillGroups?: readonly { invocation: string; name: string; members: readonly string[] }[];
  mentions: ReadonlyMap<string, ProjectFile>;
  mcpTags: McpTag[];
  attachments: Attachment[];
  /** Draft citation count; their `[quoteN]` tokens are painted as pills. */
  citations: number;
  /** The textarea under the overlay; a link holding its caret shows in full. */
  field?: RefObject<HTMLTextAreaElement | null>;
  modeIndent?: string;
  modeIconClassName?: string;
}) {
  useLocale();
  const edited = useEditedLink(text, field);
  const draft = text;
  const rest = mode ? text.slice(mode.end) : text;
  const groups = new Map<string, ComposerSkillGroup>(
    skillGroups.map((group) => [group.invocation, group]),
  );
  return (
    <>
      {groups.size ? <ComposerSkillGroupHover field={field} groups={groups} /> : null}
      {mode ? (
        <ModeCommandText
          text={text}
          mode={mode}
          indent={modeIndent}
          iconClassName={modeIconClassName}
        />
      ) : null}
      <ComposerAttachmentHighlight
        text={rest}
        attachments={attachments}
        citations={citations}
        renderText={(text) => (
          <LinkRuns
            text={text}
            draft={draft}
            edited={edited}
            field={field}
            renderText={(plain) =>
              skillParts(plain, names).map((part, index) => {
                const name = part.text.slice(1);
                const group = part.skill ? groups.get(name) : undefined;
                return group ? (
                  <DraftToken
                    key={index}
                    prefix={part.text[0]}
                    icon={<SkillGroupIcon />}
                    label={`${group.name} · ${group.members.length}`}
                    className="text-skill"
                    data-composer-skill-token=""
                    data-composer-skill-group={name}
                    data-composer-skill-group-prefix={part.text[0]}
                  >
                    {name}
                  </DraftToken>
                ) : part.skill ? (
                  // The source text itself, at body size: every skill chip reads the same and
                  // stays one space from its neighbours.
                  <span
                    key={index}
                    className={`text-skill ${styles.skill}`}
                    data-composer-skill-token=""
                  >
                    {part.text}
                  </span>
                ) : (
                  // Skill tokens always end on whitespace, so each remaining run still
                  // starts on a boundary `@mention` matching can rely on.
                  <MentionRuns key={index} text={part.text} mentions={mentions} mcpTags={mcpTags} />
                );
              })
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
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- mirrors the textarea caret via DOM selection and focus listeners
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
 * the box its padding and the badge its room. A link being edited, or one that wraps
 * across lines, shows in source order: a rearranged link would break at a different
 * character than the textarea and push the caret off every character after it.
 */
function LinkRuns({
  text,
  draft,
  edited,
  field,
  renderText,
}: {
  text: string;
  /** The whole draft: any edit before a link can move it onto a line break. */
  draft: string;
  edited: string | null;
  field?: RefObject<HTMLTextAreaElement | null>;
  renderText: (text: string) => ReactNode;
}) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const range of userLinkRanges(text)) {
    parts.push(<Fragment key={`t${last}`}>{renderText(text.slice(last, range.start))}</Fragment>);
    const link = text.slice(range.start, range.end);
    parts.push(
      <LinkToken
        key={`l${range.start}`}
        link={link}
        url={range.link}
        editing={link === edited}
        draft={draft}
        field={field}
      />,
    );
    last = range.end;
  }
  parts.push(<Fragment key={`t${last}`}>{renderText(text.slice(last))}</Fragment>);
  return parts;
}

function LinkToken({
  link,
  url,
  editing,
  draft,
  field,
}: {
  link: string;
  url: UserLinkRange["link"];
  editing: boolean;
  draft: string;
  field?: RefObject<HTMLTextAreaElement | null>;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [wrapped, setWrapped] = useState(false);
  // Both orders hold the same characters, so they wrap alike; measuring whichever is
  // shown after each draft edit and field resize keeps the choice stable.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- measures the rendered link span and observes the textarea's size while mounted
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (el) setWrapped(el.getClientRects().length > 1);
    };
    measure();
    const el = field?.current;
    return el ? observeResize(el, measure) : undefined;
  }, [draft, field]);
  if (editing || wrapped) {
    return (
      <span ref={ref} className={styles.link} data-composer-link-token="">
        {link}
      </span>
    );
  }
  const scheme = link.indexOf("://") + 3;
  return (
    <>
      <span ref={ref} className={styles.link} data-composer-link-token="">
        <span className={styles.linkPrefix}>
          <span className={styles.hidden}>{link[0]}</span>
          <span className={styles.linkMark} data-composer-link-icon="" aria-hidden="true">
            <UserLinkIcon link={url} />
          </span>
        </span>
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
              openExternal(url.url).catch((error: unknown) =>
                console.error("Failed to open composer link:", error),
              )
            }
          >
            <ExternalLink className={styles.openIcon} strokeWidth={2} />
          </span>
        </span>
      </span>
      <span className={styles.hidden}>{link[scheme - 1]}</span>
    </>
  );
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
          <DraftToken
            key={index}
            prefix={part.text[0]}
            icon={<Server />}
            className="text-mention"
            data-mcp-tag={part.tag.token}
          >
            {part.text.slice(1)}
          </DraftToken>
        ) : (
          workItemMentionParts(part.text).map((run, runIndex) =>
            run.workItem ? (
              <ComposerWorkItemToken key={`${index}:${runIndex}`} token={run.text} />
            ) : (
              <FileMentionRuns key={`${index}:${runIndex}`} text={run.text} mentions={mentions} />
            ),
          )
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
          <DraftToken
            key={index}
            className="text-mention"
            prefix="@"
            icon={
              isNoteMentionPath(part.file.path) ? (
                <StickyNote />
              ) : (
                <FileTypeIcon name={part.file.name} isDir={Boolean(part.file.isDir)} size="sm" />
              )
            }
          >
            {/* The `@` keeps its width so the textarea underneath stays in
                lockstep; the file icon sits on top of it. */}
            {part.text.slice(1)}
          </DraftToken>
        ) : (
          part.text
        ),
      )}
    </>
  );
}
