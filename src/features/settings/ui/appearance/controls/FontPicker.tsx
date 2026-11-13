import { useEffect } from "react";
import { t, useLocale } from "../../../../../shared/i18n";
import { SelectTrigger } from "../../../../../shared/ui/Select";
import { ChevronDown } from "../../../../../shared/ui/icons";
import { Text } from "../../../../../shared/ui/Text";
import {
  SearchableSelect,
  type SearchableSelectOption,
} from "../../../../../shared/ui/SearchableSelect";
import { preloadBundledFont } from "../../../model/fontFaceLoader";
import {
  FONT_CATEGORIES,
  fontFamilyValue,
  type FontCategory,
  type FontEntry,
  type FontTag,
} from "../../../model/fontCatalog";
import "./FontPicker.css";

export function fontCategoryLabel(category: FontCategory) {
  switch (category) {
    case "readable":
      return t("Readable");
    case "modern":
      return t("Modern");
    case "characterful":
      return t("Characterful");
    case "system":
      return t("System");
  }
}

export function fontTagLabel(tag: FontTag) {
  switch (tag) {
    case "accessible":
      return t("Accessible");
    case "ligatures":
      return t("Ligatures");
    case "italic":
      return t("Cursive italic");
  }
}

const fontStack = (family: string | undefined, monospace: boolean) =>
  family ? { fontFamily: `"${family}", ${monospace ? "monospace" : "sans-serif"}` } : undefined;

/**
 * Searchable font list grouped by category. The trigger and every row paint the font's name in
 * that font. `leading` adds a non-catalog first choice (the terminal's "Same as code font");
 * a stored `value` the catalog does not know stays selectable as its own row.
 * @use Font previews through SearchableSelect and its shared SelectTrigger.
 * @avoid Ordinary labels without font previews: SearchableSelect directly.
 * @replaces The font picker's Button-based field trigger.
 */
export function FontPicker({
  id,
  label,
  catalog,
  value,
  monospace = false,
  leading,
  onChange,
}: {
  id?: string;
  label: string;
  catalog: readonly FontEntry[];
  value: string;
  monospace?: boolean;
  leading?: { value: string; label: string; family?: string };
  onChange: (id: string) => void;
}) {
  useLocale();
  // Load preview faces when the available catalog changes.
  useEffect(() => {
    for (const font of catalog) preloadBundledFont(fontFamilyValue(catalog, font.id));
  }, [catalog]);
  const options = (() => {
    const rows: SearchableSelectOption[] = [];
    if (leading)
      rows.push({
        value: leading.value,
        label: leading.label,
        labelStyle: fontStack(leading.family, monospace),
      });
    for (const category of FONT_CATEGORIES) {
      for (const font of catalog.filter((entry) => entry.category === category)) {
        const name = font.id === "System" ? t("System default") : font.id;
        rows.push({
          value: font.id,
          label: name,
          group: fontCategoryLabel(category),
          meta: font.tag ? fontTagLabel(font.tag) : undefined,
          keywords: `${font.id} ${fontCategoryLabel(category)}`,
          labelStyle: fontStack(fontFamilyValue(catalog, font.id), monospace),
        });
      }
    }
    if (value && value !== leading?.value && !catalog.some((font) => font.id === value))
      rows.push({ value, label: value, labelStyle: fontStack(value, monospace) });
    return rows;
  })();
  return (
    <SearchableSelect
      label={label}
      hideLabel
      options={options}
      value={value}
      onChange={onChange}
      searchPlaceholder={t("Search fonts…")}
      emptyLabel={t("No matching fonts")}
      renderTrigger={({ props, selected }) => {
        const current = selected[0];
        return (
          <SelectTrigger
            {...props}
            id={id ?? props.id}
            className="bycoda-arc-select font-picker-trigger"
            data-field-size="sm"
            data-disabled={props.disabled || undefined}
          >
            <Text as="span" size="inherit" tone="inherit" truncate style={current?.labelStyle}>
              {current?.label ?? label}
            </Text>
            <ChevronDown className="bycoda-arc-select-chevron icon-sm shrink-0" />
          </SelectTrigger>
        );
      }}
    />
  );
}
