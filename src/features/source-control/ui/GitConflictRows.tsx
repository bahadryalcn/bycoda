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

const ACTION = "shrink-0";

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
 * is, and, always visible because there are few and they need an answer, the
 * ways to resolve it.
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
                  disabled={!hasFile}
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
                <span
                  title={info.title}
                  aria-label={info.label}
                  className="w-5 shrink-0 text-right font-mono text-[11px] font-semibold text-danger"
                >
                  {info.letter}
                </span>
              </div>
              <div
                className="flex flex-wrap items-center gap-x-0.5 pb-1 pl-[22px]"
                role="group"
                aria-label={t("Resolve {p0}", { p0: row.relative })}
              >
                {hasFile ? (
                  <Button
                    variant="ghost"
                    motion="none"
                    type="button"
                    title={t("Open the file in the editor to resolve each block")}
                    disabled={disabled}
                    onClick={() => onOpen(row, true)}
                    className={ACTION}
                  >
                    {t("Open")}
                  </Button>
                ) : null}
                {canCompare && conflictCanCompare(row.kind) ? (
                  <Button
                    variant="ghost"
                    motion="none"
                    type="button"
                    title={t("Compare the current and incoming versions with the base, read-only")}
                    disabled={disabled}
                    onClick={() => onCompare(row)}
                    className={ACTION}
                  >
                    {t("Compare")}
                  </Button>
                ) : null}
                {conflictChoices(row.kind).map((choice) => (
                  <Button
                    variant="ghost"
                    motion="none"
                    key={choice.id}
                    type="button"
                    title={choice.title}
                    disabled={disabled}
                    onClick={() => onChoose(row, choice)}
                    className={ACTION}
                  >
                    {choice.label}
                  </Button>
                ))}
                {hasFile ? (
                  <Button
                    variant="ghost"
                    motion="none"
                    type="button"
                    title={t("Stage the file as it is now")}
                    disabled={disabled}
                    onClick={() => onMarkResolved(row)}
                    className={ACTION}
                  >
                    {working ? t("Working…") : t("Mark Resolved")}
                  </Button>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </>
  );
}
