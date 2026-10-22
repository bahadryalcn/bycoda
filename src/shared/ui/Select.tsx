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
import { Check, ChevronDown } from "./icons";
import { Popover } from "./Popover";
import { SelectTrigger, SelectOption, SelectValue } from "./arc/select/select";

/** Native form owner for FormData, required validation and uncontrolled defaults. */
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
  options: { value: string; label: string; icon?: ReactNode }[];
  onValueChange: (value: string) => void;
  onOpen?: () => void;
  /** Opt in when the existing choice owner wraps at the first/last option. */
  loopNavigation?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

/** Small single-choice lists using the shared native/web Popover lifecycle. */
export function Select({
  label,
  value,
  options,
  onValueChange,
  disabled = false,
  onOpen,
  loopNavigation = false,
  className,
  ref,
  onKeyDown,
  onClick,
  ...triggerProps
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const expanded = open && !disabled;
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      options.findIndex((option) => option.value === value),
    ),
  );
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const activeOption = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value);
  const activeId = options[active] != null ? `${listId}-opt-${active}` : undefined;

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
  }, [open, value, options]);

  useEffect(() => {
    if (!open) return;
    activeOption.current?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const pick = (next: string) => {
    if (disabled || trigger.current?.matches(":disabled")) return;
    onValueChange(next);
    setOpen(false);
    trigger.current?.focus();
  };

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled || trigger.current?.matches(":disabled")) {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) =>
        loopNavigation && options.length
          ? (i + 1) % options.length
          : Math.min(options.length - 1, i + 1),
      );
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) =>
        loopNavigation && options.length
          ? (i - 1 + options.length) % options.length
          : Math.max(0, i - 1),
      );
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      setActive(options.length - 1);
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

  return (
    <div ref={root} className="relative max-w-52">
      <SelectTrigger
        {...triggerProps}
        type={triggerProps.type ?? "button"}
        ref={(node) => {
          trigger.current = node;
          if (typeof ref === "function") return ref(node);
          if (ref) ref.current = node;
        }}
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
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
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
      {expanded ? (
        <Popover
          id={listId}
          anchor={root}
          side="bottom"
          align="end"
          width={280}
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
                data-highlighted={highlighted || undefined}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(option.value)}
                className="bycoda-arc-select-option flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px]"
              >
                {option.icon ? (
                  <span className="grid size-4 shrink-0 place-items-center">{option.icon}</span>
                ) : null}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {isSelected ? <Check className="size-3.5 shrink-0" strokeWidth={2.25} /> : null}
              </SelectOption>
            );
          })}
        </Popover>
      ) : null}
    </div>
  );
}
