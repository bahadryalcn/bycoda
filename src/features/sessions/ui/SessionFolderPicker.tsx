import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import { useState } from "react";
import { type SessionFolderTarget, type SessionFolder } from "../model/sessionFolders";
import { Folder, Plus, X } from "../../../shared/ui/icons";
import {
  PickerList,
  PopoverSearchHeader,
  usePickerList,
  type PickerOption,
} from "../../../shared/ui/picker";

type Props = {
  folders: SessionFolder[];
  onPick: (target: SessionFolderTarget) => void;
  onDismiss: () => void;
};

export function SessionFolderPicker({ folders, onPick, onDismiss }: Props) {
  const t = useT();
  const [query, setQuery] = useState("");
  const name = query.trim();
  const needle = name.toLocaleLowerCase();
  const matching = needle
    ? folders.filter((folder) => folder.name.toLocaleLowerCase().includes(needle))
    : folders;
  const exact = folders.some(
    (folder) => folder.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
  );
  const rows: SessionFolderTarget[] = [
    ...matching.map((folder): SessionFolderTarget => ({
      kind: "existing",
      folderId: folder.id,
    })),
    ...(name && !exact ? ([{ kind: "new", name }] satisfies SessionFolderTarget[]) : []),
  ];
  const rowKey = (row: SessionFolderTarget) =>
    row.kind === "existing" ? `folder:${row.folderId}` : "new";
  const options: PickerOption[] = rows.map((row) => {
    const folder =
      row.kind === "existing" ? folders.find((entry) => entry.id === row.folderId) : undefined;
    return {
      value: rowKey(row),
      title: folder ? folder.name : t("Create “{p0}”", { p0: row.kind === "new" ? row.name : "" }),
      textValue: folder ? folder.name : row.kind === "new" ? row.name : "",
      icon: folder ? <Folder className="icon-sm" /> : <Plus className="icon-sm text-skill" />,
      trailing: folder ? (
        <Text size="micro" tone="secondary" className="tabular-nums">
          {folder.sessionIds.length}
        </Text>
      ) : undefined,
    };
  });
  const list = usePickerList({
    options,
    loop: true,
    resetKey: query,
    value: null,
    onChange: (key) => {
      const row = rows.find((item) => rowKey(item) === key);
      if (row) onPick(row);
    },
  });

  return (
    <div data-session-folder-picker className="overflow-hidden">
      <PopoverSearchHeader
        label={t("Session folder")}
        placeholder={t("Choose or name a session folder…")}
        icon={Folder}
        value={query}
        onValueChange={setQuery}
        onEscape={onDismiss}
        {...list.searchProps}
        trailing={
          <Button
            iconOnly
            label={t("Cancel")}
            variant="ghost"
            type="button"
            onClick={onDismiss}
            className="shrink-0"
          >
            <X className="icon-sm" />
          </Button>
        }
      />
      <PickerList
        label={t("Session folders")}
        controller={list}
        emptyLabel={t("Type a name to create the first folder")}
        className="max-h-[min(240px,40vh)]"
      />
    </div>
  );
}
