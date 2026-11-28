import { useState } from "react";
import { useT } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { DiffStat } from "../../../shared/ui/DiffStat";
import { MiddleTruncate } from "../../../shared/ui/MiddleTruncate";
import { ScrollArea } from "../../../shared/ui/ScrollArea";
import { Text } from "../../../shared/ui/Text";
import { FileTypeIcon } from "../../files/public/FileTypeIcon";
import type { TurnChangedFile } from "../model/turnChangedFiles";

/** Rows shown before the "Show more files" control; a longer list scrolls once expanded. */
const COLLAPSED_FILES = 6;

export function TurnChangedFiles({
  files,
  onOpen,
}: {
  files: TurnChangedFile[];
  onOpen?: (path: string) => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const visibleFiles = expanded ? files : files.slice(0, COLLAPSED_FILES);
  const hiddenFileCount = files.length - visibleFiles.length;
  return (
    <div data-turn-changed-files className="min-w-0 max-w-full pb-2">
      <ScrollArea
        as="ul"
        aria-label={t("Changed files")}
        className={`m-0 grid min-w-0 max-w-full list-none gap-0.5 p-0 ${expanded ? "max-h-64" : ""}`}
      >
        {visibleFiles.map(({ key, path, openPath, counts, status }) => {
          const deleted = status === "deleted";
          const content = (
            <>
              <span aria-hidden className="shrink-0">
                <FileTypeIcon name={path.split(/[/\\]/).pop() ?? path} isDir={false} />
              </span>
              <MiddleTruncate
                mode="path"
                className={`min-w-0 flex-1 text-start font-mono${deleted ? " line-through opacity-70" : ""}`}
              >
                {path}
              </MiddleTruncate>
              {status === "added" || deleted ? (
                <Badge
                  size="xs"
                  appearance="subtle"
                  tone={deleted ? "danger" : "success"}
                  data-status={status}
                  className="shrink-0"
                >
                  {deleted ? t("Deleted") : t("Added")}
                </Badge>
              ) : null}
              {counts ? <DiffStat {...counts} showZero className="shrink-0" /> : null}
            </>
          );
          return (
            <Text as="li" key={key} size="secondary" tone="secondary" className="min-w-0">
              {openPath && onOpen ? (
                <Button
                  className="min-w-0 justify-start gap-2"
                  variant="item"
                  size="xs"
                  fullWidth
                  motion="none"
                  type="button"
                  onClick={() => onOpen(openPath)}
                >
                  {content}
                </Button>
              ) : (
                <span className="flex min-w-0 items-center gap-2 px-1">{content}</span>
              )}
            </Text>
          );
        })}
      </ScrollArea>
      {files.length > COLLAPSED_FILES ? (
        // Lengthens or shortens the list in place; it opens no row, so it is a plain action.
        <Button
          fullWidth
          variant="item"
          size="xs"
          type="button"
          onClick={() => setExpanded((open) => !open)}
          className="w-full text-start"
        >
          <span>
            {expanded
              ? t("Show fewer files")
              : hiddenFileCount === 1
                ? t("Show {p0} more file", { p0: hiddenFileCount })
                : t("Show {p0} more files", { p0: hiddenFileCount })}
          </span>
        </Button>
      ) : null}
    </div>
  );
}
