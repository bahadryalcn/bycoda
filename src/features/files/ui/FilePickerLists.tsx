import { type RefObject } from "react";
import { t, useLocale } from "../../../shared/i18n/technical";
import { PickerList, usePickerList } from "../../../shared/ui/picker";
import { ShortcutKbd } from "../../../shared/ui/ShortcutKbd";
import { MatchText } from "../../../shared/ui/MatchText";
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
  inputRef,
}: {
  id: string;
  actions: RankedAction[];
  active: number;
  query: string;
  onActive: (index: number) => void;
  onRun: (action: RankedAction) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  useLocale();
  const list = usePickerList({
    id,
    options: actions.map((action) => ({
      value: action.id,
      title: <MatchText text={action.label} positions={action.positions} active={Boolean(query)} />,
      textValue: action.label,
      meta: action.hint ? <ShortcutKbd size="xs">{action.hint}</ShortcutKbd> : undefined,
    })),
    value: actions[active]?.id ?? null,
    activeValue: actions[active]?.id ?? null,
    inputRef,
    onActiveValueChange: (value) => onActive(actions.findIndex((action) => action.id === value)),
    onChange: (value) => {
      const action = actions.find((action) => action.id === value);
      if (action) onRun(action);
    },
  });
  return (
    <PickerList
      label={t("Commands")}
      controller={list}
      checkPlacement="none"
      className="max-h-[min(380px,50vh)] overflow-y-auto overscroll-none"
    />
  );
}

export function FileList({
  id,
  files,
  active,
  query,
  onActive,
  onPick,
  inputRef,
}: {
  id: string;
  files: RankedFile[];
  active: number;
  query: string;
  onActive: (index: number) => void;
  onPick: (file: RankedFile) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  useLocale();
  const list = usePickerList({
    id,
    options: files.map((file) => {
      const slash = file.relative.lastIndexOf("/");
      return {
        value: file.path,
        title: (
          <MatchText
            text={file.name}
            positions={file.positions.filter((pos) => pos > slash).map((pos) => pos - slash - 1)}
            active={Boolean(query.trim())}
          />
        ),
        textValue: file.name,
        icon: <FileTypeIcon name={file.name} isDir={false} />,
        meta:
          slash < 0 ? undefined : (
            <MatchText
              text={file.relative.slice(0, slash)}
              positions={file.positions.filter((pos) => pos < slash)}
              active={Boolean(query.trim())}
            />
          ),
      };
    }),
    value: files[active]?.path ?? null,
    activeValue: files[active]?.path ?? null,
    inputRef,
    onActiveValueChange: (value) => onActive(files.findIndex((file) => file.path === value)),
    onChange: (value) => {
      const file = files.find((file) => file.path === value);
      if (file) onPick(file);
    },
  });
  return (
    <PickerList
      label={t("Files")}
      controller={list}
      checkPlacement="none"
      pointerHighlight="movement"
      className="max-h-[min(380px,50vh)] overflow-y-auto overscroll-none"
    />
  );
}
