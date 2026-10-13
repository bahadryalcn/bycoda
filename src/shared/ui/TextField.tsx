import { Input as ArcInput, type InputProps } from "./arc/input/input";
import type { Ref } from "react";

export type TextFieldProps = InputProps & { ref?: Ref<HTMLInputElement> };

/** Arc field visuals with bycoda typography, focus and appearance roles. */
export function TextField({ fieldClassName, ...props }: TextFieldProps) {
  return (
    <ArcInput
      {...props}
      fieldClassName={["bycoda-arc bycoda-arc-field", fieldClassName].filter(Boolean).join(" ")}
    />
  );
}
