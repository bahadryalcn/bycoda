import { Input as ArcInput, type InputProps } from "./arc/input/input";
import type { Ref } from "react";
import { optionalTextAttributes, type TextRoles } from "./Text";
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
  /** Size of the typed text: `secondary` 13px, `body` 14px, ...; unset keeps the field's own size. */
  textSize?: TextRoles["size"];
  /** Line height of the typed text; unset keeps the field's own. */
  leading?: TextRoles["leading"];
  /** Typed text weight; unset preserves field defaults. */
  weight?: TextRoles["weight"];
};

/**
 * Single-line text input with label, hint and error built in; native input props and ref pass through.
 * `hideLabel` keeps `label` as the accessible name when visible context is elsewhere; `monospace` for code,
 * paths and ids; `numeric` for short digit-only text; `textSize` and `leading` set the typed text's
 * type role (the size prop of the box is `fieldSize`).
 * @group fields
 * @use Any single-line text, URL, email, search or id entry.
 * @avoid Multi-line: TextareaField. Secrets: PasswordField. Number with min/max/step: NumberField. Borderless prompt or editor surface: PromptField. Fixed choices: Select.
 * @replaces input
 * @arc input
 */
export function TextField({
  fieldClassName,
  monospace = false,
  numeric = false,
  textSize,
  leading,
  weight,
  className,
  inputMode,
  ...props
}: TextFieldProps) {
  const joined = [monospace && styles.monospace, numeric && styles.numeric, className]
    .filter(Boolean)
    .join(" ");
  return (
    <ArcInput
      {...props}
      {...optionalTextAttributes(
        { size: textSize, leading, weight },
        joined === "" ? undefined : joined,
      )}
      inputMode={inputMode ?? (numeric ? "numeric" : undefined)}
      data-monospace={monospace ? "" : undefined}
      data-numeric={numeric ? "" : undefined}
      fieldClassName={["bycoda-arc bycoda-arc-field", fieldClassName].filter(Boolean).join(" ")}
    />
  );
}
