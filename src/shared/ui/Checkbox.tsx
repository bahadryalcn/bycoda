import { useImperativeHandle, useLayoutEffect, useRef, type ComponentPropsWithRef } from "react";

export type CheckboxProps = Omit<ComponentPropsWithRef<"input">, "type"> & {
  indeterminate?: boolean;
};

/** Native membership input keeps form validation, FormData and input refs intact. */
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
      className={["bycoda-arc bycoda-arc-checkbox", className].filter(Boolean).join(" ")}
    />
  );
}
