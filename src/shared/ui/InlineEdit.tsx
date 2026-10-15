import { InlineEdit as ArcInlineEdit, type InlineEditProps } from "./arc/inline-edit/inline-edit";
import { useLocale } from "../i18n";

export function InlineEdit(props: InlineEditProps) {
  useLocale();
  return (
    <ArcInlineEdit
      {...props}
      className={["bycoda-arc bycoda-arc-inline-edit", props.className].filter(Boolean).join(" ")}
    />
  );
}
