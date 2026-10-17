import {
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type ReactNode,
} from "react";
import { animate, motion, useReducedMotion } from "motion/react";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./radio-group.module.css";

export interface RadioOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  disabledReason?: ReactNode;
}

export type RadioGroupProps = Omit<
  ComponentPropsWithRef<"input">,
  "type" | "value" | "defaultValue" | "checked" | "defaultChecked" | "children" | "size"
> & {
  label: ReactNode;
  options: readonly RadioOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  compact?: boolean;
};

// Adapted from Arc's free radio-group: one measured highlight follows native rows.
function place(
  highlight: HTMLElement | null,
  row: HTMLElement | undefined,
  at: { current: string },
  glide: boolean,
) {
  const next = row ? `${row.offsetTop} ${row.offsetHeight}` : "";
  if (!highlight || next === at.current) return;
  const visible = at.current !== "";
  at.current = next;
  if (!row) {
    animate(highlight, { opacity: 0 }, { duration: 0 });
    return;
  }
  const target = { y: row.offsetTop, height: row.offsetHeight, opacity: 1 };
  if (glide && visible) {
    animate(highlight, target, { ...motionTokens.spring.morph, opacity: { duration: 0 } });
    return;
  }
  Object.assign(highlight.style, {
    transform: `translateY(${target.y}px)`,
    height: `${target.height}px`,
    opacity: "1",
  });
  animate(highlight, target, { duration: 0 });
}

/** Real radios own validity, keyboard navigation, refs, form data and resets. */
export function RadioGroup({
  label,
  options,
  value,
  defaultValue,
  onValueChange,
  compact,
  name,
  id,
  ref,
  className,
  disabled,
  onChange,
  ...inputProps
}: RadioGroupProps) {
  const uid = useId();
  const groupId = id ?? uid;
  const [selection, setSelection] = useState(defaultValue);
  const reduced = useReducedMotion();
  const list = useRef<HTMLDivElement>(null);
  const highlight = useRef<HTMLSpanElement>(null);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const rows = useRef<(HTMLLabelElement | null)[]>([]);
  const shown = useRef<number | null>(null);
  const at = useRef("");
  const selected = options.findIndex((option) => option.value === (value ?? selection));
  const focusIndex =
    selected >= 0
      ? selected
      : Math.max(
          0,
          options.findIndex((option) => !option.disabled),
        );
  useImperativeHandle(ref, () => inputs.current[focusIndex]!, [focusIndex]);
  useLayoutEffect(() => {
    place(
      highlight.current,
      rows.current[selected] ?? undefined,
      at,
      shown.current !== null && shown.current !== selected && !reduced,
    );
    shown.current = selected;
    list.current?.setAttribute("data-ready", "");
  }, [selected, reduced]);
  useEffect(() => {
    const node = list.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() =>
      place(highlight.current, rows.current[shown.current ?? -1] ?? undefined, at, false),
    );
    observer.observe(node);
    rows.current.forEach((row) => row && observer.observe(row));
    return () => observer.disconnect();
  }, [options.length]);
  useEffect(() => {
    const form = inputs.current[0]?.form;
    if (!form) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reset = (event: Event) => {
      clearTimeout(timer);
      // A task boundary follows the browser's reset default action in real browsers too.
      timer = setTimeout(() => {
        if (event.defaultPrevented || !inputs.current[0]?.isConnected) return;
        if (value !== undefined)
          inputs.current.forEach((input) => {
            if (input) input.checked = input.value === value;
          });
        setSelection(inputs.current.find((input) => input?.checked)?.value);
      }, 0);
    };
    form.addEventListener("reset", reset);
    return () => {
      clearTimeout(timer);
      form.removeEventListener("reset", reset);
    };
  }, [inputProps.form, value, options.length]);

  return (
    <fieldset
      className={["bycoda-arc", styles.group, className].filter(Boolean).join(" ")}
      disabled={disabled}
      data-compact={compact || undefined}
    >
      <legend id={`${groupId}-legend`}>{label}</legend>
      <div ref={list} className={styles.options}>
        <span ref={highlight} className={styles.highlight} aria-hidden="true" />
        {options.map((option, index) => {
          const checked = index === selected;
          const description =
            option.disabled && option.disabledReason ? option.disabledReason : option.description;
          const descriptionId = `${groupId}-${index}-description`;
          const labelId = `${groupId}-${index}-label`;
          return (
            <label
              className={styles.option}
              key={option.value}
              ref={(node) => {
                rows.current[index] = node;
              }}
            >
              <input
                {...inputProps}
                id={index === 0 ? groupId : `${groupId}-${index}`}
                ref={(node) => {
                  inputs.current[index] = node;
                }}
                type="radio"
                name={name ?? uid}
                value={option.value}
                checked={value === undefined ? undefined : checked}
                defaultChecked={value === undefined ? defaultValue === option.value : undefined}
                disabled={disabled || option.disabled}
                aria-labelledby={
                  inputProps["aria-labelledby"] ?? (inputProps["aria-label"] ? undefined : labelId)
                }
                aria-describedby={
                  [inputProps["aria-describedby"], description ? descriptionId : undefined]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                onChange={(event) => {
                  setSelection(event.currentTarget.value);
                  onChange?.(event);
                  onValueChange?.(event.currentTarget.value);
                }}
              />
              <span className={styles.mark} aria-hidden="true">
                <motion.span
                  className={styles.dot}
                  initial={false}
                  animate={checked ? { scale: 1, opacity: 1 } : { scale: 0.4, opacity: 0 }}
                  transition={
                    reduced
                      ? { duration: 0 }
                      : {
                          ...motionTokens.spring.snappy,
                          opacity: {
                            duration: checked
                              ? motionTokens.duration.fast
                              : motionTokens.duration.instant,
                          },
                        }
                  }
                />
              </span>
              <span className={styles.copy}>
                <strong id={labelId}>{option.label}</strong>
                {description && <small id={descriptionId}>{description}</small>}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
