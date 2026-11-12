import { Text } from "../../../shared/ui/Text";
import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { t, useLocale } from "../../../shared/i18n/technical";
import { Button } from "../../../shared/ui/Button";
import { ShortcutKbd } from "../../../shared/ui/ShortcutKbd";
import { MatchText } from "../../../shared/ui/MatchText";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import type { FuzzyHit } from "../../../shared/lib/fuzzy";
import type { RankedFile } from "../model/fileIndex";
import { FileTypeIcon } from "./FileTypeIcon";

/** One command of the palette (`>` mode of the picker). */
export type Action = {
  id: string;
  label: string;
  hint?: string;
};

export type RankedAction = Action & FuzzyHit;

export function ActionList({
  id,
  actions,
  active,
  query,
  onActive,
  onRun,
}: {
  id: string;
  actions: RankedAction[];
  active: number;
  query: string;
  onActive: (index: number) => void;
  onRun: (action: RankedAction) => void;
}) {
  useLocale();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div
      ref={lockOverscroll}
      id={id}
      role="listbox"
      aria-label={t("Commands")}
      className="max-h-[min(380px,50vh)] overflow-y-auto overscroll-none px-1.5 pb-1.5"
    >
      {actions.map((action, index) => {
        const highlighted = index === active;
        return (
          <Button
            variant="item"
            motion="none"
            key={action.id}
            ref={highlighted ? activeRef : undefined}
            type="button"
            role="option"
            id={`${id}-option-${index}`}
            tabIndex={-1}
            aria-selected={highlighted}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onActive(index)}
            onClick={() => onRun(action)}
            leading="none"
            className={`  flex min-h-(--ui-control-height) w-full items-center gap-2 text-left  ${
              highlighted ? "" : ""
            }   `}
          >
            <Text size="inherit" tone="inherit" truncate className="min-w-0 flex-1">
              <MatchText text={action.label} positions={action.positions} active={Boolean(query)} />
            </Text>
            {action.hint ? (
              <ShortcutKbd size="xs" className="ml-auto shrink-0">
                {action.hint}
              </ShortcutKbd>
            ) : null}
          </Button>
        );
      })}
    </div>
  );
}
export function FileList({
  id,
  files,
  active,
  query,
  onActive,
  onPick,
}: {
  id: string;
  files: RankedFile[];
  active: number;
  query: string;
  onActive: (index: number) => void;
  onPick: (file: RankedFile) => void;
}) {
  useLocale();
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
      ref={lockOverscroll}
      id={id}
      role="listbox"
      aria-label={t("Files")}
      onMouseMove={onListMouseMove}
      className="max-h-[min(380px,50vh)] overflow-y-auto overscroll-none px-1.5 pb-1.5"
    >
      {files.map((file, index) => {
        const highlighted = index === active;
        const slash = file.relative.lastIndexOf("/");
        const dir = slash === -1 ? "" : file.relative.slice(0, slash);
        const nameOffset = slash === -1 ? 0 : slash + 1;
        return (
          <Button
            variant="item"
            motion="none"
            key={file.path}
            ref={highlighted ? activeRef : undefined}
            type="button"
            role="option"
            id={`${id}-option-${index}`}
            tabIndex={-1}
            aria-selected={highlighted}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onRowEnter(index)}
            onClick={() => onPick(file)}
            leading="none"
            className={`  flex min-h-(--ui-control-height) w-full items-center gap-2 text-left  ${
              highlighted ? "" : ""
            }   `}
          >
            <span className="shrink-0">
              <FileTypeIcon name={file.name} isDir={false} />
            </span>
            <Text size="inherit" tone="inherit" truncate className="min-w-0 flex-1">
              <MatchText
                text={file.name}
                positions={file.positions
                  .filter((pos) => pos >= nameOffset)
                  .map((pos) => pos - nameOffset)}
                active={Boolean(query.trim())}
              />
            </Text>
            {dir ? (
              <Text
                size="caption"
                tone="secondary"
                truncate
                className="min-w-0 max-w-[45%] font-mono"
              >
                <MatchText
                  text={dir}
                  positions={file.positions.filter((pos) => pos < slash)}
                  active={Boolean(query.trim())}
                />
              </Text>
            ) : null}
          </Button>
        );
      })}
    </div>
  );
}
