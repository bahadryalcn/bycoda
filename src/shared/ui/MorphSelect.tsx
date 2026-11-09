import { useRef, useState, type ComponentPropsWithRef, type RefObject } from "react";
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

const PANEL_WIDTH = 272;

/**
 * The open panel is wider than the closed trigger. It opens toward the start edge when that side has
 * room (a control packed at the end of a wide row) and toward the end edge when it does not (a control
 * that a narrow row left at the start), so it never opens off-screen.
 */
function panelAlignment(root: HTMLElement | null): "start" | "end" {
  if (!root) return "start";
  const bounds = root.getBoundingClientRect();
  const panel = Math.min(PANEL_WIDTH, window.innerWidth - 32);
  return bounds.left + panel <= window.innerWidth - 16 ? "start" : "end";
}

/**
 * Inline property picker: the trigger morphs into a short option list (groups, icons, opt-in local search).
 *
 * Where it stops:
 * - SearchableSelect: form/field choices with a visible label, help and validation; long, growing or
 *   remote lists; async loading/failure; multiple values; option icon/meta/group and footer actions.
 * - Picker kit (`picker/`: PickerPopover + PopoverSearchHeader + PickerList): toolbar/composer pickers
 *   with a custom trigger and rich rows (description, trailing status, disabled reason, action rows),
 *   a caller-owned search, footer actions or an embedded list.
 * - DropdownMenu: commands without a persistent selection.
 * @group choice
 * @use A value picker that must morph in place inside another popover (the model picker), where a nested Select popover would stack.
 * @avoid Form fields and settings rows: Select (short stable list) or SearchableSelect (long or filterable list).
 * @arc morph-select
 */
export function MorphSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
  readOnly = false,
  searchable = false,
  onClose,
  triggerProps,
}: {
  label: string;
  value: string;
  options: MorphSelectItem[];
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Shows the value without opening the list. Use `disabled` when the value should read as unavailable. */
  readOnly?: boolean;
  searchable?: boolean | "auto";
  onClose?: () => void;
  triggerProps?: Pick<
    ComponentPropsWithRef<"button">,
    | "ref"
    | "onMouseDown"
    | "title"
    | "aria-label"
    | "aria-invalid"
    | "aria-describedby"
    | "aria-required"
    | "onFocus"
    | "onBlur"
  >;
}) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [align, setAlign] = useState<"start" | "end">("start");
  // A disabled or read-only select cannot stay open: close during render so a later enable does not reopen it.
  if ((disabled || readOnly) && open) setOpen(false);
  const close = () => {
    setOpen(false);
    root.current
      ?.querySelector<HTMLButtonElement>('button[role="combobox"]')
      ?.focus({ preventScroll: true });
    onClose?.();
  };
  return (
    // `ms-auto` packs the control at the end of a flex row; a row may override it to keep the control at
    // the start, and `panelAlignment` then opens the panel toward the side that has room.
    <div ref={root} className="min-w-0 ms-auto">
      <ArcMorphSelect
        label={label}
        hideLabel
        value={value}
        items={options}
        onValueChange={(next) => onChange(next)}
        disabled={disabled}
        readOnly={readOnly}
        open={open}
        onOpenChange={(next) => {
          if (next) setAlign(panelAlignment(root.current));
          setOpen(next);
        }}
        searchable={searchable}
        triggerProps={triggerProps}
        onClose={(restoreFocus) => {
          if (restoreFocus) onClose?.();
        }}
        align={align}
        panelWidth={PANEL_WIDTH}
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
