import { PopoverSearchHeader } from "../../../shared/ui/PopoverSearchHeader";
import { PickerList, filterPickerOptions, usePickerList } from "../../../shared/ui/picker";
import { COLLECTION_WINDOW_THRESHOLD } from "../../../shared/hooks/useCollectionVirtualizer";
import { t, useLocale } from "../../../shared/i18n/git";
import { useMemo, useState } from "react";
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
  const options = useMemo(
    () => items.map((item) => ({ value: item.id, title: item.label, meta: item.detail })),
    [items],
  );
  const matches = useMemo(() => filterPickerOptions(options, query), [options, query]);
  const picker = usePickerList({
    options: matches,
    value: null,
    onChange: onPick,
    loop: true,
    resetKey: query,
  });

  return (
    <Modal
      languageDomain="git"
      title={title}
      description={description}
      size="sm"
      onClose={onCancel}
    >
      <div className="flex min-h-0 flex-col gap-1">
        <PopoverSearchHeader
          label={placeholder}
          value={query}
          onValueChange={setQuery}
          divider={false}
          {...picker.searchProps}
        />
        <div className="flex max-h-72 min-h-0 flex-col">
          <PickerList
            label={title}
            controller={picker}
            query={query}
            windowed={items.length > COLLECTION_WINDOW_THRESHOLD}
            emptyLabel={items.length === 0 ? emptyText : t("Nothing matches")}
          />
        </div>
      </div>
    </Modal>
  );
}
