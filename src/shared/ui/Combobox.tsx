import { forwardRef } from "react";
import { t, useLocale } from "../i18n";
import { Combobox as ArcCombobox, type ComboboxProps } from "./arc/combobox/combobox";

export type { ComboboxProps, ComboboxOption } from "./arc/combobox/combobox";

/** Editable suggestion field; closed-value behavior is the default. */
export const Combobox = forwardRef<HTMLInputElement, ComboboxProps>(function Combobox(props, ref) {
  useLocale();
  return (
    <div className="bycoda-arc min-w-0">
      <ArcCombobox
        placeholder={t("Search…")}
        emptyMessage={t("No results")}
        {...props}
        ref={ref}
      />
    </div>
  );
});
