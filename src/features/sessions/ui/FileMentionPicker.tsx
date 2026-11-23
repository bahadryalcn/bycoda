import { Surface } from "../../../shared/ui/Surface";
import { PickerList, usePickerList } from "../../../shared/ui/picker";
import { useT } from "../../../shared/i18n";
import { Text } from "../../../shared/ui/Text";
import { useEffect, useRef } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { Code } from "../../../shared/ui/Code";
import { ChevronRight, Server, StickyNote, UsersRound } from "../../../shared/ui/icons";
import type { RankedFile } from "../../files";
import { isNoteMentionPath, NOTES_MENTION_SCOPE } from "../../notes";
import { FileTypeIcon } from "../../files/public/FileTypeIcon";
import { MatchText } from "../../../shared/ui/MatchText";
import { CREWS_MENTION_SCOPE, crewMentionOf } from "../model/crewMentions";
import { CrewMentionIcon, CrewMentionMeta } from "./ComposerCrewMentionRow";
import { workItemMentionOf, WORK_ITEM_PROVIDER_NAMES } from "../model/workItemMentionRows";
import { WorkItemMentionText, workItemMentionMeta } from "./ComposerWorkItemMentionRow";
import { InboxProviderMark, type WorkItemSearchError } from "../../inbox/public/workItemMentions";
import { workItemSearchNotice } from "../model/workItemSearchNotice";
import { usePresentationNow } from "./AgentClock";
import { serverMentionOf } from "../model/serverMentions";
import {
  composerMentionScopeHintOf,
  type ComposerMentionScope,
} from "../model/composerMentionScopes";
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
  scope?: ComposerMentionScope;
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
  scope,
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
  const includesMentions =
    includeWorkItems || workItemsScoped || includeServers || serversScoped || scope;
  const fileSearch = !workItemsScoped && !serversScoped && !scope;
  const hasQuery = Boolean(query.trim());
  const retry = useStableCallback(onRetry);
  const retried = useRef(false);
  // Give the file index one refresh per picker opening when a settled search misses.
  useEffect(() => {
    if (
      retried.current ||
      !fileSearch ||
      !hasQuery ||
      files.length ||
      loading ||
      failed ||
      !indexNotice ||
      !retry
    ) {
      return;
    }
    const timer = setTimeout(() => {
      retried.current = true;
      retry();
    }, 250);
    return () => clearTimeout(timer);
  }, [fileSearch, query, hasQuery, files.length, loading, failed, indexNotice, retry]);
  const indexMessage =
    indexNotice === "incomplete"
      ? t("File index is incomplete; some files may not appear.")
      : indexNotice === "unknown"
        ? t("File index completeness is unknown; some files may not appear.")
        : undefined;
  // Without a query the list reads as the project tree: root files first, then folders, then
  // notes. Headers only appear when the ranking really keeps each band together.
  const treeRank = (file: RankedFile) =>
    isNoteMentionPath(file.path) ? 2 : file.relative.includes("/") ? 1 : 0;
  const treeGroups =
    !includesMentions &&
    !hasQuery &&
    files.length >= 8 &&
    files.every((file, index) => index === 0 || treeRank(files[index - 1]) <= treeRank(file));
  const list = usePickerList({
    options: files.map((file) => {
      const crew = crewMentionOf(file);
      const workItem = workItemMentionOf(file);
      const server = serverMentionOf(file);
      const scopeHint = composerMentionScopeHintOf(file);
      const name =
        scopeHint === CREWS_MENTION_SCOPE
          ? t("Search crews and members")
          : scopeHint === NOTES_MENTION_SCOPE
            ? t("Search notes")
            : server?.hint
              ? t("Servers")
              : file.name;
      const note = isNoteMentionPath(file.path);
      const slash = file.relative.lastIndexOf("/");
      return {
        value: file.path,
        textValue: name,
        title: workItem ? (
          <WorkItemMentionText target={workItem} name={file.name} positions={file.positions} />
        ) : (
          <>
            <MatchText
              text={name}
              positions={
                note || crew
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
        ) : scopeHint === CREWS_MENTION_SCOPE ? (
          <UsersRound className="icon-sm" />
        ) : server ? (
          <Server className="icon-sm" />
        ) : note || scopeHint === NOTES_MENTION_SCOPE ? (
          <StickyNote className="icon-sm" />
        ) : (
          <FileTypeIcon name={file.name} isDir={Boolean(file.isDir)} size="md" />
        ),
        group: !includesMentions && !hasQuery && files.length < 8
          ? undefined
          : workItem
          ? workItemsScoped
            ? WORK_ITEM_PROVIDER_NAMES[workItem.provider]
            : t("Work items")
          : crew?.kind === "member"
            ? t("Members")
            : crew || scopeHint === CREWS_MENTION_SCOPE
              ? t("Crews")
              : note || scopeHint === NOTES_MENTION_SCOPE
                ? t("Notes")
                : server
                  ? t("Servers")
                  : treeGroups
                    ? [t("Project root"), t("Folders"), t("Notes")][treeRank(file)]
                    : file.isDir
                      ? t("Folders")
                      : t("Files"),
        meta:
          workItem?.kind === "hint" || scopeHint ? (
            <Code size="micro" tone="secondary">
              @{workItem?.token ?? scopeHint}
            </Code>
          ) : workItem ? (
            workItemMentionMeta(workItem, t("Unassigned"))
          ) : crew ? (
            <CrewMentionMeta target={crew} />
          ) : server ? (
            <Text size="caption" tone="secondary">
              @{server.token}
            </Text>
          ) : note || slash < 0 ? undefined : (
            <MatchText
              text={file.relative.slice(0, slash)}
              positions={file.positions.filter((pos) => pos < slash)}
              active={Boolean(query.trim())}
            />
          ),
        trailing:
          workItem?.kind === "hint" || scopeHint ? (
            <ChevronRight className="icon-sm" aria-hidden />
          ) : undefined,
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
          indexMessage ?? (includesMentions
            ? workItemsFailure
              ? workItemSearchNotice(workItemsFailure.error, workItemsFailure.machine, t, now)
              : t("No matches")
            : query.trim()
              ? includeNotes
                ? t("No matching files or notes")
                : t("No matching files or folders")
              : includeNotes
                ? t("No files or notes found")
                : t("No files or folders found"))
        }
        listHeight="standard"
        className="overflow-y-auto overscroll-none"
      />
      {indexMessage && files.length > 0 && !loading && !failed ? (
        <Text as="p" size="caption" tone="secondary" className="break-words px-3 py-2">
          {indexMessage}
        </Text>
      ) : null}
    </Surface>
  );
}
