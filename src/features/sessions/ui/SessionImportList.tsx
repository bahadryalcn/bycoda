import { OverflowTooltip, Tooltip } from "../../../shared/ui/Tooltip";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { ActionHost } from "../../../shared/ui/ActionHost";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { MiddleTruncate } from "../../../shared/ui/MiddleTruncate";
import { useFormat, useT } from "../../../shared/i18n";
import { useState } from "react";
import type { ImportCandidate, ImportProvider } from "../../../platform/tauri/sessionImport";
import { parentPath, prettyCwd, projectName } from "../../../shared/lib/paths";
import { CircleAlert, Clock, Folder } from "../../../shared/ui/icons";
import {
  IMPORT_PROVIDER_LABEL,
  candidateKey,
  formatBytes,
  groupByFolder,
  importHarness,
  isAlreadyImported,
  type FolderGroup,
} from "../import/importModel";
import { isUsableProjectFolder } from "../import/importRunner";
import { HarnessIcon } from "./HarnessIcon";

/** Conversations rendered per open folder before "Show more"; keeps huge folders cheap to open. */
const ITEM_PAGE = 150;

/** Whether the chat will only be history, with no way to continue it. */
function isHistoryOnly(candidate: ImportCandidate): boolean {
  return !isUsableProjectFolder(candidate) || !candidate.resumable;
}

type Selection = {
  stored: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  onToggleKeys: (keys: string[], on: boolean) => void;
  selectable: (items: ImportCandidate[]) => string[];
};

/** Selection state for a set of conversations: what a group checkbox toggles and shows. */
function groupCheck(items: ImportCandidate[], selection: Selection) {
  const keys = selection.selectable(items);
  const chosen = keys.filter((key) => selection.selected.has(key)).length;
  return { keys, chosen, all: keys.length > 0 && chosen === keys.length };
}

/**
 * One provider's conversations, grouped by the folder each ran in. Each section
 * keeps its own open folders, so opening one provider never reshapes another.
 */
export function ProviderSection({
  provider,
  items,
  defaultOpen,
  searching,
  divider,
  selection,
}: {
  provider: ImportProvider;
  /** The provider's conversations that pass the filters, newest first. */
  items: ImportCandidate[];
  defaultOpen: boolean;
  searching: boolean;
  divider: boolean;
  selection: Selection;
}) {
  const t = useT();
  const { formatNumber } = useFormat();
  const [open, setOpen] = useState(defaultOpen);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [missingOpen, setMissingOpen] = useState(false);
  const label = IMPORT_PROVIDER_LABEL[provider];
  const folders = groupByFolder(items);
  const present = folders.filter((folder) => folder.exists);
  const missing = folders.filter((folder) => !folder.exists);
  const autoExpand = folders.length <= 6 || searching;
  const check = groupCheck(items, selection);
  const missingCheck = groupCheck(
    missing.flatMap((folder) => folder.items),
    selection,
  );
  const shown = open || searching;
  const toggleFolder = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const folderSection = (folder: FolderGroup, index: number, list: FolderGroup[]) => (
    <FolderSection
      key={folder.key}
      divider={index < list.length - 1 || (list === present && missing.length > 0)}
      folder={folder}
      open={autoExpand || expanded.has(folder.key)}
      onToggleOpen={() => toggleFolder(folder.key)}
      selection={selection}
    />
  );

  return (
    <section {...surfaceAttributes({ frame: divider ? "pane" : "none", edge: "bottom" })}>
      <div className="flex items-center gap-2 px-3 py-0.5">
        <Checkbox
          aria-label={t("Select every {p0} conversation", { p0: label })}
          disabled={check.keys.length === 0}
          disabledReason={t("No conversations to select.")}
          checked={check.all}
          indeterminate={check.chosen > 0 && !check.all}
          onChange={(event) => selection.onToggleKeys(check.keys, event.target.checked)}
        />
        {/* oxlint-disable-next-line bycoda/transcript-row-trigger -- an import-list folder header beside its checkbox, not a transcript row */}
        <Button
          variant="ghost"
          type="button"
          align="start"
          expanded={shown}
          chevron="start"
          onClick={() => setOpen((value) => !value)}
          className="min-w-0 flex-1"
        >
          <HarnessIcon harness={importHarness(provider)} className="size-3.5 shrink-0" />
          <Text size="secondary" weight="medium" truncate className="min-w-0 flex-1">
            {label}
          </Text>
          <Text
            size="micro"
            tone="muted"
            className="shrink-0 whitespace-nowrap text-end tabular-nums"
          >
            {check.chosen > 0 && !check.all
              ? `${formatNumber(check.chosen)} / ${formatNumber(items.length)}`
              : formatNumber(items.length)}
          </Text>
        </Button>
      </div>
      {shown ? (
        <div {...surfaceAttributes({ frame: "pane", edge: "top" }, "ps-4")}>
          {present.map(folderSection)}
          {missing.length > 0 ? (
            <section>
              <div className="flex items-center gap-2 px-3 py-0.5">
                <Checkbox
                  aria-label={t("Select all missing {p0} folders", { p0: label })}
                  disabled={missingCheck.keys.length === 0}
                  disabledReason={t("No conversations to select.")}
                  checked={missingCheck.all}
                  indeterminate={missingCheck.chosen > 0 && !missingCheck.all}
                  onChange={(event) =>
                    selection.onToggleKeys(missingCheck.keys, event.target.checked)
                  }
                />
                {/* oxlint-disable-next-line bycoda/transcript-row-trigger -- an import-list folder header beside its checkbox, not a transcript row */}
                <Button
                  variant="ghost"
                  type="button"
                  align="start"
                  expanded={missingOpen || searching}
                  chevron="start"
                  onClick={() => setMissingOpen((value) => !value)}
                  className="min-w-0 flex-1"
                >
                  <Text size="secondary" tone="secondary" truncate className="min-w-0 flex-1">
                    {t("Missing folders ({p0})", {
                      p0: formatNumber(missing.length),
                    })}
                  </Text>
                </Button>
              </div>
              {missingOpen || searching ? missing.map(folderSection) : null}
            </section>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function FolderSection({
  divider,
  folder,
  open,
  onToggleOpen,
  selection,
}: {
  divider: boolean;
  folder: FolderGroup;
  open: boolean;
  onToggleOpen: () => void;
  selection: Selection;
}) {
  const t = useT();
  const { formatImportDate, formatNumber } = useFormat();
  const [limit, setLimit] = useState(ITEM_PAGE);
  const { keys, chosen, all } = groupCheck(folder.items, selection);
  const parent = parentPath(folder.path);
  const parentLabel = parent && parent !== folder.path ? prettyCwd(parent) : "";

  return (
    // Offscreen folders skip layout and paint, so ~3k conversations stay cheap to scroll and filter.
    <section
      {...surfaceAttributes(
        { frame: divider ? "pane" : "none", edge: "bottom" },
        "[contain-intrinsic-size:auto_36px] [content-visibility:auto]",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-0.5">
        <Checkbox
          aria-label={t("Select every conversation in {p0}", { p0: folder.path })}
          disabled={keys.length === 0}
          disabledReason={t("No conversations to select.")}
          checked={all}
          indeterminate={chosen > 0 && !all}
          onChange={(event) => selection.onToggleKeys(keys, event.target.checked)}
        />
        {/* oxlint-disable-next-line bycoda/transcript-row-trigger -- an import-list folder header beside its checkbox, not a transcript row */}
        <Button
          variant="ghost"
          type="button"
          align="start"
          expanded={open}
          chevron="start"
          onClick={onToggleOpen}
          className="min-w-0 flex-1"
        >
          <Folder className="icon-sm shrink-0" tone="secondary" />
          <Text size="secondary" weight="medium" truncate className="max-w-[45%] shrink-0">
            {projectName(folder.path)}
          </Text>
          {parentLabel ? (
            <MiddleTruncate
              mode="path"
              title={folder.path}
              size="micro"
              tone="muted"
              className="min-w-0 flex-1"
            >
              {parentLabel}
            </MiddleTruncate>
          ) : (
            <span className="flex-1" />
          )}
          {!folder.exists ? (
            <Tooltip label={t("Folder not found. Imported as history only.")} asChild>
              <Text size="inherit" tone="muted" className="grid shrink-0 place-items-center">
                <CircleAlert aria-hidden className="icon-sm" />
              </Text>
            </Tooltip>
          ) : null}
          <Text
            size="micro"
            tone="muted"
            className="shrink-0 whitespace-nowrap text-end tabular-nums"
          >
            {chosen > 0 && !all
              ? `${formatNumber(chosen)} / ${formatNumber(folder.items.length)}`
              : formatNumber(folder.items.length)}
          </Text>
        </Button>
      </div>
      {open ? (
        <ul className="@container/import-rows pb-1">
          {folder.items.slice(0, limit).map((item) => {
            const key = candidateKey(item);
            const imported = isAlreadyImported(item, selection.stored);
            return (
              <ActionHost
                as="li"
                key={key}
                {...surfaceAttributes({ radius: "none" }, "[--control-padding-start:2.25rem]")}
              >
                <Checkbox
                  disabled={imported}
                  disabledReason={imported ? t("Already imported.") : undefined}
                  checked={imported || selection.selected.has(key)}
                  onChange={(event) => selection.onToggleKeys([key], event.target.checked)}
                  label={
                    <>
                      <OverflowTooltip label={item.firstPrompt}>
                        <Text size="caption" tone="inherit" truncate className="min-w-0 flex-1">
                          {item.firstPrompt}
                        </Text>
                      </OverflowTooltip>
                      {imported ? (
                        <Text size="micro" tone="muted" className="shrink-0">
                          {t("imported")}
                        </Text>
                      ) : isHistoryOnly(item) ? (
                        <Tooltip
                          label={t(
                            "Imported as history; sending a message starts a new conversation",
                          )}
                          asChild
                        >
                          <Text
                            size="inherit"
                            tone="muted"
                            className="grid shrink-0 place-items-center"
                          >
                            <Clock aria-hidden className="icon-sm" />
                          </Text>
                        </Tooltip>
                      ) : null}
                      {item.kind !== "interactive" ? (
                        <Text size="micro" tone="muted" className="shrink-0">
                          {item.kind === "exec" ? t("automation") : t("subagent")}
                        </Text>
                      ) : null}
                      <Text
                        size="micro"
                        tone="secondary"
                        className="shrink-0 whitespace-nowrap text-end"
                      >
                        {formatImportDate(item.lastAt)}
                      </Text>
                      <Text
                        size="micro"
                        tone="secondary"
                        className="shrink-0 whitespace-nowrap text-end @max-[480px]/import-rows:hidden"
                      >
                        {formatBytes(item.sizeBytes)}
                      </Text>
                    </>
                  }
                  padding={{ block: "sm", start: "md", end: "xl" }}
                  className={`flex min-w-0 flex-1 items-center gap-2.5 ${
                    imported ? "" : "cursor-pointer"
                  }`}
                />
              </ActionHost>
            );
          })}
          {folder.items.length > limit ? (
            <li className="ps-[calc(2rem+0.25rem)] pe-3 pt-1">
              <Button variant="ghost" type="button" onClick={() => setLimit(limit + ITEM_PAGE)}>
                {t("Show {p0} more", {
                  p0: formatNumber(Math.min(ITEM_PAGE, folder.items.length - limit)),
                })}
              </Button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}
