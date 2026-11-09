import { memo } from "react";
import { StickyNote } from "../../../shared/ui/icons";
import { useLocale } from "../../../shared/i18n";
import type { ProjectFile } from "../../../platform/tauri/fs";
import { FileTypeIcon } from "../../files/public/FileTypeIcon";
import { fileMentionParts } from "../../files/public/fileMentions";
import { isNoteMentionPath } from "../../notes";
import type { Attachment } from "../model/session";
import { mcpTagParts, type McpTag } from "../model/mcpPicker";
import { ComposerAttachmentHighlight } from "./ComposerAttachmentHighlight";
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
}) {
  useLocale();
  const rest = mode ? text.slice(mode.end) : text;
  return (
    <>
      {mode ? <ModeCommandText text={text} mode={mode} /> : null}
      <ComposerAttachmentHighlight
        text={rest}
        attachments={attachments}
        citations={citations}
        renderText={(text) =>
          skillParts(text, names).map((part, index) =>
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
