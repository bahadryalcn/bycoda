import { useId, useRef, useState, type ReactNode } from "react";
import { useT } from "../../i18n";
import { LAYER } from "../../lib/layers";
import { Field } from "../Field";
import { Popover } from "../Popover";
import { Button } from "../Button";
import { Calendar, Clock } from "../icons";
import { SelectTrigger } from "../arc/select/select";
import type { PickerFieldProps } from "./types";
import styles from "./Pickers.module.css";

export function PickerShell({
  label,
  hint,
  description,
  error,
  disabled,
  readOnly,
  required,
  placeholder,
  clearable = !required,
  hideLabel,
  fieldVariant,
  fieldSize,
  id,
  name,
  className,
  shown,
  rawValue,
  timeOnly,
  onClear,
  children,
}: PickerFieldProps & {
  shown: string;
  rawValue?: string;
  timeOnly?: boolean;
  onClear?: () => void;
  /** Renders the editor; `clear` is the optional clear action for the start of its footer. */
  children: (close: () => void, clear: ReactNode) => ReactNode;
}) {
  const t = useT();
  const generated = useId();
  const popoverId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [layer, setLayer] = useState<number>(LAYER.popover);
  const canClear = !required && clearable && !!onClear;
  const close = () => {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };
  const show = () => {
    if (disabled || readOnly) return;
    setLayer(trigger.current?.closest('[role="dialog"]') ? LAYER.dialogPopover : LAYER.popover);
    setOpen(true);
  };
  return (
    <Field
      label={label}
      description={description ?? hint}
      error={error}
      hideLabel={hideLabel}
      variant={fieldVariant}
      id={id ?? generated}
      className={className}
    >
      {(control) => (
        <div className={styles.root}>
          <SelectTrigger
            {...control}
            ref={trigger}
            type="button"
            className={`bycoda-arc bycoda-arc-select ${styles.trigger}`}
            data-field-size={fieldSize ?? (fieldVariant === "compact" ? "sm" : "md")}
            data-state={open ? "open" : "closed"}
            data-disabled={disabled || undefined}
            data-readonly={readOnly || undefined}
            disabled={disabled}
            aria-label={hideLabel ? label : undefined}
            aria-readonly={readOnly || undefined}
            aria-required={required || undefined}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? popoverId : undefined}
            onClick={() => (open ? close() : show())}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                show();
              }
              if (
                !disabled &&
                !readOnly &&
                canClear &&
                (event.key === "Delete" || event.key === "Backspace")
              ) {
                event.preventDefault();
                onClear?.();
              }
            }}
          >
            <span className={styles.value} data-placeholder={!shown || undefined}>
              {shown || placeholder || t("Choose a date")}
            </span>
            {timeOnly ? (
              <Clock className="size-(--ui-icon-sm)" aria-hidden="true" />
            ) : (
              <Calendar className="size-(--ui-icon-sm)" aria-hidden="true" />
            )}
          </SelectTrigger>
          {name ? <input type="hidden" name={name} value={rawValue ?? ""} /> : null}
          {open && !disabled && !readOnly ? (
            <Popover
              anchor={trigger}
              kind="dialog"
              id={popoverId}
              aria-label={label}
              align="start"
              gap={4}
              layer={layer}
              solid
              className={styles.popover}
              onDismiss={(reason) => (reason === "escape" ? close() : setOpen(false))}
            >
              {children(
                close,
                canClear && shown ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={styles.clear}
                    onClick={() => {
                      onClear?.();
                      close();
                    }}
                  >
                    {t("Clear")}
                  </Button>
                ) : null,
              )}
            </Popover>
          ) : null}
        </div>
      )}
    </Field>
  );
}
