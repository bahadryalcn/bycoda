import { useContext as useSocialContext } from "react";
import { SocialBusyContext as SocialLockContext } from "./socialContext";
import { useContext } from "react";
import { getLocale, t, useLocale } from "../../../shared/i18n";
import { SearchableSelect, type SearchableSelectOption } from "../../../shared/ui/SearchableSelect";
import { SocialBusyContext } from "./socialContext";

export type SocialSelectOption = SearchableSelectOption;

/** Social owns operation permissions and copy; shared UI owns selection and focus. */
export function SocialMultiSelect({
  label,
  options,
  selected,
  onChange,
  placeholder = t("Make a selection"),
  searchPlaceholder = t("Search…"),
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
  const socialLocked = useSocialContext(SocialLockContext);
  useLocale();
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
        disabled={socialLocked || disabled || busy}
        placeholder={placeholder}
        searchPlaceholder={searchPlaceholder}
        emptyLabel={options.length ? t("No options match your search.") : t("No options yet.")}
        searchLocale={getLocale()}
        loopNavigation
        showSelectedValues
        triggerProps={{ "aria-label": label }}
        selectionLabels={{
          menu: t("{p0} selection", { p0: label }),
          summary: (count) => t("{p0} selected", { p0: count }),
          missing: t("Unavailable selection"),
          remove: (name) => t("Remove {p0}", { p0: name }),
          selected: t("{p0}: selected items", { p0: label }),
          clear: t("Clear"),
          done: t("Done"),
        }}
      />
    </div>
  );
}
