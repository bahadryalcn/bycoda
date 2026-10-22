import { Textarea as ArcTextarea, type TextareaProps } from "./arc/textarea/textarea";
import type { Ref } from "react";

export function TextareaField({
  fieldClassName,
  ...props
}: TextareaProps & { ref?: Ref<HTMLTextAreaElement> }) {
  return (
    <ArcTextarea
      {...props}
      fieldClassName={["bycoda-arc bycoda-arc-field", fieldClassName].filter(Boolean).join(" ")}
    />
  );
}
