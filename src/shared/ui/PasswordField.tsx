import { useId, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { Button } from "./Button";
import { Eye, EyeOff } from "./icons";
import { TextField, type TextFieldProps } from "./TextField";

export type PasswordFieldProps = Omit<TextFieldProps, "type" | "clearable" | "endAdornment"> & {
  messages?: { showPassword?: string; hidePassword?: string };
};

/** Arc password-field reveal state adapted to bycoda's native field and Button.
 * The input remains the value owner; sensitive text is never copied into state.
 */
export function PasswordField({ ref, id, messages, disabled, ...props }: PasswordFieldProps) {
  const t = useT();
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const input = useRef<HTMLInputElement>(null);
  const selection = useRef<{
    start: number | null;
    end: number | null;
    direction: "forward" | "backward" | "none" | null;
  } | null>(null);
  const [visible, setVisible] = useState(false);
  const [toggled, setToggled] = useState(false);
  useImperativeHandle(ref, () => input.current!, []);
  useLayoutEffect(() => {
    if (!selection.current || !input.current) return;
    input.current.focus({ preventScroll: true });
    input.current.setSelectionRange(
      selection.current.start,
      selection.current.end,
      selection.current.direction ?? undefined,
    );
    selection.current = null;
  }, [visible]);

  return (
    <TextField
      {...props}
      id={controlId}
      disabled={disabled}
      ref={input}
      type={visible ? "text" : "password"}
      data-reveal={toggled ? (visible ? "shown" : "hidden") : undefined}
      endAdornment={
        <Button
          type="button"
          variant="ghost"
          iconOnly
          label={
            visible
              ? (messages?.hidePassword ?? t("Hide password"))
              : (messages?.showPassword ?? t("Show password"))
          }
          disabled={disabled}
          aria-controls={controlId}
          aria-pressed={visible}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            const node = input.current;
            if (!node || node.matches(":disabled")) return;
            selection.current = {
              start: node.selectionStart,
              end: node.selectionEnd,
              direction: node.selectionDirection,
            };
            setVisible((current) => !current);
            setToggled(true);
          }}
        >
          {visible ? <EyeOff /> : <Eye />}
        </Button>
      }
    />
  );
}
