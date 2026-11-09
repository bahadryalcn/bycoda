import { InlineEdit as ArcInlineEdit, type InlineEditProps } from "./arc/inline-edit/inline-edit";
import { useLocale } from "../i18n";

/**
 * Click-to-edit value that saves independently: read view, text editor, pending and error recovery.
 * @group fields
 * @use One value edited in place and saved on its own (a title, a note name).
 * @avoid A field inside a grouped form with one Save: TextField. Long text: TextareaField.
 * @arc inline-edit
 */
export function InlineEdit(props: InlineEditProps) {
  useLocale();
  return (
    <ArcInlineEdit
      {...props}
      className={["bycoda-arc bycoda-arc-inline-edit", props.className].filter(Boolean).join(" ")}
    />
  );
}
