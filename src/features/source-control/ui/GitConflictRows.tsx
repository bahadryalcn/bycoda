import { useState } from "react";
import { DropdownMenu, type DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { MoreHorizontal, FileDiff } from "../../../shared/ui/icons";
import { Button } from "../../../shared/ui/Button";
import { relativeDirname as dirname } from "../../../shared/lib/paths";
import { t, useLocale } from "../../../shared/i18n/git";
import { basename } from "../../../platform/tauri/fs";
import { FileTypeIcon } from "../../files/ui/FileTypeIcon";
import {
  conflictCanCompare,
  conflictChoices,
  conflictHasFile,
  conflictKindInfo,
  type ConflictChoice,
  type ConflictRow,
} from "../model/conflictSection";

type Props = {
  rows: ConflictRow[];
  selected?: string;
  /** The panel's shared busy key: a file's relative path, or "conflicts" for a bulk action. */
  busy: string | null;
  /** Compare reads the stage versions, which an older host cannot give. */
  canCompare: boolean;
  onOpen: (row: ConflictRow, pin?: boolean) => void;
  onCompare: (row: ConflictRow) => void;
  onChoose: (row: ConflictRow, choice: ConflictChoice) => void;
  onMarkResolved: (row: ConflictRow) => void;
};

/**
 * The rows of the Merge Conflicts section: the file, what kind of conflict it
 * is, with secondary resolution actions in the shared keyboard-accessible menu.
 */
export function GitConflictRows({
  rows,
  selected,
  busy,
  canCompare,
  onOpen,
  onCompare,
  onChoose,
  onMarkResolved,
}: Props) {
  useLocale();
  const [menu, setMenu] = useState<{ row: ConflictRow; anchor: HTMLElement } | null>(null);
  return (
    <>
      {rows.map((row) => {
        const name = basename(row.relative);
        const dir = dirname(row.relative);
        const info = conflictKindInfo(row.kind);
        const hasFile = conflictHasFile(row.kind);
        const working = busy === row.relative || busy === "conflicts";
        const disabled = busy !== null;
        return (
          <li key={row.relative} data-conflict={row.relative}>
            <div
              className={`pr-2 pl-2 ${
                selected === row.relative ? "bg-selection" : "hover:bg-[var(--ui-surface-hover)]"
              }`}
            >
              <div className="flex h-7 w-full items-center gap-1 leading-none">
                <Button
                  variant="item"
                  motion="none"
                  type="button"
                  title={
                    hasFile ? t("Open {p0} in the editor", { p0: row.relative }) : row.relative
                  }
                  disabled={!hasFile || disabled}
                  onClick={() => onOpen(row)}
                  onDoubleClick={() => onOpen(row, true)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                >
                  <FileTypeIcon name={name} isDir={false} size={16} />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-[13px] font-medium">{name}</span>
                    {dir ? (
                      <span className="ml-1.5 text-[11px] text-[var(--ui-text-muted)]">{dir}</span>
                    ) : null}
                  </span>
                </Button>
                {canCompare && conflictCanCompare(row.kind) ? (
                  <Button
                    variant="ghost"
                    motion="none"
                    iconOnly
                    label={t("Compare")}
                    tooltip={t(
                      "Compare the current and incoming versions with the base, read-only",
                    )}
                    disabled={disabled}
                    onClick={() => onCompare(row)}
                  >
                    <FileDiff size={14} />
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  motion="none"
                  iconOnly
                  label={t("Resolve {p0}", { p0: row.relative })}
                  loading={working}
                  disabled={disabled}
                  aria-haspopup="menu"
                  aria-expanded={menu?.row.relative === row.relative}
                  onClick={(event) => setMenu({ row, anchor: event.currentTarget })}
                >
                  <MoreHorizontal size={14} />
                </Button>
                <span
                  title={info.title}
                  aria-label={info.label}
                  className="w-5 shrink-0 text-right font-mono text-[11px] font-semibold text-danger"
                >
                  {info.letter}
                </span>
              </div>
            </div>
          </li>
        );
      })}
      {menu ? (
        <DropdownMenu
          anchor={menu.anchor}
          label={t("Resolve {p0}", { p0: menu.row.relative })}
          items={[
            ...(conflictHasFile(menu.row.kind)
              ? [{ kind: "item" as const, id: "open", label: t("Open") }]
              : []),
            ...conflictChoices(menu.row.kind).map((choice): DropdownMenuItem => ({
              kind: "item",
              id: choice.id,
              label: choice.label,
              title: choice.title,
              disabled: busy !== null,
            })),
            ...(conflictHasFile(menu.row.kind)
              ? [
                  { kind: "sep" as const },
                  {
                    kind: "item" as const,
                    id: "resolved",
                    label: t("Mark Resolved"),
                    title: t("Stage the file as it is now"),
                    disabled: busy !== null,
                  },
                ]
              : []),
          ]}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            const row = menu.row;
            setMenu(null);
            if (busy !== null) return;
            if (id === "open") onOpen(row, true);
            else if (id === "resolved") onMarkResolved(row);
            else {
              const choice = conflictChoices(row.kind).find((choice) => choice.id === id);
              if (choice) onChoose(row, choice);
            }
          }}
        />
      ) : null}
    </>
  );
}
