import type { Ref } from "react";
import { PasswordField as SharedPasswordField } from "../../../shared/ui/PasswordField";

type Props = {
  label: string;
  ref?: Ref<HTMLInputElement>;
  autoFocus?: boolean;
  invalid?: boolean;
  describedBy?: string;
};
/** Privacy passwords stay uncontrolled and are read only through the native ref. */
export function PasswordField({ invalid, describedBy, ...props }: Props) {
  return (
    <SharedPasswordField
      {...props}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
    />
  );
}
