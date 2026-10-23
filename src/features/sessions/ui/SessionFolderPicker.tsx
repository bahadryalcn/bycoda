import { Button } from "../../../shared/ui/Button";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { useT } from "../../../shared/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { type SessionFolderTarget, type SessionFolder } from "../model/sessionFolders";
import { Folder, Plus, X } from "../../../shared/ui/icons";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";

type Props = {
  folders: SessionFolder[];
  onPick: (target: SessionFolderTarget) => void;
  onDismiss: () => void;
};

export function SessionFolderPicker({ folders, onPick, onDismiss }: Props) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const name = query.trim();
  const matching = useMemo(() => {
    const needle = name.toLocaleLowerCase();
    if (!needle) return folders;
    return folders.filter((folder) => folder.name.toLocaleLowerCase().includes(needle));
  }, [folders, name]);
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

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    setActive((index) => (rows.length === 0 ? 0 : Math.min(index, rows.length - 1)));
  }, [rows.length]);

  const pick = (target: SessionFolderTarget | undefined) => {
    if (target) onPick(target);
  };

  return (
    <div
      data-session-folder-picker
      role="dialog"
      aria-label={t("Choose a session folder")}
      className="overflow-hidden rounded-lg border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised)"
    >
      <div className="flex items-center gap-2 border-b border-(--ui-tone-neutral-border) px-2.5 py-2">
        <Folder className="size-3.5 shrink-0 text-(--ui-text-secondary)" />
        <SearchInput
          ref={inputRef}
          value={query}
          aria-label={t("Session folder")}
          placeholder={t("Choose or name a session folder…")}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onDismiss();
              return;
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              if (rows.length > 0) setActive((index) => (index + 1) % rows.length);
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              if (rows.length > 0) setActive((index) => (index - 1 + rows.length) % rows.length);
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              pick(rows[active]);
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-ui-secondary text-(--ui-tone-neutral-fg) outline-none placeholder:text-(--ui-text-secondary)"
        />
        <Button
          iconOnly
          label={t("Cancel")}
          variant="ghost"
          type="button"
          title={t("Cancel")}
          aria-label={t("Cancel")}
          onClick={onDismiss}
          className="shrink-0"
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <div
        ref={lockOverscroll}
        role="listbox"
        aria-label={t("Session folders")}
        className="max-h-[min(240px,40vh)] overflow-y-auto overscroll-none p-1"
      >
        {rows.length === 0 ? (
          <p className="px-2 py-2 text-ui-caption text-(--ui-text-secondary)">
            {t("Type a name to create the first folder")}
          </p>
        ) : (
          rows.map((row, index) => {
            const folder =
              row.kind === "existing"
                ? folders.find((entry) => entry.id === row.folderId)
                : undefined;
            const label = row.kind === "existing" ? (folder?.name ?? "") : row.name;
            return (
              <Button
                className="w-full text-left"
                fullWidth
                selected={index === active}
                variant="item"
                key={row.kind === "existing" ? `folder:${row.folderId}` : "new"}
                type="button"
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(row)}
              >
                {folder ? (
                  <Folder className="size-3.5 shrink-0 text-(--ui-text-secondary)" />
                ) : (
                  <Plus className="size-3.5 shrink-0 text-skill" />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {folder ? label : t("Create “{p0}”", { p0: label })}
                </span>
                {folder ? (
                  <span className="shrink-0 text-ui-micro tabular-nums text-(--ui-text-secondary)">
                    {folder.sessionIds.length}
                  </span>
                ) : null}
              </Button>
            );
          })
        )}
      </div>
    </div>
  );
}
