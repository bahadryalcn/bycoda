import { useContext } from "react";
import { SearchableSelect, type SearchableSelectOption } from "../../../shared/ui/SearchableSelect";
import { SocialBusyContext } from "./socialContext";

export type SocialSelectOption = SearchableSelectOption;

/** Social owns operation permissions and copy; shared UI owns selection and focus. */
export function SocialMultiSelect({
  label,
  options,
  selected,
  onChange,
  placeholder = "Seçim yapın",
  searchPlaceholder = "Ara…",
  disabled = false,
}: {
  label: string;
  options: readonly SocialSelectOption[];
  selected: readonly string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
}) {
  const busy = useContext(SocialBusyContext);
  return (
    <div className="social-multiselect">
      <span className="social-field-label">{label}</span>
      <SearchableSelect
        multiple
        label={label}
        options={options}
        value={selected}
        onChange={onChange}
        disabled={disabled || busy}
        placeholder={placeholder}
        searchPlaceholder={searchPlaceholder}
        emptyLabel={options.length ? "Aramanıza uygun seçenek yok." : "Henüz seçenek yok."}
        searchLocale="tr"
        loopNavigation
        showSelectedValues
        triggerProps={{ "aria-label": label }}
        selectionLabels={{
          menu: `${label} seçimi`,
          summary: (count) => `${count} seçili`,
          missing: "Erişilemeyen seçim",
          remove: (name) => `${name} seçimini kaldır`,
          selected: `${label}: seçilenler`,
          clear: "Temizle",
          done: "Bitti",
        }}
      />
    </div>
  );
}
