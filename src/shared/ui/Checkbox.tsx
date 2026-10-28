import { useImperativeHandle, useLayoutEffect, useRef, type ComponentPropsWithRef } from "react";
import styles from "./Checkbox.module.css";

export type CheckboxProps = Omit<ComponentPropsWithRef<"input">, "type"> & {
  indeterminate?: boolean;
};

/**
 * Native membership input keeps form validation, FormData and input refs intact; the box,
 * check, mixed dash, invalid (`aria-invalid`) and disabled presentation are drawn over it.
 * Wrap it and its text in one `<label>` so the text is part of the hit area and dims with it.
 */
export function Checkbox({ ref, indeterminate = false, className, ...props }: CheckboxProps) {
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => input.current!);
  useLayoutEffect(() => {
    if (input.current) input.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      {...props}
      type="checkbox"
      ref={input}
      aria-checked={indeterminate ? "mixed" : props["aria-checked"]}
      className={["bycoda-arc bycoda-arc-checkbox", styles.checkbox, className]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
