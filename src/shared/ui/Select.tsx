import { OverflowTooltip } from "./Tooltip";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ComponentPropsWithRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { ChevronDown } from "./icons";
import { Popover } from "./Popover";
import { SelectTrigger, SelectOption, SelectValue } from "./arc/select/select";

/** The bordered field trigger, for menus that read as a select (for example multi-pick lists). */
export { SelectTrigger };
import { ComboboxChoice } from "./arc/combobox/combobox";
import { Field, fieldDescribedBy, type FieldVariant } from "./Field";
import { useKeyedActiveIndex } from "../hooks/useKeyedActiveIndex";

export type SelectChoice = {
  value: string;
  label: string;
  icon?: ReactNode;
  /** Shown but not choosable and skipped by keyboard navigation; a committed disabled value stays visible. */
  disabled?: boolean;
};

/** Next choosable index from `from` in `step` direction; wraps only when asked, otherwise stays put at an end. */
function nextEnabled(options: readonly SelectChoice[], from: number, step: 1 | -1, loop: boolean) {
  const count = options.length;
  for (let offset = 1; offset <= count; offset++) {
    const raw = from + step * offset;
    const index = loop ? ((raw % count) + count) % count : raw;
    if (index < 0 || index >= count) return from;
    if (!options[index]?.disabled) return index;
  }
  return from;
}
const firstEnabled = (options: readonly SelectChoice[]) =>
  options.findIndex((option) => !option.disabled);
const lastEnabled = (options: readonly SelectChoice[]) => {
  for (let index = options.length - 1; index >= 0; index--)
    if (!options[index]!.disabled) return index;
  return -1;
};
/** The committed option when choosable, otherwise the first choosable one (-1 when none). */
const initialActive = (options: readonly SelectChoice[], value: string) => {
  const index = options.findIndex((option) => option.value === value);
  return index >= 0 && !options[index]!.disabled ? index : firstEnabled(options);
};

/**
 * Native form owner for FormData, required validation and uncontrolled defaults.
 * @group choice
 * @use A select that must submit through a native form (FormData, required validation).
 * @avoid Everything else: Select. Long or searchable lists: SearchableSelect.
 * @replaces select
 */
export function NativeSelect({ className, ...props }: ComponentPropsWithRef<"select">) {
  return (
    <select
      {...props}
      className={["bycoda-arc bycoda-arc-select", className].filter(Boolean).join(" ")}
    />
  );
}

export type SelectProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "value" | "onChange" | "children"
> & {
  label: string;
  value: string;
  options: SelectChoice[];
  onValueChange: (value: string) => void;
  onOpen?: () => void;
  /** Opt in when the existing choice owner wraps at the first/last option. */
  loopNavigation?: boolean;
  /**
   * Keep `label` for assistive tech only. Without it, the label shows above the trigger in the
   * shared field composition. Only for toolbars and compact filters that give their own context.
   */
  hideLabel?: boolean;
  description?: string;
  error?: string;
  /** Only used with the field composition above. */
  fieldVariant?: FieldVariant;
  fieldSize?: "sm" | "md";
  ref?: Ref<HTMLButtonElement>;
};

/**
 * A small single-choice list on the shared Popover lifecycle. It shows its label above the
 * trigger and composes description and error through Field; `hideLabel` keeps the label for
 * assistive tech only.
 * @group choice
 * @use Pick one option from a short fixed list in a form or toolbar.
 * @avoid Long or searchable lists: SearchableSelect. Free entry with suggestions: Combobox. `hideLabel` only in toolbars and compact filters that supply their own context.
 */
export function Select({
  label,
  value,
  options,
  onValueChange,
  disabled = false,
  onOpen,
  loopNavigation = false,
  hideLabel = false,
  description,
  error,
  fieldVariant = "form",
  fieldSize,
  className,
  ref,
  onKeyDown,
  onClick,
  ...triggerProps
}: SelectProps) {
  const [open, setOpen] = useState(false);
  // A disabled select cannot stay open: close during render so re-enabling does not reopen it.
  if (disabled && open) setOpen(false);
  const expanded = open && !disabled;
  // Keyboard cursor restarts on open / committed-value change, not on a new `options` array.
  const [active, setActive] = useKeyedActiveIndex(`${open}:${value}`, options.length, () =>
    initialActive(options, value),
  );
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const activeOption = useRef<HTMLButtonElement>(null);
  const typeahead = useRef({ text: "", at: 0 });
  const listId = useId();
  const generatedId = useId();
  const triggerId = triggerProps.id ?? generatedId;
  const composed = !hideLabel || Boolean(description) || Boolean(error);
  const selected = options.find((option) => option.value === value);
  const activeId = options[active] != null ? `${listId}-opt-${active}` : undefined;

  useEffect(() => {
    if (!open) return;
    activeOption.current?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const pick = (next: string) => {
    if (disabled || trigger.current?.matches(":disabled")) return;
    if (options.find((option) => option.value === next)?.disabled) return;
    onValueChange(next);
    setOpen(false);
    trigger.current?.focus();
  };

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing || disabled || trigger.current?.matches(":disabled")) return;
    if (e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      const previous = typeahead.current;
      const text = (now - previous.at < 700 ? previous.text : "") + e.key.toLocaleLowerCase();
      typeahead.current = { text, at: now };
      const query = [...text].every((letter) => letter === text[0]) ? text[0]! : text;
      for (let offset = 1; offset <= options.length; offset++) {
        const index = (active + offset) % options.length;
        const option = options[index]!;
        if (!option.disabled && option.label.toLocaleLowerCase().startsWith(query)) {
          e.preventDefault();
          setActive(index);
          break;
        }
      }
      return;
    }
    if (disabled || trigger.current?.matches(":disabled")) {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => nextEnabled(options, i, 1, loopNavigation));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => nextEnabled(options, i, -1, loopNavigation));
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      setActive(firstEnabled(options));
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      setActive(lastEnabled(options));
      return;
    }
    if (e.key === "Tab") {
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const option = options[active];
      if (option) pick(option.value);
    }
  };

  const select = (
    <div ref={root} className={composed ? "relative" : "relative max-w-52"}>
      <OverflowTooltip label={expanded ? undefined : (selected?.label ?? value)}>
        <SelectTrigger
          {...triggerProps}
          id={composed ? triggerId : triggerProps.id}
          aria-invalid={error ? true : triggerProps["aria-invalid"]}
          aria-describedby={fieldDescribedBy(
            triggerId,
            { description, error },
            triggerProps["aria-describedby"],
          )}
          type={triggerProps.type ?? "button"}
          ref={(node) => {
            trigger.current = node;
            if (typeof ref === "function") return ref(node);
            if (ref) ref.current = node;
          }}
          data-field-size={fieldSize ?? (fieldVariant === "compact" ? "sm" : "md")}
          data-state={expanded ? "open" : "closed"}
          data-disabled={disabled || undefined}
          disabled={disabled}
          aria-label={triggerProps["aria-label"] ?? `${label}: ${selected?.label ?? value}`}
          aria-expanded={expanded}
          aria-haspopup="listbox"
          aria-controls={expanded ? listId : undefined}
          onKeyDown={(event) => {
            if (disabled || trigger.current?.matches(":disabled")) return;
            onKeyDown?.(event);
            if (event.defaultPrevented) return;
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            if (!open) onOpen?.();
            setOpen(true);
          }}
          onClick={(event) => {
            if (disabled || trigger.current?.matches(":disabled")) return;
            onClick?.(event);
            if (event.defaultPrevented) return;
            if (!open) onOpen?.();
            setOpen(!open);
          }}
          className={["bycoda-arc bycoda-arc-select", className].filter(Boolean).join(" ")}
        >
          <span
            className="flex min-w-0 flex-1 items-center gap-1.5"
            data-placeholder={selected || value ? undefined : ""}
          >
            {selected?.icon ? (
              <span className="grid size-4 shrink-0 place-items-center">{selected.icon}</span>
            ) : null}
            <SelectValue value={value} label={selected ? selected.label : value} />
          </span>
          <ChevronDown
            className={`bycoda-arc-select-chevron size-3.5 shrink-0 ${open ? "rotate-180" : ""}`}
            strokeWidth={1.75}
          />
        </SelectTrigger>
      </OverflowTooltip>
      {expanded ? (
        <Popover
          id={listId}
          anchor={root}
          side="bottom"
          align="start"
          width={Math.max(200, trigger.current?.getBoundingClientRect().width ?? 0)}
          maxHeight={320}
          autoFocus
          onDismiss={(reason) => {
            setOpen(false);
            if (reason === "escape") trigger.current?.focus();
          }}
          role="listbox"
          aria-label={label}
          aria-activedescendant={activeId}
          tabIndex={-1}
          onKeyDown={onMenuKey}
          className="bycoda-arc bycoda-arc-menu overflow-y-auto overscroll-contain p-1"
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const highlighted = index === active;
            return (
              <SelectOption
                key={option.value}
                ref={highlighted ? activeOption : undefined}
                type="button"
                id={`${listId}-opt-${index}`}
                role="option"
                tabIndex={-1}
                aria-selected={isSelected}
                aria-disabled={option.disabled || undefined}
                disabled={option.disabled}
                data-highlighted={highlighted || undefined}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => {
                  if (!option.disabled) setActive(index);
                }}
                onClick={() => pick(option.value)}
                className="bycoda-arc-select-option h-8"
              >
                <ComboboxChoice
                  selected={isSelected}
                  icon={option.icon}
                  label={option.label}
                  title={option.label}
                />
              </SelectOption>
            );
          })}
        </Popover>
      ) : null}
    </div>
  );
  if (!composed) return select;
  return (
    <Field
      label={label}
      hideLabel={hideLabel}
      description={description}
      error={error}
      variant={fieldVariant}
      id={triggerId}
      className={fieldVariant === "compact" ? "max-w-52" : undefined}
    >
      {select}
    </Field>
  );
}
