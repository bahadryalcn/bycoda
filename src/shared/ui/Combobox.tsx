import { forwardRef } from "react";
import { t, useLocale } from "../i18n";
import { Combobox as ArcCombobox, type ComboboxProps } from "./arc/combobox/combobox";

export type { ComboboxProps, ComboboxOption } from "./arc/combobox/combobox";

/**
 * Editable field with a filtered suggestion list. Closed-value behaviour is the default (typed text must resolve to an option); `allowCustomValue` also accepts free text.
 * Select is for a short stable list, SearchableSelect for a long searchable list with no free entry.
 * @group fields
 * @use Free-text entry with suggestions (font names, persona or model ids).
 * @avoid Short stable list: Select. Long searchable list without free entry: SearchableSelect. Multiple free tags: TagInput.
 * @arc combobox
 */
export const Combobox = forwardRef<HTMLInputElement, ComboboxProps>(function Combobox(props, ref) {
  useLocale();
  return (
    <div className="bycoda-arc min-w-0">
      <ArcCombobox placeholder={t("Search…")} emptyMessage={t("No results")} {...props} ref={ref} />
    </div>
  );
});
