import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { useLocale, useT } from "../../../shared/i18n";
import { memo, useRef, useState, type ReactNode } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { Modal } from "../../../shared/ui/Modal";
import { boundedTextPreview, type UserTextPart } from "../model/userTextPreview";
import { AgentMarkdown } from "./AgentMarkdown";
import { CodeExecutionDisabled } from "./CodeExecutionContext";
import type { Attachment } from "../model/session";
import { AttachmentTokenText } from "./AttachmentTokenText";
import type { ChatCitation } from "../model/chatCitation";

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
  return (
    <CodeExecutionDisabled>
      <AgentMarkdown
        text={text}
        cwd={cwd}
        onOpenFile={onOpenFile}
        hardBreaks
        className="[&>div:first-child>[data-streamdown^=heading-]]:mt-0"
        renderProse={(prose) => (
          <AttachmentTokenText text={prose} attachments={attachments} citations={citations} />
        )}
      />
    </CodeExecutionDisabled>
  );
}

function TextCard({
  part,
  messageId,
  cwd,
  onOpenFile,
  attachments,
  citations,
  renderActions,
  markdown,
}: {
  part: UserTextPart;
  messageId: string;
  cwd?: string;
  onOpenFile?: (path: string) => void;
  attachments?: Attachment[];
  citations?: readonly ChatCitation[];
  renderActions: (dismiss: () => void, showLabels?: boolean) => ReactNode;
  markdown: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const focusTrigger = useStableCallback(() => trigger.current?.focus());
  const label = part.kind === "json" ? t("JSON") : t("Long text");
  const fullLabel = part.kind === "json" ? t("Show full JSON") : t("Show full long text");
  const excerpt = boundedTextPreview(part.text, 160, 2);
  const literalJson = part.kind === "json" && !part.text.trimStart().startsWith("```");
  const dismiss = () => {
    setOpen(false);
    focusTrigger();
  };
  return (
    <>
      <div className="relative my-1 min-w-0">
        <Button
          motion="none"
          variant="item"
          ref={trigger}
          type="button"
          aria-label={fullLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className="absolute inset-0 w-full"
        />
        <div className="pointer-events-none relative min-w-0 px-3 py-2">
          <Text size="caption" tone="inherit" className="flex items-center justify-between gap-6">
            <Text as="span" size="inherit" weight="medium">
              {label}
            </Text>
            <Text size="inherit" tone="secondary">
              {t("{p0} characters", { p0: part.text.length.toLocaleString(locale) })}
            </Text>
          </Text>
          {part.kind === "json" || !markdown ? (
            <Text
              size="caption"
              tone="secondary"
              className={`mt-1 block whitespace-pre-wrap break-words ${part.kind === "json" ? "font-mono" : "font-sans"}`}
            >
              {excerpt}
            </Text>
          ) : (
            <div inert className="mt-1 max-h-28 overflow-hidden">
              <UserMessageMarkdown text={excerpt} />
            </div>
          )}
          <Text size="caption" tone="secondary" className="mt-1.5 block">
            {t("Show full content ↗")}
          </Text>
        </div>
      </div>
      {open ? (
        <Modal padding="none" title={label} size="lg" onClose={dismiss}>
          <div
            {...surfaceAttributes(
              { frame: "pane", edge: "bottom", variant: "floating" },
              "sticky top-0 z-1 flex flex-wrap items-center gap-2 px-4 py-3",
            )}
          >
            {renderActions(dismiss, true)}
          </div>
          <div
            data-selectable-agent-response={messageId}
            {...surfaceAttributes(
              { variant: "card", radius: "card" },
              "m-4 max-h-[65dvh] overflow-auto select-text p-4",
            )}
          >
            {literalJson || !markdown ? (
              <OutputBlock size="body" tone="neutral" face={part.kind === "json" ? "mono" : "sans"}>
                <AttachmentTokenText
                  text={part.text}
                  attachments={attachments}
                  citations={citations}
                />
              </OutputBlock>
            ) : (
              <UserMessageMarkdown
                text={part.text}
                cwd={cwd}
                onOpenFile={onOpenFile}
                attachments={attachments}
                citations={citations}
              />
            )}
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
