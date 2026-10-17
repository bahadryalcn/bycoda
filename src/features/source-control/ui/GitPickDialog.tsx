import { Button } from "../../../shared/ui/Button";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { t, useLocale } from "../../../shared/i18n/git";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Modal } from "../../../shared/ui/Modal";

export type PickItem = {
  id: string;
  label: string;
  /** Dimmed text after the label, e.g. a remote's URL. */
  detail?: string;
};

type Props = {
  title: string;
  description?: string;
  placeholder: string;
  items: PickItem[];
  emptyText: string;
  onPick: (id: string) => void;
  onCancel: () => void;
};

/** Choose one branch, stash, tag, or remote from a filterable list. */
export function GitPickDialog({
  title,
  description,
  placeholder,
  items,
  emptyText,
  onPick,
  onCancel,
}: Props) {
  useLocale();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      `${item.label} ${item.detail ?? ""}`.toLowerCase().includes(needle),
    );
  }, [items, query]);

  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-pick-index="${active}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (shown.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (current + step + shown.length) % shown.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = shown[active];
      if (item) onPick(item.id);
    }
  };

  return (
    <Modal
      languageDomain="git"
      title={title}
      description={description}
      size="sm"
      onClose={onCancel}
    >
      <div className="flex min-h-0 flex-col gap-2 p-3">
        <SearchInput
          appearance="field"
          standalone
          type="text"
          value={query}
          autoFocus
          placeholder={placeholder}
          aria-label={placeholder}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        {shown.length === 0 ? (
          <p className="px-1 py-2 text-[12px] text-[var(--ui-text-muted)]">
            {items.length === 0 ? emptyText : t("Nothing matches")}
          </p>
        ) : (
          <ul ref={list} role="listbox" className="max-h-72 overflow-y-auto">
            {shown.map((item, index) => (
              <li key={item.id} role="option" aria-selected={index === active}>
                <Button
                  selected={index === active}
                  variant="item"
                  motion="none"
                  type="button"
                  tabIndex={-1}
                  data-pick-index={index}
                  title={item.detail ? `${item.label} · ${item.detail}` : item.label}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => onPick(item.id)}
                  className={`  flex h-8 w-full items-center gap-2 text-left  ${
                    index === active ? "" : ""
                  }   `}
                >
                  <span className="min-w-0 truncate">{item.label}</span>
                  {item.detail ? (
                    <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--ui-text-muted)]">
                      {item.detail}
                    </span>
                  ) : null}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
