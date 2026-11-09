import { PromptField, type PromptFieldProps } from "../../../shared/ui/PromptField";

/** The note body editor of a panel: an unframed monospace field that fills the panel and owns its focus. */
export function NoteBodyField(props: Omit<PromptFieldProps, "framed" | "fill" | "focus">) {
  return (
    <PromptField
      framed={false}
      focus="input"
      fill
      autosize={false}
      minRows={1}
      monospace
      textSize="secondary"
      inset={{ blockStart: "0.5rem", blockEnd: "0.5rem" }}
      {...props}
    />
  );
}
