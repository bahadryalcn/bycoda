import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import { ChevronDown } from "../../../shared/ui/icons";
import { useLayoutEffect, useRef, useState } from "react";
import { RUNTIME_MODE_HINT, RUNTIME_MODE_LABEL, type RuntimeMode } from "../model/session";
import { PickerList, PickerPopover } from "../../../shared/ui/picker";
import { RUNTIME_MODE_ICONS, runtimeModeOptions } from "./runtimeModeOptions";

type Props = {
  value: RuntimeMode;
  onChange: (mode: RuntimeMode) => void;
  onClose?: () => void;
  busy?: boolean;
  /** Modes the harness cannot honour, with why. They show, but cannot be picked. */
  unavailable?: Partial<Record<RuntimeMode, string>>;
};

const MENU_WIDTH = 288;

export function AccessPicker({ value, onChange, onClose, busy = false, unavailable }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const Icon = RUNTIME_MODE_ICONS[value];

  const dismiss = (restore: boolean) => {
    setOpen(false);
    if (restore) onCloseRef.current?.();
  };

  return (
    <div ref={root} className="relative" data-usage-guide="access-mode">
      <Button
        size="sm"
        className="max-w-52"
        variant="ghost"
        type="button"
        data-access-picker-trigger
        tooltip={`${RUNTIME_MODE_HINT[value]}${busy ? " Changes apply to the next turn." : ""}`}
        aria-label={RUNTIME_MODE_LABEL[value]}
        aria-expanded={open}
        aria-haspopup="dialog"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (open) {
            dismiss(true);
            return;
          }
          setOpen(true);
        }}
      >
        <Icon
          className="icon-sm shrink-0"
          tone={value === "full-access" ? "warning" : undefined}
          strokeWidth={1.75}
        />
        <Text size="inherit" tone="inherit" truncate className="min-w-0">
          {RUNTIME_MODE_LABEL[value]}
        </Text>
        <ChevronDown
          className={`icon-xs shrink-0 ${open ? "rotate-180" : ""}`}
          tone="secondary"
          strokeWidth={1.75}
        />
      </Button>
      <PickerPopover
        open={open}
        anchor={root}
        side="top"
        width={MENU_WIDTH}
        label={t("Access")}
        data-access-picker=""
        onDismiss={(reason) => dismiss(reason === "escape")}
        footer={
          busy ? (
            <Text
              as="p"
              size="micro"
              weight="regular"
              className="border-bs border-(--ui-tone-neutral-border) px-3 py-2"
            >
              {t("Access changes apply to the next turn. Stop and resend to apply them now.")}
            </Text>
          ) : null
        }
      >
        <PickerList
          label={t("Access")}
          autoFocus
          options={runtimeModeOptions(unavailable)}
          value={value}
          onChange={(mode: string) => {
            onChange(mode as RuntimeMode);
            dismiss(true);
          }}
        />
      </PickerPopover>
    </div>
  );
}
