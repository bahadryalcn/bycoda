import { useRef, useState } from "react";
import { t, useLocale } from "../../shared/i18n/technical";
import { Button } from "../../shared/ui/Button";
import { Popover, type PopoverDismissReason } from "../../shared/ui/Popover";
import { Wrench } from "../../shared/ui/icons";
import { lazySurface } from "../../shared/ui/lazySurface";
import { useDockedTools } from "./toolPaneState";
import type { ConversationTools } from "./SessionHostTools";

const SessionHostTools = lazySurface(async () => ({
  default: (await import("./SessionHostTools")).SessionHostTools,
}));

/** Status bar entry: the panel opens above the button and mounts only while open. */
export function ConversationToolsButton({ tools }: { tools: ConversationTools }) {
  useLocale();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const docked = useDockedTools(tools);
  const active = open || docked;
  const dismiss = (reason: PopoverDismissReason) => {
    setOpen(false);
    if (reason === "escape") requestAnimationFrame(() => trigger.current?.focus());
  };
  return (
    <>
      <Button
        iconOnly
        label={t("Conversation tools")}
        variant="ghost"
        motion="none"
        className="size-7"
        size="sm"
        ref={trigger}
        type="button"

        aria-label={t("Conversation tools")}
        aria-pressed={active}
        aria-expanded={open}
        aria-haspopup="dialog"
        onPointerEnter={() => void SessionHostTools.preload().catch(() => {})}
        onFocus={() => void SessionHostTools.preload().catch(() => {})}
        title={t("Conversation tools")}
        onClick={() => setOpen((value) => !value)}
      >
        <Wrench className="icon-sm" strokeWidth={1.75} aria-hidden />
      </Button>
      {open ? (
        <Popover
          anchor={trigger}
          side="top"
          align="end"
          gap={7}
          width={expanded ? Math.min(1200, window.innerWidth - 24) : 720}
          maxHeight={expanded ? window.innerHeight - 70 : 680}
          onDismiss={dismiss}
          ignore="select, option, [data-dialog-popover]"
          role="dialog"
          aria-label={t("Conversation tools")}
          className={`flex flex-col text-content ${expanded ? "h-[calc(100dvh-70px)]" : "h-[min(680px,80dvh)]"}`}
        >
          <SessionHostTools
            key={`${tools.cwd}:${tools.sessionId}`}
            {...tools}
            onExpand={() => setExpanded((value) => !value)}
            onPresented={() => setOpen(false)}
          />
        </Popover>
      ) : null}
    </>
  );
}
