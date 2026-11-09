import { Textarea as ArcTextarea, type TextareaProps } from "./arc/textarea/textarea";
import type { Ref } from "react";

export type TextareaFieldProps = TextareaProps & { ref?: Ref<HTMLTextAreaElement> };

/**
 * Multi-line form field. `minRows`/`maxRows` bound the height in lines, `autosize` grows with the
 * content between them, `fieldSize="sm"` is the tighter box and `monospace` the code face.
 * `hideLabel` keeps `label` as the accessible name; `appearance="bare"` with `fill` is an unframed editor filling its panel. Preserve domain drafts in the consumer.
 * @group fields
 * @use Multi-line plain text in a form (notes, descriptions, instructions).
 * @avoid Single line: TextField. Borderless prompt or editor surface (composer, inline editor): PromptField.
 * @replaces textarea
 * @arc textarea
 */
export function TextareaField({ fieldClassName, ...props }: TextareaFieldProps) {
  return (
    <ArcTextarea
      {...props}
      fieldClassName={["bycoda-arc bycoda-arc-field", fieldClassName].filter(Boolean).join(" ")}
    />
  );
}
