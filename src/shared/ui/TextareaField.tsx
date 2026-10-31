import { Textarea as ArcTextarea, type TextareaProps } from "./arc/textarea/textarea";
import type { Ref } from "react";

export type TextareaFieldProps = TextareaProps & { ref?: Ref<HTMLTextAreaElement> };

/**
 * Multi-line form field. `minRows`/`maxRows` bound the height in lines, `autosize` grows with the
 * content between them, `fieldSize="sm"` is the tighter box and `monospace` the code face.
 * `hideLabel` keeps `label` as the accessible name. Borderless prompt/editor surfaces use PromptField.
 */
export function TextareaField({ fieldClassName, ...props }: TextareaFieldProps) {
  return (
    <ArcTextarea
      {...props}
      fieldClassName={["bycoda-arc bycoda-arc-field", fieldClassName].filter(Boolean).join(" ")}
    />
  );
}
