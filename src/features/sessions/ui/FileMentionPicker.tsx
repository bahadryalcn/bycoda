import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import { StickyNote } from "../../../shared/ui/icons";
import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";
import type { RankedFile } from "../../files/model/fileIndex";
import { isNoteMentionPath } from "../../notes";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { FileTypeIcon } from "../../files/ui/FileTypeIcon";
import { MatchText } from "../../../shared/ui/MatchText";

type Props = {
  files: RankedFile[];
  query: string;
  active: number;
  loading?: boolean;
  includeNotes?: boolean;
  onActive: (index: number) => void;
  onPick: (file: RankedFile) => void;
};

export function FileMentionPicker({
  files,
  query,
  active,
  loading,
  includeNotes = false,
  onActive,
  onPick,
}: Props) {
  const t = useT();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const activeRef = useRef<HTMLButtonElement>(null);
  const pointer = useRef({ x: Number.NaN, y: Number.NaN, allow: false });
  const fromPointer = useRef(false);

  useEffect(() => {
    pointer.current.allow = false;
  }, [files]);

  useEffect(() => {
    if (fromPointer.current) {
      fromPointer.current = false;
      return;
    }
    pointer.current.allow = false;
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onListMouseMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.clientX === pointer.current.x && e.clientY === pointer.current.y) {
      return;
    }
    pointer.current = { x: e.clientX, y: e.clientY, allow: true };
  };

  const onRowEnter = (index: number) => {
    if (!pointer.current.allow) return;
    fromPointer.current = true;
    onActive(index);
  };

  return (
    <div
      data-mention-picker
      className="overflow-hidden rounded-lg border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised)"
    >
      {files.length === 0 ? (
        <p className="px-3 py-2.5 text-ui-caption text-(--ui-text-secondary)">
          {loading
            ? t("Indexing files…")
            : query.trim()
              ? includeNotes
                ? t("No matching files or notes")
                : t("No matching files or folders")
              : includeNotes
                ? t("No files or notes found")
                : t("No files or folders found")}
        </p>
      ) : (
        <div
          ref={lockOverscroll}
          role="listbox"
          aria-label={includeNotes ? t("Files and notes") : t("Files and folders")}
          onMouseMove={onListMouseMove}
          className="max-h-[min(240px,40vh)] overflow-y-auto overscroll-none px-1 py-1"
        >
          {files.map((file, index) => {
            const highlighted = index === active;
            const note = isNoteMentionPath(file.path);
            const slash = file.relative.lastIndexOf("/");
            const dir = note ? "" : slash === -1 ? "" : file.relative.slice(0, slash);
            const nameOffset = slash === -1 ? 0 : slash + 1;
            const namePositions = note
              ? file.positions
              : file.positions.filter((pos) => pos >= nameOffset).map((pos) => pos - nameOffset);
            return (
              <Button
                className="w-full text-left"
                fullWidth
                selected={highlighted}
                variant="item"
                key={file.path}
                ref={highlighted ? activeRef : undefined}
                type="button"
                role="option"
                aria-selected={highlighted}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => onRowEnter(index)}
                onClick={() => onPick(file)}
              >
                <span className="shrink-0">
                  {isNoteMentionPath(file.path) ? (
                    <StickyNote className="size-3.5" strokeWidth={1.75} />
                  ) : (
                    <FileTypeIcon name={file.name} isDir={Boolean(file.isDir)} size={15} />
                  )}
                </span>
                <span className={`min-w-0 flex-1 truncate ${highlighted ? "text-mention" : ""}`}>
                  <MatchText
                    text={file.name}
                    positions={namePositions}
                    active={Boolean(query.trim())}
                  />
                  {file.isDir ? "/" : null}
                </span>
                {note ? (
                  <span className="shrink-0 font-mono text-ui-micro text-(--ui-text-secondary)">
                    {t("Note")}
                  </span>
                ) : dir ? (
                  <span className="min-w-0 max-w-[45%] truncate font-mono text-ui-micro text-(--ui-text-secondary)">
                    <MatchText
                      text={dir}
                      positions={file.positions.filter((pos) => pos < slash)}
                      active={Boolean(query.trim())}
                    />
                  </span>
                ) : null}
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}
