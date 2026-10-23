import { Button } from "../../../shared/ui/Button";
import { useLocale, getLocale, useT } from "../../../shared/i18n";
import { memo, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Modal } from "../../../shared/ui/Modal";
import { Popover } from "../../../shared/ui/Popover";
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
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hovered, setHovered] = useState(false);
  const [open, setOpen] = useState(false);
  const previewId = useId();
  const label = part.kind === "json" ? "JSON" : "Long text";
  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const enter = () => {
    cancel();
    setHovered(true);
  };
  const leave = () => {
    cancel();
    timer.current = setTimeout(() => setHovered(false), 150);
  };
  const showFull = () => {
    cancel();
    setHovered(false);
    setOpen(true);
  };
  const dismiss = () => {
    cancel();
    setOpen(false);
    trigger.current?.focus();
    setHovered(false);
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
        aria-describedby={hovered && !open ? previewId : undefined}
        onMouseEnter={enter}
        onMouseLeave={leave}
        onFocus={enter}
        onBlur={leave}
        onClick={showFull}
        className="my-1 block w-full min-w-0 text-left"
      >
        <span className="flex items-center justify-between gap-6 text-xs">
          <span className="font-medium text-(--ui-text-secondary)">{label}</span>
          <span className="text-(--ui-text-secondary)">
            {part.text.length.toLocaleString(getLocale())}
            {t(" characters")}
          </span>
        </span>
        <span
          className={`mt-1 block whitespace-pre-wrap break-words text-xs text-(--ui-text-secondary) ${part.kind === "json" ? "font-mono" : "font-sans"}`}
        >
          {boundedTextPreview(part.text, 160, 2)}
        </span>
        <span className="mt-1.5 block text-xs text-(--ui-text-secondary)">
          {t("Show full content ↗")}
        </span>
      </Button>
      {hovered && !open ? (
        <Popover
          anchor={trigger}
          width={440}
          maxHeight={360}
          onDismiss={() => {
            cancel();
            setHovered(false);
          }}
          onMouseEnter={enter}
          onMouseLeave={leave}
          onFocusCapture={enter}
          onBlurCapture={leave}
        >
          <div id={previewId} className="p-3">
            <div className="mb-2 text-xs font-medium text-(--ui-text-secondary)">
              {label}
              {t(" preview")}
            </div>
            <pre
              className={`max-h-56 select-text overflow-auto whitespace-pre-wrap break-words text-xs text-(--ui-text-secondary) ${part.kind === "json" ? "font-mono" : "font-sans"}`}
            >
              {boundedTextPreview(part.text)}
            </pre>
            <div className="mt-2 flex flex-wrap items-center gap-1">{renderActions(dismiss)}</div>
            <Button motion="none" variant="ghost" type="button" onClick={showFull} className="mt-2">
              {t("Show full content")}
            </Button>
          </div>
        </Popover>
      ) : null}
      {open ? (
        <Modal title={label} size="lg" onClose={dismiss}>
          <div className="sticky top-0 z-[1] flex flex-wrap items-center gap-2 border-b border-(--ui-tone-neutral-border) bg-(--ui-surface) px-4 py-3">
            {renderActions(dismiss, true)}
          </div>
          <pre
            data-selectable-agent-response={messageId}
            className={`m-4 max-h-[65dvh] select-text overflow-auto whitespace-pre-wrap break-words rounded-lg bg-(--ui-surface-raised) p-4 text-sm text-(--ui-tone-neutral-fg) ${part.kind === "json" ? "font-mono" : "font-sans"}`}
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
    <div className="min-w-0 text-sm">
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
