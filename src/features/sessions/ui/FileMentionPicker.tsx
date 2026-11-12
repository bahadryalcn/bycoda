import { Surface } from "../../../shared/ui/Surface";
import { PickerList, usePickerList } from "../../../shared/ui/picker";
import { useT } from "../../../shared/i18n";
import { StickyNote } from "../../../shared/ui/icons";
import type { RankedFile } from "../../files";
import { isNoteMentionPath } from "../../notes";
import { FileTypeIcon } from "../../files/public/FileTypeIcon";
import { MatchText } from "../../../shared/ui/MatchText";
import { crewMentionOf } from "../model/crewMentions";
import { CrewMentionIcon, CrewMentionText } from "./ComposerCrewMentionRow";
type Props = {
  files: RankedFile[];
  query: string;
  active: number;
  loading?: boolean;
  /** The project file listing failed to load; shows a retry row instead of the loading text. */
  failed?: boolean;
  onRetry?: () => void;
  includeNotes?: boolean;
  onActive: (index: number) => void;
  onPick: (file: RankedFile) => void;
};

/** Editor suggestions preserve composer focus; the shared list owns row appearance. */
export function FileMentionPicker({
  files,
  query,
  active,
  loading,
  failed,
  onRetry,
  includeNotes = false,
  onActive,
  onPick,
}: Props) {
  const t = useT();
  const list = usePickerList({
    options: files.map((file) => {
      const crew = crewMentionOf(file);
      const note = isNoteMentionPath(file.path);
      const slash = file.relative.lastIndexOf("/");
      return {
        value: file.path,
        textValue: file.name,
        title: crew ? (
          <CrewMentionText target={crew} positions={file.positions} query={query} />
        ) : (
          <>
            <MatchText
              text={file.name}
              positions={
                note
                  ? file.positions
                  : file.positions.filter((pos) => pos > slash).map((pos) => pos - slash - 1)
              }
              active={Boolean(query.trim())}
            />
            {file.isDir ? "/" : null}
          </>
        ),
        icon: crew ? (
          <CrewMentionIcon target={crew} />
        ) : note ? (
          <StickyNote className="icon-sm" />
        ) : (
          <FileTypeIcon name={file.name} isDir={Boolean(file.isDir)} size="md" />
        ),
        group: crew ? (crew.kind === "member" ? t("Members") : t("Crews")) : undefined,
        meta: note ? (
          t("Note")
        ) : slash < 0 ? undefined : (
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
    onActiveValueChange: (value) => onActive(files.findIndex((file) => file.path === value)),
    onChange: (value) => {
      const file = files.find((file) => file.path === value);
      if (file) onPick(file);
    },
  });
  return (
    <Surface
      padding="none"
      data-mention-picker
      radius="card"
      frame="neutral"
      edge="all"
      className="overflow-hidden"
    >
      <PickerList
        label={includeNotes ? t("Files and notes") : t("Files and folders")}
        controller={list}
        checkPlacement="none"
        pointerHighlight="movement"
        loading={files.length === 0 && loading && !failed}
        loadingLabel={t("Indexing files…")}
        error={files.length === 0 && failed ? t("Could not index files.") : undefined}
        onRetry={onRetry}
        emptyLabel={
          query.trim()
            ? includeNotes
              ? t("No matching files or notes")
              : t("No matching files or folders")
            : includeNotes
              ? t("No files or notes found")
              : t("No files or folders found")
        }
        className="max-h-[min(240px,40vh)] overflow-y-auto overscroll-none"
      />
    </Surface>
  );
}
