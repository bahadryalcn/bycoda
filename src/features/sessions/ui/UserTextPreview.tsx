import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { ClampText } from "../../../shared/ui/ClampText";
import { ChevronUp, Maximize2 } from "../../../shared/ui/icons";
import { useLocale, useT } from "../../../shared/i18n";
import { memo, useContext, useRef, useState, type ReactNode } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { Modal } from "../../../shared/ui/Modal";
import { boundedTextPreview, type UserTextPart } from "../model/userTextPreview";
import { AgentMarkdown } from "./AgentMarkdown";
import { CodeExecutionDisabled } from "./CodeExecutionContext";
import type { Attachment } from "../model/session";
import { AttachmentTokenText } from "./AttachmentTokenText";
import { useRetainedDisclosure } from "./useRetainedDisclosure";
import type { ChatCitation } from "../model/chatCitation";
import { skillGroupRuns } from "../../skills/public/skillGroups";
import { TranscriptSkillGroups } from "./SkillTokenText";

export function UserMessageMarkdown({
  text,
  cwd,
  onOpenFile,
  attachments,
  citations,
}: {
  text: string;
  cwd?: string;
  onOpenFile?: (path: string) => void;
  attachments?: Attachment[];
  citations?: readonly ChatCitation[];
}) {
  const groups = useContext(TranscriptSkillGroups);
  const isProseLine = (line: string) =>
    groups.length > 0 && skillGroupRuns(line, groups).some((run) => run.group);
  return (
    <CodeExecutionDisabled>
      <AgentMarkdown
        text={text}
        cwd={cwd}
        onOpenFile={onOpenFile}
        hardBreaks
        isProseLine={isProseLine}
        className="[&>div:first-child>[data-streamdown^=heading-]]:mt-0"
        renderProse={(prose) => (
          <AttachmentTokenText text={prose} attachments={attachments} citations={citations} />
        )}
      />
    </CodeExecutionDisabled>
  );
}

type TextContentProps = {
  part: UserTextPart;
  cwd?: string;
  onOpenFile?: (path: string) => void;
  attachments?: Attachment[];
  citations?: readonly ChatCitation[];
  markdown: boolean;
};

function FullText({ part, cwd, onOpenFile, attachments, citations, markdown }: TextContentProps) {
  const literalJson = part.kind === "json" && !part.text.trimStart().startsWith("```");
  return literalJson || !markdown ? (
    <OutputBlock size="body" tone="neutral" face={part.kind === "json" ? "mono" : "sans"}>
      <AttachmentTokenText text={part.text} attachments={attachments} citations={citations} />
    </OutputBlock>
  ) : (
    <UserMessageMarkdown
      text={part.text}
      cwd={cwd}
      onOpenFile={onOpenFile}
      attachments={attachments}
      citations={citations}
    />
  );
}

/** A long part reads as a short preview: pressing it opens the text in chat, Expand in a dialog. */
function TextCard({
  partIndex,
  messageId,
  renderActions,
  ...content
}: TextContentProps & {
  partIndex: number;
  messageId: string;
  renderActions: (dismiss: () => void, showLabels?: boolean) => ReactNode;
}) {
  const { part, markdown } = content;
  const t = useT();
  const locale = useLocale();
  const expandButton = useRef<HTMLButtonElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [inlineOpen, setInlineOpen] = useRetainedDisclosure<boolean>(
    `long-text:${messageId}:${partIndex}`,
    false,
  );
  // The control that was pressed unmounts on toggle, so focus moves to the one that stays.
  const focusExpand = useStableCallback(() => expandButton.current?.focus());
  const label = part.kind === "json" ? t("JSON") : t("Long text");
  const fullLabel = part.kind === "json" ? t("Show full JSON") : t("Show full long text");
  const characters = t("{p0} characters", { p0: part.text.length.toLocaleString(locale) });
  const excerpt = boundedTextPreview(part.text, 800, 8);
  const json = part.kind === "json";
  const toggleInline = (next: boolean) => {
    setInlineOpen(next);
    focusExpand();
  };
  const dismiss = () => {
    setDialogOpen(false);
    focusExpand();
  };
  return (
    <>
      {/* Reaches over the bubble's padding so a press anywhere on the message opens it. */}
      <div className="relative -mx-(--message-bubble-inset-x) -my-(--message-bubble-inset-y) min-w-0">
        {inlineOpen ? null : (
          <Button
            motion="none"
            variant="item"
            type="button"
            aria-label={fullLabel}
            aria-expanded={false}
            onClick={() => toggleInline(true)}
            className="absolute inset-0 w-full"
          />
        )}
        <Button
          ref={expandButton}
          motion="none"
          iconOnly
          size="sm"
          variant="ghost"
          type="button"
          label={t("Expand")}
          aria-haspopup="dialog"
          aria-expanded={dialogOpen}
          onClick={() => setDialogOpen(true)}
          className="absolute end-1 top-1 z-1"
        >
          <Maximize2 className="icon-sm" aria-hidden />
        </Button>
        <div
          className={`relative min-w-0 py-(--message-bubble-inset-y) ps-(--message-bubble-inset-x) pe-8 ${inlineOpen ? "" : "pointer-events-none"}`}
        >
          {inlineOpen ? (
            <div data-selectable-agent-response={messageId} className="select-text">
              <FullText {...content} />
            </div>
          ) : json || !markdown ? (
            <ClampText
              expandable={false}
              lines={4}
              size={json ? "caption" : "inherit"}
              tone={json ? "secondary" : "inherit"}
              className={`whitespace-pre-wrap break-words ${json ? "font-mono" : "font-sans"}`}
            >
              {excerpt}
            </ClampText>
          ) : (
            <ClampText expandable={false} lines={4} inert>
              <UserMessageMarkdown text={excerpt} />
            </ClampText>
          )}
        </div>
        {inlineOpen ? (
          <div className="flex justify-end pe-1 pb-1">
            <Button
              motion="none"
              size="sm"
              variant="secondary"
              type="button"
              startIcon={<ChevronUp className="icon-sm" aria-hidden />}
              onClick={() => toggleInline(false)}
            >
              {t("Show less")}
            </Button>
          </div>
        ) : null}
      </div>
      {dialogOpen ? (
        <Modal
          title={label}
          description={characters}
          size="lg"
          frosted
          footerAlign="start"
          footer={renderActions(dismiss, true)}
          onClose={dismiss}
        >
          <div data-selectable-agent-response={messageId} className="select-text">
            <FullText {...content} />
          </div>
        </Modal>
      ) : null}
    </>
  );
}

export const UserTextPreview = memo(function UserTextPreview({
  parts,
  messageId,
  cwd,
  onOpenFile,
  attachments,
  citations,
  renderActions,
  markdown = false,
}: {
  parts: UserTextPart[];
  messageId: string;
  cwd?: string;
  onOpenFile?: (path: string) => void;
  attachments?: Attachment[];
  citations?: readonly ChatCitation[];
  renderActions: (dismiss: () => void, showLabels?: boolean) => ReactNode;
  markdown?: boolean;
}) {
  useLocale();
  return (
    <Text as="div" size="body" tone="inherit" className="min-w-0">
      {parts.map((part, index) =>
        part.compact ? (
          <TextCard
            key={index}
            partIndex={index}
            part={part}
            messageId={messageId}
            cwd={cwd}
            onOpenFile={onOpenFile}
            attachments={attachments}
            citations={citations}
            renderActions={renderActions}
            markdown={markdown}
          />
        ) : markdown ? (
          <div key={index} data-selectable-agent-response={messageId} className="select-text">
            <UserMessageMarkdown
              text={part.text}
              cwd={cwd}
              onOpenFile={onOpenFile}
              attachments={attachments}
              citations={citations}
            />
          </div>
        ) : (
          <pre
            key={index}
            data-selectable-agent-response={messageId}
            className="select-text whitespace-pre-wrap break-words font-sans"
          >
            <AttachmentTokenText text={part.text} attachments={attachments} citations={citations} />
          </pre>
        ),
      )}
    </Text>
  );
});
