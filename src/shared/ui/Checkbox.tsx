import {
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ComponentPropsWithRef,
  type ReactNode,
} from "react";
import styles from "./Checkbox.module.css";
import { controlPaddingStyle, type ControlPadding } from "./Button";
import { optionalTextAttributes, type TextSize, type TextTone, type TextRoles } from "./Text";

export type CheckboxProps = Omit<ComponentPropsWithRef<"input">, "type" | "size"> & {
  /** Label type roles; unset preserves existing styling. */
  size?: TextSize;
  tone?: TextTone;
  /** Optional hover ink for a labelled choice; resting ink and native input behavior stay unchanged. */
  interactionTone?: "neutral";
  weight?: TextRoles["weight"];
  /** Line height role; `inherit` keeps the surrounding line height. */
  leading?: TextRoles["leading"];
  indeterminate?: boolean;
  /** Visible text. Renders the whole row as one native `<label>`; `className` then places that row. */
  label?: ReactNode;
  /** Secondary line under `label`, linked with `aria-describedby`. Needs `label`. */
  description?: ReactNode;
  /** Token padding for the labeled choice row, never the native input box. */
  padding?: ControlPadding;
  /** Card choices own their checked frame/fill; row choices only share the hover layer. Native input and label semantics stay intact. */
  appearance?: "card" | "row";
};

/**
 * Decorative membership mark inside a control that already owns selection and its accessible state.
 * @group choice
 * @use A selection button or option needing a checked mark without nesting another input.
 * @avoid Standalone membership controls and forms: Checkbox. The parent must expose selection.
 */
export function CheckboxMark({
  checked,
  size = "md",
  className,
  ...props
}: Pick<ComponentPropsWithRef<"span">, "id" | "className"> & {
  checked: boolean;
  size?: "sm" | "md";
}) {
  return (
    <span
      {...props}
      aria-hidden="true"
      data-checkbox-mark=""
      data-checked={checked ? "" : undefined}
      data-size={size}
      className={["bycoda-arc", styles.checkbox, styles.mark, className].filter(Boolean).join(" ")}
    />
  );
}

/**
 * Native membership input (keeps form validation, FormData and refs) with the box, check, mixed dash (`indeterminate`), invalid and disabled states drawn over it.
 * A checkbox with visible text uses `label` (and `description`): the row is one native label (the label content sits directly in the row unless a description stacks under it), so the text is part of the hit area and dims with it. Never wrap a Checkbox in a raw `<label>`.
 * @group choice
 * @use Independent yes/no options and multi-select, including mixed collection state.
 * @avoid Instant on/off setting: Switch. Exactly one of several: RadioGroup. Value from a list: Select.
 */
export function Checkbox({
  ref,
  indeterminate = false,
  className,
  label,
  description,
  size,
  tone,
  weight,
  leading,
  padding,
  appearance,
  interactionTone,
  ...props
}: CheckboxProps) {
  const input = useRef<HTMLInputElement>(null);
  const descriptionId = useId();
  useImperativeHandle(ref, () => input.current!);
  useLayoutEffect(() => {
    if (input.current) input.current.indeterminate = indeterminate;
  }, [indeterminate]);
  const hasLabel = label !== undefined && label !== null && label !== false;
  const hasDescription = hasLabel && description !== undefined && description !== null;
  const control = (
    <input
      {...props}
      type="checkbox"
      ref={input}
      aria-checked={indeterminate ? "mixed" : props["aria-checked"]}
      aria-describedby={
        hasDescription
          ? [props["aria-describedby"], descriptionId].filter(Boolean).join(" ")
          : props["aria-describedby"]
      }
      className={[
        "bycoda-arc bycoda-arc-checkbox",
        styles.checkbox,
        hasLabel ? styles.control : undefined,
        hasLabel ? undefined : className,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
  if (!hasLabel) return control;
  return (
    <label
      {...optionalTextAttributes(
        { size: size ?? (weight ? "inherit" : undefined), tone, weight, leading },
        [styles.row, className].filter(Boolean).join(" "),
      )}
      data-checkbox-row=""
      data-choice-appearance={appearance}
      data-interaction-tone={interactionTone}
      style={controlPaddingStyle(padding)}
      data-disabled={props.disabled ? "" : undefined}
    >
      {control}
      {hasDescription ? (
        <span className={styles.text}>
          <span className={styles.label}>{label}</span>
          <span id={descriptionId} className={styles.description}>
            {description}
          </span>
        </span>
      ) : (
        label
      )}
    </label>
  );
}
