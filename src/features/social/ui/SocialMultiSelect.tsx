import { SearchInput } from "../../../shared/ui/SearchInput";
import {
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Popover } from "../../../shared/ui/Popover";
import { Check, ChevronDown, Search, X } from "../../../shared/ui/icons";
import { isImeComposition } from "../../../shared/lib/keyboard";
import { SocialBusyContext } from "./socialContext";

export type SocialSelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

/** Search and select without expanding a project's entire registry into a form. */
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
  const blocked = disabled || busy;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [width, setWidth] = useState<number>();
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const activeOption = useRef<HTMLButtonElement>(null);
  const uid = useId();
  const listId = `${uid}-list`;
  const chosen = new Set(selected);
  const lookup = useMemo(() => new Map(options.map((option) => [option.value, option])), [options]);
  const normalized = query.trim().toLocaleLowerCase("tr");
  const filtered = options.filter((option) =>
    `${option.label} ${option.description ?? ""}`.toLocaleLowerCase("tr").includes(normalized),
  );
  const activeId = filtered[active] ? `${uid}-option-${active}` : undefined;
  const close = (restoreFocus = false) => {
    setOpen(false);
    setQuery("");
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  };
  const toggle = (option: SocialSelectOption) => {
    if (blocked || option.disabled) return;
    onChange(
      chosen.has(option.value)
        ? selected.filter((value) => value !== option.value)
        : [...selected, option.value],
    );
  };
  const openMenu = () => {
    if (blocked || trigger.current?.matches(":disabled")) return;
    setWidth(Math.max(280, trigger.current?.getBoundingClientRect().width ?? 0));
    setQuery("");
    setActive(0);
    setOpen(true);
  };
  useEffect(() => {
    if (blocked) setOpen(false);
  }, [blocked]);
  useEffect(() => {
    setActive((index) => Math.min(index, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => search.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !activeOption.current || !list.current) return;
    const row = activeOption.current.getBoundingClientRect();
    const bounds = list.current.getBoundingClientRect();
    if (row.top < bounds.top) list.current.scrollTop -= bounds.top - row.top;
    else if (row.bottom > bounds.bottom) list.current.scrollTop += row.bottom - bounds.bottom;
  }, [active, query, open]);
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isImeComposition(event.nativeEvent)) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) =>
        filtered.length ? (index + step + filtered.length) % filtered.length : 0,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (filtered[active]) toggle(filtered[active]);
    }
  };
  return (
    <div className="social-multiselect">
      <span id={`${uid}-label`} className="social-field-label">
        {label}
      </span>
      <button
        ref={trigger}
        type="button"
        className="social-select-trigger"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${uid}-menu` : undefined}
        disabled={blocked}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            openMenu();
          }
        }}
      >
        <span className={selected.length ? undefined : "social-muted"}>
          {selected.length ? `${selected.length} seçili` : placeholder}
        </span>
        <ChevronDown aria-hidden="true" />
      </button>
      {selected.length ? (
        <div className="social-selection-tags" aria-label={`${label}: seçilenler`}>
          {selected.map((value) => {
            const option = lookup.get(value);
            const name = option?.label ?? "Erişilemeyen seçim";
            return (
              <span
                key={value}
                className="social-selection-tag"
                title={option?.description ?? value}
              >
                <span>{name}</span>
                <button
                  type="button"
                  disabled={blocked}
                  aria-label={`${name} seçimini kaldır`}
                  onClick={() => onChange(selected.filter((id) => id !== value))}
                >
                  <X aria-hidden="true" />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}
      {open ? (
        <Popover
          anchor={trigger}
          bare
          width={width}
          maxHeight={380}
          className="social-picker-menu"
          id={`${uid}-menu`}
          role="dialog"
          aria-label={`${label} seçimi`}
          onDismiss={(reason) => close(reason === "escape")}
        >
          <div className="social-picker-search">
            <Search aria-hidden="true" />
            <SearchInput
              ref={search}
              role="combobox"
              aria-label={searchPlaceholder}
              aria-expanded="true"
              aria-autocomplete="list"
              aria-controls={listId}
              aria-activedescendant={activeId}
              value={query}
              placeholder={searchPlaceholder}
              autoComplete="off"
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={keyDown}
            />
          </div>
          <div
            ref={list}
            id={listId}
            role="listbox"
            aria-labelledby={`${uid}-label`}
            aria-multiselectable="true"
            className="social-picker-options"
          >
            {filtered.length ? (
              filtered.map((option, index) => (
                <button
                  key={option.value}
                  ref={index === active ? activeOption : undefined}
                  id={`${uid}-option-${index}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={chosen.has(option.value)}
                  aria-disabled={option.disabled || undefined}
                  disabled={blocked || option.disabled}
                  className="social-picker-option"
                  data-active={index === active}
                  title={option.description}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => toggle(option)}
                >
                  <span className="social-option-check">
                    {chosen.has(option.value) ? <Check aria-hidden="true" /> : null}
                  </span>
                  <span className="social-option-copy">
                    <strong>{option.label}</strong>
                    {option.description ? <small>{option.description}</small> : null}
                  </span>
                </button>
              ))
            ) : (
              <p className="social-picker-empty">
                {options.length ? "Aramanıza uygun seçenek yok." : "Henüz seçenek yok."}
              </p>
            )}
          </div>
          <div className="social-picker-footer">
            <span>{selected.length} seçili</span>
            <button
              type="button"
              disabled={blocked || !selected.length}
              onClick={() => onChange([])}
            >
              Temizle
            </button>
            <button type="button" onClick={() => close(true)}>
              Bitti
            </button>
          </div>
        </Popover>
      ) : null}
    </div>
  );
}
