import { Textarea as ArcTextarea, type TextareaProps } from "./arc/textarea/textarea";
import type { Ref } from "react";
import { optionalTextAttributes, type TextRoles } from "./Text";

export type TextareaFieldProps = TextareaProps & {
  ref?: Ref<HTMLTextAreaElement>;
  /** Size of the typed text: `secondary` 13px, `body` 14px, ...; unset keeps the field's own size. */
  textSize?: TextRoles["size"];
  /** Line height of the typed text; unset keeps the field's own. */
  leading?: TextRoles["leading"];
};

/**
 * Multi-line form field. `minRows`/`maxRows` bound the height in lines, `autosize` grows with the
 * content between them, `fieldSize="sm"` is the tighter box and `monospace` the code face.
 * `textSize` and `leading` set the type role of the typed text. `hideLabel` keeps `label` as the accessible name; `appearance="bare"` with `fill` is an unframed editor filling its panel. Preserve domain drafts in the consumer.
 * @group fields
 * @use Multi-line plain text in a form (notes, descriptions, instructions).
 * @avoid Single line: TextField. Borderless prompt or editor surface (composer, inline editor): PromptField.
 * @replaces textarea
 * @arc textarea
 */
export function TextareaField({
  fieldClassName,
  textSize,
  leading,
  className,
  ...props
}: TextareaFieldProps) {
  return (
    <ArcTextarea
      {...props}
      {...optionalTextAttributes({ size: textSize, leading }, className)}
      fieldClassName={["bycoda-arc bycoda-arc-field", fieldClassName].filter(Boolean).join(" ")}
    />
  );
}
