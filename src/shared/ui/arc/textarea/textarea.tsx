"use client";
import {
  forwardRef,
  useCallback,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import type { CSSProperties, TextareaHTMLAttributes, ReactNode } from "react";
import { FieldMessage } from "../lib/field-message";
import { fieldDescribedBy, fieldMessageIds } from "../lib/field-ids";
import { FieldControl } from "../../Field";
import styles from "./textarea.module.css";
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  description?: string;
  error?: string;
  fieldClassName?: string;
  /** `form` (default) is comfortable; `compact` is the toolbar/inline composition. */
  fieldVariant?: "form" | "compact";
  /** Keep `label` as the accessible name only (editor-like fields with their own visible context). */
  hideLabel?: boolean;
  endAdornment?: ReactNode;
  startAdornment?: ReactNode;
  appearance?: "default" | "quiet";
  /** Box density: `md` (default) is the form box; `sm` is the tighter inline/editor box. */
  fieldSize?: "sm" | "md";
  /** Smallest height in text lines. Replaces the fixed minimum box height. */
  minRows?: number;
  /** Tallest height in text lines; the field scrolls beyond it. */
  maxRows?: number;
  /** Grow and shrink with the content between `minRows` and `maxRows`; the manual resize handle is removed. */
  autosize?: boolean;
  /** Code, paths, JSON and logs: the shared monospace face. */
  monospace?: boolean;
}

/** Height that fits the content, capped by the computed `max-height` (set from `maxRows`). */
export function fitTextareaHeight(field: HTMLTextAreaElement) {
  if (!field.isConnected) return;
  const style = window.getComputedStyle(field);
  const border =
    style.boxSizing === "border-box"
      ? (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0)
      : 0;
  const cap = parseFloat(style.maxHeight);
  // Hold the parent's occupied space while measuring, so a scrolling ancestor cannot clamp its
  // scroll position during the momentary `height: auto`.
  const parent = field.parentElement;
  const parentMin = parent?.style.minHeight ?? "";
  if (parent) parent.style.minHeight = `${parent.offsetHeight}px`;
  try {
    field.style.height = "auto";
    // A hidden tab has no layout box; keep the natural height until it is shown.
    if (field.scrollHeight === 0) {
      field.style.height = "";
      return;
    }
    const natural = field.scrollHeight + border;
    const height = Number.isFinite(cap) ? Math.min(natural, cap) : natural;
    field.style.height = `${height}px`;
    field.style.overflowY = Number.isFinite(cap) && natural > cap ? "auto" : "hidden";
  } finally {
    if (parent) parent.style.minHeight = parentMin;
  }
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    label,
    description,
    error,
    id,
    className,
    fieldClassName,
    fieldVariant = "form",
    hideLabel = false,
    endAdornment,
    startAdornment,
    appearance = "default",
    fieldSize,
    minRows,
    maxRows,
    autosize = false,
    monospace = false,
    rows,
    style,
    onInput,
    ...props
  },
  ref,
) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const { description: hintId, error: errorId } = fieldMessageIds(controlId, {
    description,
    error,
  });
  const field = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => field.current!, []);
  const fit = useCallback(() => {
    if (autosize && field.current) fitTextareaHeight(field.current);
  }, [autosize]);
  // Controlled values, row bounds and font changes all re-measure before paint.
  useLayoutEffect(fit, [fit, props.value, minRows, maxRows, monospace, fieldSize]);
  useLayoutEffect(() => {
    const node = field.current;
    if (!autosize || !node || typeof ResizeObserver === "undefined") return;
    // Width changes rewrap the text; ignore the height-only changes the fit itself causes.
    let width = node.clientWidth;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (node.clientWidth === width) return;
      width = node.clientWidth;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => fitTextareaHeight(node));
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [autosize]);
  const rowStyle: CSSProperties & Record<`--${string}`, string | number> = { ...style };
  if (minRows) rowStyle["--textarea-min-rows"] = minRows;
  if (maxRows) rowStyle["--textarea-max-rows"] = maxRows;
  return (
    <div
      className={[styles.field, fieldClassName].filter(Boolean).join(" ")}
      data-variant={fieldVariant}
    >
      {!hideLabel && <label htmlFor={controlId}>{label}</label>}
      <FieldControl
        startAdornment={startAdornment}
        endAdornment={endAdornment}
        appearance={appearance}
        size={fieldSize}
      >
        <textarea
          {...props}
          rows={rows ?? minRows}
          style={rowStyle}
          data-field-size={fieldSize}
          data-min-rows={minRows ? "" : undefined}
          data-max-rows={maxRows ? "" : undefined}
          data-autosize={autosize ? "" : undefined}
          data-monospace={monospace ? "" : undefined}
          onInput={(event) => {
            onInput?.(event);
            // Uncontrolled fields have no value prop to re-measure on.
            if (props.value === undefined) fit();
          }}
          aria-label={props["aria-label"] ?? (hideLabel ? label : undefined)}
          id={controlId}
          ref={field}
          className={[styles.control, className].filter(Boolean).join(" ")}
          aria-invalid={error ? true : props["aria-invalid"]}
          aria-describedby={fieldDescribedBy(
            controlId,
            { description, error },
            props["aria-describedby"],
          )}
        />
      </FieldControl>
      <FieldMessage id={errorId} text={error} className={styles.error} alert />
      <FieldMessage id={hintId} text={description} className={styles.hint} />
    </div>
  );
});
