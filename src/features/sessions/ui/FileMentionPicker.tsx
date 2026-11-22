import { Surface } from "../../../shared/ui/Surface";
import { PickerList, usePickerList } from "../../../shared/ui/picker";
import { useT } from "../../../shared/i18n";
import { Text } from "../../../shared/ui/Text";
import { Server, StickyNote } from "../../../shared/ui/icons";
import type { RankedFile } from "../../files";
import { isNoteMentionPath } from "../../notes";
import { FileTypeIcon } from "../../files/public/FileTypeIcon";
import { MatchText } from "../../../shared/ui/MatchText";
import { crewMentionOf } from "../model/crewMentions";
import { CrewMentionIcon, CrewMentionText } from "./ComposerCrewMentionRow";
import { workItemMentionOf, WORK_ITEM_PROVIDER_NAMES } from "../model/workItemMentionRows";
import { WorkItemMentionText, workItemMentionMeta } from "./ComposerWorkItemMentionRow";
import { InboxProviderMark, type WorkItemSearchError } from "../../inbox/public/workItemMentions";
import { workItemSearchNotice } from "../model/workItemSearchNotice";
import { usePresentationNow } from "./AgentClock";
import { serverMentionOf } from "../model/serverMentions";
type Props = {
  files: RankedFile[];
  query: string;
  active: number;
  loading?: boolean;
  /** The project file listing failed to load; shows a retry row instead of the loading text. */
  failed?: boolean;
  /** The file index may be missing files; the picker says so instead of "no matches". */
  indexNotice?: "incomplete" | "unknown";
  onRetry?: () => void;
  includeNotes?: boolean;
  includeWorkItems?: boolean;
  workItemsScoped?: boolean;
  /** Why the tracker search found nothing; replaces "No matches" with a short reason. */
  workItemsFailure?: { error: WorkItemSearchError; machine?: string };
  serversScoped?: boolean;
  includeServers?: boolean;
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
  indexNotice,
  onRetry,
  includeNotes = false,
  includeWorkItems = false,
  workItemsScoped = false,
  workItemsFailure,
  serversScoped = false,
  includeServers = false,
  onActive,
  onPick,
}: Props) {
  const t = useT();
  const now = usePresentationNow(
    workItemsFailure?.error.failure === "rate-limited" && !!workItemsFailure.error.retryAt,
  );
  const includesMentions = includeWorkItems || workItemsScoped || includeServers || serversScoped;
  const list = usePickerList({
    options: files.map((file) => {
      const crew = crewMentionOf(file);
      const workItem = workItemMentionOf(file);
      const server = serverMentionOf(file);
      const name = server?.hint ? t("Servers") : file.name;
      const note = isNoteMentionPath(file.path);
      const slash = file.relative.lastIndexOf("/");
      return {
        value: file.path,
        textValue: name,
        title: workItem ? (
          <WorkItemMentionText target={workItem} name={file.name} positions={file.positions} />
        ) : crew ? (
          <CrewMentionText target={crew} positions={file.positions} query={query} />
        ) : (
          <>
            <MatchText
              text={name}
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
        icon: workItem ? (
          <InboxProviderMark provider={workItem.provider} className="icon-sm" />
        ) : crew ? (
          <CrewMentionIcon target={crew} />
        ) : server ? (
          <Server className="icon-sm" />
        ) : note ? (
          <StickyNote className="icon-sm" />
        ) : (
          <FileTypeIcon name={file.name} isDir={Boolean(file.isDir)} size="md" />
        ),
        group: workItem
          ? workItemsScoped
            ? WORK_ITEM_PROVIDER_NAMES[workItem.provider]
            : t("Work items")
          : crew
            ? crew.kind === "member"
              ? t("Members")
              : t("Crews")
            : server && !server.hint
              ? t("Servers")
              : undefined,
        meta: workItem ? (
          workItemMentionMeta(workItem, t("Unassigned"))
        ) : server ? (
          <Text size="caption" tone="secondary">
            @{server.token}
          </Text>
        ) : note ? (
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
      variant="card"
      padding="none"
      data-mention-picker
      radius="card"
      frame="card"
      edge="all"
      className="overflow-hidden"
    >
      <PickerList
        label={
          includesMentions
            ? t("Mentions")
            : includeNotes
              ? t("Files and notes")
              : t("Files and folders")
        }
        controller={list}
        checkPlacement="none"
        pointerHighlight="movement"
        loading={loading && !failed}
        loadingLabel={includesMentions ? t("Loading…") : t("Indexing files…")}
        error={
          files.length === 0 && failed
            ? serversScoped
              ? t("Could not load.")
              : t("Could not index files.")
            : undefined
        }
        onRetry={onRetry}
        emptyLabel={
          includesMentions
            ? workItemsFailure
              ? workItemSearchNotice(workItemsFailure.error, workItemsFailure.machine, t, now)
              : t("No matches")
            : query.trim()
              ? includeNotes
                ? t("No matching files or notes")
                : t("No matching files or folders")
              : includeNotes
                ? t("No files or notes found")
                : t("No files or folders found")
        }
        listHeight="standard"
        className="overflow-y-auto overscroll-none"
      />
      {indexNotice && !loading ? (
        <Text as="p" size="caption" tone="secondary" className="px-3 py-2">
          {indexNotice === "incomplete"
            ? t("File index is incomplete; some files may not appear.")
            : t("File index completeness is unknown; some files may not appear.")}
        </Text>
      ) : null}
    </Surface>
  );
}
