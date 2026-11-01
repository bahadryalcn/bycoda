import { PopoverSearchHeader } from "../../../shared/ui/PopoverSearchHeader";
import { PickerList, filterPickerOptions, usePickerList } from "../../../shared/ui/picker";
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
    () =>
      filterPickerOptions(
        items.map((item) => ({ value: item.id, title: item.label, meta: item.detail })),
        query,
      ),
    [items, query],
  );
  const picker = usePickerList({
    options,
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
      <div className="flex min-h-0 flex-col gap-1 p-3">
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
            emptyLabel={items.length === 0 ? emptyText : t("Nothing matches")}
          />
        </div>
      </div>
    </Modal>
  );
}
