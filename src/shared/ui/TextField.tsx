import { Input as ArcInput, type InputProps } from "./arc/input/input";
import type { Ref } from "react";
import styles from "./TextField.module.css";

export type TextFieldProps = InputProps & {
  ref?: Ref<HTMLInputElement>;
  /** Code, paths, ids and tokens: the shared monospace face. */
  monospace?: boolean;
  /**
   * Short numeric text without steppers (ports, counts, limits): tabular digits and a numeric
   * keyboard (`inputMode`, unless given). For min/max/step steppers use `NumberField`.
   */
  numeric?: boolean;
};

/**
 * Arc field visuals with bycoda typography, focus and appearance roles. `hideLabel` keeps `label` as the
 * accessible name for editor-like fields whose visible context is elsewhere.
 */
export function TextField({
  fieldClassName,
  monospace = false,
  numeric = false,
  className,
  inputMode,
  ...props
}: TextFieldProps) {
  return (
    <ArcInput
      {...props}
      inputMode={inputMode ?? (numeric ? "numeric" : undefined)}
      data-monospace={monospace ? "" : undefined}
      data-numeric={numeric ? "" : undefined}
      className={
        [monospace && styles.monospace, numeric && styles.numeric, className]
          .filter(Boolean)
          .join(" ") || undefined
      }
      fieldClassName={["bycoda-arc bycoda-arc-field", fieldClassName].filter(Boolean).join(" ")}
    />
  );
}
