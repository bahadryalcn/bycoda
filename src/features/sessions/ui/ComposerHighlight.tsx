import { memo, useEffect, useRef, type ComponentProps, type RefObject } from "react";
import {
  Server,
  SkillGroupIcon,
  SkillIcon,
  StickyNote,
  UsersRound,
} from "../../../shared/ui/icons";
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
import { ModeCommandText, type ModeCommandToken } from "./modeCommands";
import { scopedMentionParts } from "../model/composerMentionScopes";
import { ComposerWorkItemToken } from "./WorkItemMentionChip";
import { ComposerMarkdown, mayHaveComposerMarkdown } from "./ComposerMarkdown";
import {
  ComposerReferenceActions,
  type ComposerSkillDetails,
  type ComposerSkillGroup,
} from "./ComposerReferenceActions";
import { keepSkillBoundary } from "./composerTextareaEdit";

const NO_GROUPS: readonly { invocation: string; name: string; members: readonly string[] }[] = [];

/** Overlay that paints skill, mention, MCP, attachment and quote tokens under the textarea. */
export const ComposerHighlight = memo(function ComposerHighlight({
  text,
  mode,
  names,
  skillParts,
  skillGroups = NO_GROUPS,
  skillDetails,
  mentions,
  mcpTags,
  attachments,
  citations,
  field,
  onOpenFile,
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
  skillDetails?: ReadonlyMap<string, ComposerSkillDetails>;
  mentions: ReadonlyMap<string, ProjectFile>;
  mcpTags: McpTag[];
  attachments: Attachment[];
  /** Draft citation count; their `[quoteN]` tokens are painted as pills. */
  citations: number;
  /** The textarea under the overlay; a link holding its caret shows in full. */
  field?: RefObject<HTMLTextAreaElement | null>;
  onOpenFile?: (path: string) => void;
  modeIndent?: string;
  modeIconClassName?: string;
}) {
  useLocale();
  const paint = useRef<HTMLSpanElement>(null);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- The native textarea keeps its undo history when inserting at an existing skill boundary.
  useEffect(() => {
    const input = field?.current;
    if (!input || names.size === 0) return;
    const beforeInput = (event: InputEvent) =>
      keepSkillBoundary(input, event, (value, position) => {
        let offset = 0;
        for (const part of skillParts(value, names)) {
          if (offset === position) return Boolean(part.skill);
          offset += part.text.length;
          if (offset > position) break;
        }
        return false;
      });
    input.addEventListener("beforeinput", beforeInput);
    return () => input.removeEventListener("beforeinput", beforeInput);
  }, [field, names, skillParts]);
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
                  data-composer-reference="group"
                  data-reference-value={name}
                >
                  {name}
                </DraftToken>
              ) : part.skill ? (
                <DraftToken
                  key={index}
                  prefix={part.text[0]}
                  icon={<SkillIcon />}
                  label={name}
                  className="text-skill"
                  data-composer-skill-token=""
                  data-composer-reference="skill"
                  data-reference-value={name}
                >
                  {name}
                </DraftToken>
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
      <span ref={paint} className="contents">
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
      </span>
      {field ? (
        <ComposerReferenceActions
          paint={paint}
          field={field}
          attachments={attachments}
          groups={skillGroups}
          skills={skillDetails}
          onOpenFile={onOpenFile}
        />
      ) : null}
    </>
  );
});

export type ComposerReferenceContext = Pick<
  ComponentProps<typeof ComposerHighlight>,
  "names" | "skillParts" | "skillDetails" | "skillGroups" | "mentions" | "mcpTags" | "onOpenFile"
>;

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
          scopedMentionParts(part.text).map((run, runIndex) =>
            run.kind === "work-item" ? (
              <ComposerWorkItemToken key={`${index}:${runIndex}`} token={run.text} />
            ) : run.kind && !mentions.has(run.text.slice(1)) ? (
              <DraftToken
                key={`${index}:${runIndex}`}
                prefix="@"
                className="text-mention"
                icon={run.kind === "crew" ? <UsersRound /> : <StickyNote />}
                data-scoped-mention={run.kind}
              >
                {run.text.slice(1)}
              </DraftToken>
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
            data-composer-reference={part.file.isDir ? undefined : "file"}
            data-reference-value={part.file.path}
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
