import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { useLocale, useT } from "../../../shared/i18n";
import { memo, useRef, useState, type ReactNode } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { Modal } from "../../../shared/ui/Modal";
import { useHoverCard } from "../../../shared/ui/HoverCard";
import { boundedTextPreview, type UserTextPart } from "../model/userTextPreview";
import type { Attachment } from "../model/session";
import { AttachmentTokenText } from "./AttachmentTokenText";
import type { ChatCitation } from "../model/chatCitation";

function TextCard({
  part,
  messageId,
  attachments,
  citations,
  renderActions,
}: {
  part: UserTextPart;
  messageId: string;
  attachments?: Attachment[];
  citations?: readonly ChatCitation[];
  renderActions: (dismiss: () => void, showLabels?: boolean) => ReactNode;
}) {
  const t = useT();
  const locale = useLocale();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const focusTrigger = useStableCallback(() => trigger.current?.focus());
  // A rested pointer or keyboard focus previews the text; a click opens the full content.
  const hover = useHoverCard({
    side: "bottom",
    align: "start",
    width: 440,
    disabled: open,
    className: "",
  });
  const label = part.kind === "json" ? "JSON" : "Long text";
  const showFull = () => {
    hover.close();
    setOpen(true);
  };
  const dismiss = () => {
    hover.close();
    setOpen(false);
    focusTrigger();
  };
  return (
    <>
      <Button
        motion="none"
        variant="item"
        ref={trigger}
        type="button"
        aria-label={t("Show full {p0}", { p0: label.toLowerCase() })}
        aria-haspopup="dialog"
        aria-expanded={open}
        {...hover.trigger}
        onClick={showFull}
        className="my-1 block w-full min-w-0 text-left"
      >
        <Text size="caption" tone="inherit" className="flex items-center justify-between gap-6">
          <Text as="span" size="inherit" weight="medium">
            {label}
          </Text>
          <Text size="inherit" tone="secondary">
            {part.text.length.toLocaleString(locale)}
            {t(" characters")}
          </Text>
        </Text>
        <Text
          size="caption"
          tone="secondary"
          className={`mt-1 block whitespace-pre-wrap break-words   ${part.kind === "json" ? "font-mono" : "font-sans"}`}
        >
          {boundedTextPreview(part.text, 160, 2)}
        </Text>
        <Text size="caption" tone="secondary" className="mt-1.5 block">
          {t("Show full content ↗")}
        </Text>
      </Button>
      {hover.card(() => (
        <div className="p-3">
          <Text as="div" weight="medium" className="mb-2">
            {label}
            {t(" preview")}
          </Text>
          <OutputBlock
            scroll
            face={part.kind === "json" ? "mono" : "sans"}
            className="max-h-56 select-text break-words"
          >
            {boundedTextPreview(part.text)}
          </OutputBlock>
          <div className="mt-2 flex flex-wrap items-center gap-1">{renderActions(dismiss)}</div>
          <Button motion="none" variant="ghost" type="button" onClick={showFull} className="mt-2">
            {t("Show full content")}
          </Button>
        </div>
      ))}
      {open ? (
        <Modal padding="none" title={label} size="lg" onClose={dismiss}>
          <div
            {...surfaceAttributes(
              { frame: "neutral", edge: "bottom", variant: "floating" },
              "sticky top-0 z-1 flex flex-wrap items-center gap-2 px-4 py-3",
            )}
          >
            {renderActions(dismiss, true)}
          </div>
          <OutputBlock
            data-selectable-agent-response={messageId}
            size="body"
            tone="neutral"
            face={part.kind === "json" ? "mono" : "sans"}
            {...surfaceAttributes(
              { variant: "raised", radius: "card" },
              "m-4 max-h-[65dvh] overflow-auto p-4",
            )}
          >
            <AttachmentTokenText text={part.text} attachments={attachments} citations={citations} />
          </OutputBlock>
        </Modal>
      ) : null}
    </>
  );
}

export const UserTextPreview = memo(function UserTextPreview({
  parts,
  messageId,
  attachments,
  citations,
  renderActions,
}: {
  parts: UserTextPart[];
  messageId: string;
  attachments?: Attachment[];
  citations?: readonly ChatCitation[];
  renderActions: (dismiss: () => void, showLabels?: boolean) => ReactNode;
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
            attachments={attachments}
            citations={citations}
            renderActions={renderActions}
          />
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
