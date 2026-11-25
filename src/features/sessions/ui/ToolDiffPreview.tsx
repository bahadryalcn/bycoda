import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { ToolPreview } from "../model/session";
import { FilePreview } from "../../files/public/FilePreview";
import { Popover } from "../../../shared/ui/Popover";
import { TOOLTIP_DELAY_MS } from "../../../shared/ui/Tooltip";

type Props = {
  preview: ToolPreview;
  label: string;
  status: "pending" | "accepted" | "rejected";
  cwd?: string;
  onOpen?: () => void;
  onOpenFile?: (path: string) => void;
  className?: string;
  children: ReactNode;
};

/** A quiet file chip that reveals the tool's own edit, independent of git. */
export function ToolDiffPreview({
  preview,
  label,
  status,
  cwd,
  onOpen,
  onOpenFile,
  className,
  children,
}: Props) {
  const t = useT();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hovered = useRef(false);
  const [open, setOpen] = useState(false);

  function clearTimer() {
    clearTimeout(timer.current);
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  function show() {
    clearTimer();
    setOpen(true);
  }

  function dismiss(restoreFocus = false) {
    clearTimer();
    // Restore before closing so focus returns to the chip the preview belongs to.
    if (restoreFocus && surface.current?.contains(document.activeElement)) {
      trigger.current?.focus();
    }
    hovered.current = false;
    setOpen(false);
  }

  function scheduleClose() {
    clearTimer();
    timer.current = setTimeout(() => {
      if (
        !hovered.current &&
        document.activeElement !== trigger.current &&
        !surface.current?.contains(document.activeElement)
      ) {
        setOpen(false);
      }
    }, 180);
  }

  const description =
    status === "pending"
      ? t("Proposed changes")
      : status === "rejected"
        ? t("Attempted changes · tool did not complete")
        : preview.contentOnly
          ? t("Written content · previous contents unavailable")
          : t("Change preview");

  return (
    <>
      <Button
        className={`w-auto ${className ?? ""}`}
        variant="item"
        motion="none"
        ref={trigger}
        type="button"
        aria-label={
          onOpen
            ? t("Open {p0}", { p0: label })
            : t(preview.contentOnly ? "Preview written content: {p1}" : "Preview changes: {p1}", {
                p1: label,
              })
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType === "touch") return;
          hovered.current = true;
          clearTimer();
          timer.current = setTimeout(() => setOpen(true), TOOLTIP_DELAY_MS);
        }}
        onPointerLeave={() => {
          hovered.current = false;
          scheduleClose();
        }}
        // Focus alone never opens the dialog: tabbing through a transcript must not
        // pop a surface open. Keyboard users open it with ArrowDown (aria-haspopup).
        onBlur={scheduleClose}
        onClick={(event) => {
          event.stopPropagation();
          if (onOpen) {
            dismiss();
            onOpen();
          } else {
            show();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (open) surface.current?.focus();
            else show();
          } else if (event.key === "Tab" && !event.shiftKey && open) {
            event.preventDefault();
            surface.current?.querySelector<HTMLElement>("button, [tabindex='0']")?.focus();
          }
        }}
      >
        {children}
      </Button>
      {open ? (
        <Popover
          ref={surface}
          anchor={trigger}
          id={id}
          kind="dialog"
          autoFocus={false}
          aria-label={`${description}: ${label}`}
          width={460}
          maxHeight={280}
          className="overflow-auto overscroll-contain"
          onDismiss={(reason) => dismiss(reason === "escape")}
          onPointerEnter={() => {
            hovered.current = true;
            clearTimer();
          }}
          onPointerLeave={() => {
            hovered.current = false;
            scheduleClose();
          }}
          // Focus moving inside the open surface only keeps it from closing.
          onFocus={clearTimer}
          onBlur={scheduleClose}
          onKeyDown={(event) => {
            if (event.key !== "Tab" || !event.shiftKey) return;
            const first = surface.current?.querySelector("button, [tabindex='0']");
            if (event.target === first || event.target === surface.current) {
              event.preventDefault();
              trigger.current?.focus();
            }
          }}
        >
          <FilePreview
            preview={preview}
            status={status}
            cwd={cwd}
            variant="popover"
            onOpenFile={
              onOpenFile
                ? (path) => {
                    dismiss();
                    onOpenFile(path);
                  }
                : undefined
            }
          />
        </Popover>
      ) : null}
    </>
  );
}
