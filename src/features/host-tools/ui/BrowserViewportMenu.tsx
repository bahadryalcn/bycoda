import { useRef, useState } from "react";
import { t } from "../../../shared/i18n/technical";
import { Button } from "../../../shared/ui/Button";
import { Popover } from "../../../shared/ui/Popover";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { BrowserViewportControls } from "./BrowserViewportControls";

/** Page dimensions and preview scale in one menu labelled with the current size; resize retains Host authority. */
export function BrowserViewportMenu({
  viewport,
  disabled,
  disabledReason,
  actualSize,
  canScale,
  onActualSizeChange,
  action,
  request,
}: {
  viewport: { width: number; height: number };
  disabled: boolean;
  disabledReason?: string;
  actualSize: boolean;
  canScale: boolean;
  onActualSizeChange: (actualSize: boolean) => void;
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
        className="host-browser-viewport-trigger"
        label={t("Browser viewport")}
        selected={open}
        aria-haspopup="dialog"
        expanded={open}
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
          variant="panel"
          onDismiss={dismiss}
        >
          <SegmentedControl
            label={t("Preview")}
            size="sm"
            value={actualSize ? "actual" : "fit"}
            onValueChange={(value) => onActualSizeChange(value === "actual")}
            options={[
              { value: "fit", label: t("Fit preview"), disabled: !canScale },
              { value: "actual", label: t("Actual size"), disabled: !canScale },
            ]}
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
