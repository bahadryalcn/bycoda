import { useRef, useState } from "react";
import { t } from "../../../shared/i18n/technical";
import { Button } from "../../../shared/ui/Button";
import { PanelHeader } from "../../../shared/ui/PanelHeader";
import { Popover } from "../../../shared/ui/Popover";
import { BrowserViewportControls } from "./BrowserViewportControls";

/** Page dimensions stay discoverable beside preview controls; resize retains Host authority. */
export function BrowserViewportMenu({
  viewport,
  disabled,
  disabledReason,
  action,
  request,
}: {
  viewport: { width: number; height: number };
  disabled: boolean;
  disabledReason?: string;
  action: (work: () => Promise<unknown>) => Promise<unknown>;
  request: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const dismiss = (reason: string) => {
    setOpen(false);
    if (reason === "escape" || reason === "close") anchor.current?.focus();
  };
  return (
    <>
      <Button
        ref={anchor}
        type="button"
        size="sm"
        variant="ghost"
        label={t("Browser viewport")}
        tooltip={t("Change page dimensions to test responsive layouts.")}
        selected={open}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {viewport.width} × {viewport.height}
      </Button>
      {open ? (
        <Popover
          anchor={anchor}
          align="end"
          side="bottom"
          width={320}
          kind="dialog"
          initialFocus="input"
          aria-label={t("Browser viewport")}
          data-dialog-popover
          solid
          className="host-browser-viewport-popover"
          onDismiss={dismiss}
        >
          <PanelHeader
            title={t("Browser viewport")}
            closeLabel={t("Close")}
            onClose={() => dismiss("close")}
          />
          <BrowserViewportControls
            key={`${viewport.width}x${viewport.height}`}
            viewport={viewport}
            disabled={disabled}
            disabledReason={disabledReason}
            onResize={(next) =>
              void action(async () => {
                await request("browser.resize", next);
                await request("browser.frame");
              }).catch(() => {})
            }
          />
        </Popover>
      ) : null}
    </>
  );
}
