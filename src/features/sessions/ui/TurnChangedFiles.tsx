import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { DiffStat } from "../../../shared/ui/DiffStat";
import { MiddleTruncate } from "../../../shared/ui/MiddleTruncate";
import { Text } from "../../../shared/ui/Text";
import { FileTypeIcon } from "../../files/public/FileTypeIcon";
import type { TurnChangedFile } from "../model/turnChangedFiles";

export function TurnChangedFiles({
  files,
  onOpen,
}: {
  files: TurnChangedFile[];
  onOpen?: (path: string) => void;
}) {
  const t = useT();
  return (
    <ul
      aria-label={t("Changed files")}
      className="m-0 grid min-w-0 max-w-full list-none gap-0.5 p-0 pb-2"
    >
      {files.map(({ key, path, openPath, counts }) => {
        const content = (
          <>
            <span aria-hidden className="shrink-0">
              <FileTypeIcon name={path.split(/[/\\]/).pop() ?? path} isDir={false} />
            </span>
            <MiddleTruncate mode="path" className="min-w-0 flex-1 text-start font-mono">
              {path}
            </MiddleTruncate>
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
    </ul>
  );
}
