import { useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { useKeyedActiveIndex } from "../../hooks/useKeyedActiveIndex";
import { isImeComposition } from "../../lib/keyboard";
import type { PopoverSearchMove } from "../PopoverSearchHeader";

/** One row of a picker list. Only `value` and `title` are required. */
export type PickerOption = {
  value: string;
  /** Row title. A string is also the typeahead text and can show query matches. */
  title: ReactNode;
  /** Typeahead and accessible text when `title` is not a string. */
  textValue?: string;
  /** Leading glyph, logo, avatar or colour dot (icon-sm/icon-md). */
  icon?: ReactNode;
  /** Short secondary text on the title line, end-aligned (path, account, current value). */
  meta?: ReactNode;
  /** Second line under the title. */
  description?: ReactNode;
  /** Non-interactive end content: status text, Badge, ShortcutKbd, submenu chevron. */
  trailing?: ReactNode;
  /** Consecutive options with the same group render under one heading. */
  group?: string;
  disabled?: boolean;
  /** Why the row is unavailable; shown as its description and announced with it. */
  disabledReason?: string;
  /** Action row ("New terminal", "Manage servers…"): runs this instead of changing the selection, no check mark. */
  onAction?: () => void;
};

type SingleSelection = {
  multiple?: false;
  value: string | null | undefined;
  onChange: (value: string, option: PickerOption) => void;
};
type MultiSelection = {
  multiple: true;
  value: readonly string[];
  onChange: (value: string[], option: PickerOption) => void;
};

export type PickerListOptions = {
  options: readonly PickerOption[];
  /** Wrap ArrowUp/ArrowDown at the ends. Defaults to false (stay at the end). */
  loop?: boolean;
  /** When this changes the active row restarts at the committed option (e.g. `${open}:${query}`). */
  resetKey?: string;
  /** Listbox id; generated when omitted. */
  id?: string;
} & (SingleSelection | MultiSelection);

const choosable = (option: PickerOption | undefined) => !!option && !option.disabled;

export function pickerOptionText(option: PickerOption): string {
  return option.textValue ?? (typeof option.title === "string" ? option.title : option.value);
}

/** Case-folded filter over title text, meta/description strings and group. Callers may filter their own way. */
export function filterPickerOptions(
  options: readonly PickerOption[],
  query: string,
  locale?: string,
  keywords?: (option: PickerOption) => string | undefined,
): PickerOption[] {
  const needle = query.trim().toLocaleLowerCase(locale);
  if (!needle) return [...options];
  return options.filter((option) =>
    [
      pickerOptionText(option),
      typeof option.meta === "string" ? option.meta : "",
      typeof option.description === "string" ? option.description : "",
      keywords?.(option) ?? "",
    ]
      .join("\n")
      .toLocaleLowerCase(locale)
      .includes(needle),
  );
}

/**
 * Selection, active row and keyboard model of a picker list. Use it directly when a search header
 * drives the list (`searchProps` go on PopoverSearchHeader, `listProps`/controller on PickerList);
 * PickerList calls it itself when the list owns focus.
 */
export function usePickerList(props: PickerListOptions) {
  const { options, loop = false, resetKey = "" } = props;
  const generated = useId();
  const listId = props.id ?? generated;
  const selected = new Set<string>(
    props.multiple ? props.value : props.value != null ? [props.value] : [],
  );
  const firstChoosable = () => options.findIndex(choosable);
  const [active, setActive] = useKeyedActiveIndex(resetKey, options.length, () => {
    const committed = options.findIndex(
      (option) => selected.has(option.value) && choosable(option),
    );
    return committed >= 0 ? committed : firstChoosable();
  });
  // Disabled rows are shown but never active.
  const activeIndex = choosable(options[active]) ? active : firstChoosable();
  const optionId = (index: number) => `${listId}-option-${index}`;
  const activeOptionId = activeIndex >= 0 ? optionId(activeIndex) : undefined;
  const typeahead = useRef({ text: "", at: 0 });

  const step = (from: number, direction: 1 | -1) => {
    const count = options.length;
    for (let offset = 1; offset <= count; offset++) {
      const raw = from + direction * offset;
      const index = loop ? ((raw % count) + count) % count : raw;
      if (index < 0 || index >= count) return from;
      if (choosable(options[index])) return index;
    }
    return from;
  };
  const last = () => {
    for (let index = options.length - 1; index >= 0; index--)
      if (choosable(options[index])) return index;
    return -1;
  };

  const move = (to: PopoverSearchMove) => {
    if (options.length === 0) return;
    if (to === "first") setActive(firstChoosable());
    else if (to === "last") setActive(last());
    else setActive(step(activeIndex, to === "next" ? 1 : -1));
  };

  const commit = (index = activeIndex) => {
    const option = options[index];
    if (!choosable(option)) return;
    if (option!.onAction) {
      option!.onAction();
      return;
    }
    if (props.multiple) {
      props.onChange(
        selected.has(option!.value)
          ? props.value.filter((value) => value !== option!.value)
          : [...props.value, option!.value],
        option!,
      );
    } else props.onChange(option!.value, option!);
  };

  /** List-focus keys: arrows, Home/End, Enter/Space and typeahead. */
  const onListKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (isImeComposition(event.nativeEvent)) return;
    const key = event.key;
    if (key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End") {
      event.preventDefault();
      move(
        key === "ArrowDown"
          ? "next"
          : key === "ArrowUp"
            ? "previous"
            : key === "Home"
              ? "first"
              : "last",
      );
      return;
    }
    if (key === "Enter" || key === " ") {
      event.preventDefault();
      commit();
      return;
    }
    if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      const previous = typeahead.current;
      const text = (now - previous.at < 700 ? previous.text : "") + key.toLocaleLowerCase();
      typeahead.current = { text, at: now };
      // Repeating one letter cycles through rows starting with it.
      const query = [...text].every((letter) => letter === text[0]) ? text[0]! : text;
      for (let offset = 1; offset <= options.length; offset++) {
        const index = (Math.max(activeIndex, 0) + offset) % options.length;
        const option = options[index]!;
        if (choosable(option) && pickerOptionText(option).toLocaleLowerCase().startsWith(query)) {
          event.preventDefault();
          setActive(index);
          return;
        }
      }
    }
  };

  return {
    listId,
    options,
    multiple: !!props.multiple,
    activeIndex,
    activeOptionId,
    setActive,
    optionId,
    isSelected: (value: string) => selected.has(value),
    move,
    commit,
    onListKeyDown,
    /** Spread on PopoverSearchHeader: combobox wiring and key forwarding. */
    searchProps: {
      listId,
      activeOptionId,
      onMove: move,
      onSubmit: () => commit(),
    },
  };
}

export type PickerListController = ReturnType<typeof usePickerList>;
