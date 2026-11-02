import { Button } from "../../../shared/ui/Button";
import { useLocale, getLocale, useT } from "../../../shared/i18n";
import { memo, useRef, useState, type ReactNode } from "react";
import { Modal } from "../../../shared/ui/Modal";
import { useHoverCard } from "../../../shared/ui/HoverCard";
import { boundedTextPreview, type UserTextPart } from "../model/userTextPreview";
import type { Attachment } from "../model/session";
import { AttachmentTokenText } from "./AttachmentTokenText";

function TextCard({
  part,
  messageId,
  attachments,
  renderActions,
}: {
  part: UserTextPart;
  messageId: string;
  attachments?: Attachment[];
  renderActions: (dismiss: () => void, showLabels?: boolean) => ReactNode;
}) {
  const t = useT();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
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
    trigger.current?.focus();
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
        <span className="flex items-center justify-between gap-6 text-ui-caption">
          <span className="font-medium text-(--ui-text-secondary)">{label}</span>
          <span className="text-(--ui-text-secondary)">
            {part.text.length.toLocaleString(getLocale())}
            {t(" characters")}
          </span>
        </span>
        <span
          className={`mt-1 block whitespace-pre-wrap break-words text-ui-caption text-(--ui-text-secondary) ${part.kind === "json" ? "font-mono" : "font-sans"}`}
        >
          {boundedTextPreview(part.text, 160, 2)}
        </span>
        <span className="mt-1.5 block text-ui-caption text-(--ui-text-secondary)">
          {t("Show full content ↗")}
        </span>
      </Button>
      {hover.card(() => (
        <div className="p-3">
          <div className="mb-2 text-ui-caption font-medium text-(--ui-text-secondary)">
            {label}
            {t(" preview")}
          </div>
          <pre
            className={`max-h-56 select-text overflow-auto whitespace-pre-wrap break-words text-ui-caption text-(--ui-text-secondary) ${part.kind === "json" ? "font-mono" : "font-sans"}`}
          >
            {boundedTextPreview(part.text)}
          </pre>
          <div className="mt-2 flex flex-wrap items-center gap-1">{renderActions(dismiss)}</div>
          <Button motion="none" variant="ghost" type="button" onClick={showFull} className="mt-2">
            {t("Show full content")}
          </Button>
        </div>
      ))}
      {open ? (
        <Modal title={label} size="lg" onClose={dismiss}>
          <div className="sticky top-0 z-1 flex flex-wrap items-center gap-2 border-b border-(--ui-tone-neutral-border) bg-(--ui-surface-floating) px-4 py-3">
            {renderActions(dismiss, true)}
          </div>
          <pre
            data-selectable-agent-response={messageId}
            className={`m-4 max-h-[65dvh] select-text overflow-auto whitespace-pre-wrap break-words rounded-lg bg-(--ui-surface-raised) p-4 text-ui-body text-(--ui-tone-neutral-fg) ${part.kind === "json" ? "font-mono" : "font-sans"}`}
          >
            <AttachmentTokenText text={part.text} attachments={attachments} />
          </pre>
        </Modal>
      ) : null}
    </>
  );
}

export const UserTextPreview = memo(function UserTextPreview({
  parts,
  messageId,
  attachments,
  renderActions,
}: {
  parts: UserTextPart[];
  messageId: string;
  attachments?: Attachment[];
  renderActions: (dismiss: () => void, showLabels?: boolean) => ReactNode;
}) {
  useLocale();
  return (
    <div className="min-w-0 text-ui-body">
      {parts.map((part, index) =>
        part.compact ? (
          <TextCard
            key={index}
            part={part}
            messageId={messageId}
            attachments={attachments}
            renderActions={renderActions}
          />
        ) : (
          <pre
            key={index}
            data-selectable-agent-response={messageId}
            className="select-text whitespace-pre-wrap break-words font-sans"
          >
            <AttachmentTokenText text={part.text} attachments={attachments} />
          </pre>
        ),
      )}
    </div>
  );
});
