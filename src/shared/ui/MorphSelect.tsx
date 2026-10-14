import { useEffect, useRef, useState, type RefObject } from "react";
import {
  MorphSelect as ArcMorphSelect,
  type MorphSelectOption,
} from "./arc/morph-select/morph-select";
import { useOverlay } from "./overlay";
import { t, useLocale } from "../i18n";

function OpenOverlay({
  root,
  close,
}: {
  root: RefObject<HTMLDivElement | null>;
  close: () => void;
}) {
  useOverlay(root, false, close);
  return null;
}

/** A compact, inline property picker; large/search-driven lists use SearchableSelect. */
export function MorphSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: MorphSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  useLocale();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const close = () => {
    setOpen(false);
    root.current
      ?.querySelector<HTMLButtonElement>('button[role="combobox"]')
      ?.focus({ preventScroll: true });
  };
  return (
    <div ref={root} className="min-w-0">
      <ArcMorphSelect
        label={label}
        hideLabel
        value={value}
        items={options}
        onValueChange={onChange}
        disabled={disabled}
        open={open}
        onOpenChange={setOpen}
        searchable={false}
        align="end"
        panelWidth={272}
        className="bycoda-arc bycoda-arc-morph"
        placeholder={t("Choose an option…")}
        closeLabel={t("Close")}
        emptyLabel={t("No matching options")}
      />
      {open && <OpenOverlay root={root} close={close} />}
    </div>
  );
}
