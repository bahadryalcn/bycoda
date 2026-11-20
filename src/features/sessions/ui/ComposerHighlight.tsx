import { memo, type RefObject } from "react";
import { Server, SkillGroupIcon, StickyNote } from "../../../shared/ui/icons";
import { DraftToken } from "../../../shared/ui/DraftToken";
import { useLocale } from "../../../shared/i18n";
import type { ProjectFile } from "../../../platform/tauri/fs";
import { FileTypeIcon } from "../../files/public/FileTypeIcon";
import { fileMentionParts } from "../../files/public/fileMentions";
import { isNoteMentionPath } from "../../notes";
import type { Attachment } from "../model/session";
import { mcpTagParts, type McpTag } from "../model/mcpPicker";
import { ComposerAttachmentHighlight } from "./ComposerAttachmentHighlight";
import { LinkRuns, useEditedLink, useLinkWrap } from "./ComposerLinkRuns";
import styles from "./ComposerHighlight.module.css";
import { ModeCommandText, type ModeCommandToken } from "./modeCommands";
import { workItemMentionParts } from "./ChatCitationText";
import { ComposerWorkItemToken } from "./WorkItemMentionChip";
import { ComposerSkillGroupHover, type ComposerSkillGroup } from "./ComposerSkillGroupHover";
import { ComposerMarkdown, mayHaveComposerMarkdown } from "./ComposerMarkdown";

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
  const wrap = useLinkWrap(text, field);
  const rest = mode ? text.slice(mode.end) : text;
  const groups = new Map<string, ComposerSkillGroup>(
    skillGroups.map((group) => [group.invocation, group]),
  );
  const renderText = (text: string) => (
    <ComposerAttachmentHighlight
      text={text}
      attachments={attachments}
      citations={citations}
      renderText={(text) => (
        <LinkRuns
          text={text}
          edited={edited}
          wrap={wrap}
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
                <span
                  key={index}
                  className={`text-skill ${styles.skill}`}
                  data-composer-skill-token=""
                >
                  {part.text}
                </span>
              ) : (
                <MentionRuns key={index} text={part.text} mentions={mentions} mcpTags={mcpTags} />
              );
            })
          }
        />
      )}
    />
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
      {mayHaveComposerMarkdown(rest) ? (
        <ComposerMarkdown
          text={rest}
          offset={mode?.end ?? 0}
          field={field}
          renderText={renderText}
        />
      ) : (
        renderText(rest)
      )}
      {text.endsWith("\n") ? "\n" : null}
    </>
  );
});

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
