import { useEffect, useRef, useState, type ComponentPropsWithRef, type RefObject } from "react";
import {
  MorphSelect as ArcMorphSelect,
  type MorphSelectItem,
} from "./arc/morph-select/morph-select";
import { useOverlay } from "./overlay";
import { useT } from "../i18n";

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
  searchable = false,
  onClose,
  triggerProps,
}: {
  label: string;
  value: string;
  options: MorphSelectItem[];
  onChange: (value: string) => void;
  disabled?: boolean;
  searchable?: boolean | "auto";
  onClose?: () => void;
  triggerProps?: Pick<
    ComponentPropsWithRef<"button">,
    "ref" | "onMouseDown" | "title" | "aria-label" | "onFocus" | "onBlur"
  >;
}) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const restore = useRef(false);
  useEffect(() => {
    if (!open && restore.current) {
      restore.current = false;
      onClose?.();
    }
  }, [open, onClose]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const close = () => {
    restore.current = true;
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
        onValueChange={(next) => onChange(next)}
        disabled={disabled}
        open={open}
        onOpenChange={setOpen}
        searchable={searchable}
        triggerProps={triggerProps}
        onClose={(restoreFocus) => {
          restore.current = restoreFocus;
        }}
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

export type {
  MorphSelectOption,
  MorphSelectGroup,
  MorphSelectItem,
} from "./arc/morph-select/morph-select";
