import { Text } from "../../../shared/ui/Text";
import { useState } from "react";
import { DropdownMenu, type DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { FileDiff } from "../../../shared/ui/icons";
import { ActionHost, InlineAction, InlineMoreAction } from "../../../shared/ui/ActionHost";
import { Button } from "../../../shared/ui/Button";
import { relativeDirname as dirname } from "../../../shared/lib/paths";
import { t, useLocale } from "../../../shared/i18n/git";
import { basename } from "../../../platform/tauri/fs";
import { FileTypeIcon } from "../../files/public/FileTypeIcon";
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
            <ActionHost
              selected={selected === row.relative}
              className="h-(--ui-control-height-compact) w-full items-center gap-1 pr-2 pl-2"
            >
              <Button
                variant="item"
                motion="none"
                type="button"
                tooltip={
                  hasFile ? t("Open {p0} in the editor", { p0: row.relative }) : row.relative
                }
                disabled={!hasFile || disabled}
                onClick={() => onOpen(row)}
                onDoubleClick={() => onOpen(row, true)}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              >
                <FileTypeIcon name={name} isDir={false} />
                <Text
                  size="inherit"
                  tone="inherit"
                  leading="none"
                  truncate
                  className="min-w-0 flex-1"
                >
                  <Text size="secondary" tone="inherit" weight="medium">
                    {name}
                  </Text>
                  {dir ? (
                    <Text size="micro" tone="muted" className="ml-1.5">
                      {dir}
                    </Text>
                  ) : null}
                </Text>
              </Button>
              {canCompare && conflictCanCompare(row.kind) ? (
                <InlineAction
                  label={t("Compare")}
                  tooltip={t("Compare the current and incoming versions with the base, read-only")}
                  disabled={disabled}
                  onClick={() => onCompare(row)}
                >
                  <FileDiff className="icon-sm" aria-hidden />
                </InlineAction>
              ) : null}
              <InlineMoreAction
                label={t("Resolve {p0}", { p0: row.relative })}
                reveal={working ? "always" : "interaction"}
                loading={working}
                disabled={disabled}
                expanded={menu?.row.relative === row.relative}
                onOpen={(anchor) => setMenu({ row, anchor })}
              />
              <Text
                title={info.title}
                aria-label={info.label}
                size="micro"
                tone="danger"
                weight="medium"
                className="w-5 shrink-0 text-right font-mono"
              >
                {info.letter}
              </Text>
            </ActionHost>
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
