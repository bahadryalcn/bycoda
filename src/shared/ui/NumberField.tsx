import { useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useT } from "../i18n";
import { InlineAction } from "./ActionHost";
import { Minus, Plus } from "./icons";
import { TextField, type TextFieldProps } from "./TextField";
import styles from "./NumberField.module.css";

export type NumberFieldProps = Omit<TextFieldProps, "type" | "clearable"> & {
  /** Show the shared decrement/increment actions in the field's trailing slot. Defaults to true. */
  steppers?: boolean;
  messages?: { increase?: string; decrease?: string };
};

/** Native numeric editing, validity and step behavior with the shared field owner.
 * Deliberately does not coerce drafts, clamp on change or format token/percent values.
 * The steppers drive the input's own stepUp/stepDown, so min, max, step and the
 * input/change events behave exactly like the native spin buttons they replace.
 */
export function NumberField({
  ref,
  steppers = true,
  messages,
  disabled,
  readOnly,
  endAdornment,
  className,
  onChange,
  ...props
}: NumberFieldProps) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [bounds, setBounds] = useState({ atMin: false, atMax: false });
  useImperativeHandle(ref, () => input.current!, []);

  const syncBounds = () => {
    const node = input.current;
    if (!node) return;
    const current = node.valueAsNumber;
    const min = node.min === "" ? Number.NaN : Number(node.min);
    const max = node.max === "" ? Number.NaN : Number(node.max);
    const atMin = Number.isFinite(current) && Number.isFinite(min) && current <= min;
    const atMax = Number.isFinite(current) && Number.isFinite(max) && current >= max;
    setBounds((previous) =>
      previous.atMin === atMin && previous.atMax === atMax ? previous : { atMin, atMax },
    );
  };
  // The draft is owned by the input (controlled or not), so bounds are read back after every render.
  useLayoutEffect(syncBounds);

  const step = (direction: 1 | -1) => {
    const node = input.current;
    if (!node || node.disabled || node.readOnly) return;
    const before = node.value;
    try {
      if (direction > 0) node.stepUp();
      else node.stepDown();
    } catch {
      // step="any" has no step base to snap to; move by one and respect the bounds.
      const current = node.valueAsNumber;
      const min = node.min === "" ? -Infinity : Number(node.min);
      const max = node.max === "" ? Infinity : Number(node.max);
      const next = Math.min(
        max,
        Math.max(min, (Number.isFinite(current) ? current : 0) + direction),
      );
      const view = node.ownerDocument.defaultView!;
      Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, "value")!.set!.call(
        node,
        String(next),
      );
    }
    if (node.value !== before)
      // The same event typing produces, so React reports it through onChange.
      node.dispatchEvent(new node.ownerDocument.defaultView!.Event("input", { bubbles: true }));
    node.focus({ preventScroll: true });
    syncBounds();
  };

  const inactive = Boolean(disabled || readOnly);
  const stepperSlot = steppers ? (
    <span className={styles.steppers}>
      {endAdornment}
      <InlineAction
        reveal="always"
        label={messages?.decrease ?? t("Decrease value")}
        tabIndex={-1}
        disabled={inactive || bounds.atMin}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => step(-1)}
      >
        <Minus aria-hidden="true" />
      </InlineAction>
      <InlineAction
        reveal="always"
        label={messages?.increase ?? t("Increase value")}
        tabIndex={-1}
        disabled={inactive || bounds.atMax}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => step(1)}
      >
        <Plus aria-hidden="true" />
      </InlineAction>
    </span>
  ) : (
    endAdornment
  );

  return (
    <TextField
      {...props}
      ref={input}
      type="number"
      disabled={disabled}
      readOnly={readOnly}
      className={[steppers ? styles.stepped : undefined, className].filter(Boolean).join(" ")}
      endAdornment={stepperSlot}
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        onChange?.(event);
        syncBounds();
      }}
    />
  );
}
