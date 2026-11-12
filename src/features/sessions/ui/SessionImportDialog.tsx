import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { ActionHost } from "../../../shared/ui/ActionHost";
import { Surface } from "../../../shared/ui/Surface";
import { Button } from "../../../shared/ui/Button";
import { ButtonGroup } from "../../../shared/ui/ButtonGroup";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { FilterTrigger } from "../../../shared/ui/FilterTrigger";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { MiddleTruncate } from "../../../shared/ui/MiddleTruncate";
import { Popover } from "../../../shared/ui/Popover";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Skeleton } from "../../../shared/ui/Skeleton";
import { Switch } from "../../../shared/ui/Switch";
import { useFormat, useLocale, useT } from "../../../shared/i18n";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  discoverImportableSessions,
  type DiscoveryReport,
  type ImportCandidate,
  type ImportProvider,
} from "../../../platform/tauri/sessionImport";
import { parentPath, prettyCwd, projectName } from "../../../shared/lib/paths";
import { ChevronDown, ChevronRight, CircleAlert, Clock, Folder } from "../../../shared/ui/icons";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { importedSessionKeys } from "../data/sessionStore";
import {
  candidateKey,
  countSelection,
  filterCandidates,
  formatBytes,
  groupByFolder,
  isAlreadyImported,
  isTemporaryFolder,
  type FolderGroup,
  type SessionImportContext,
} from "../import/importModel";
import {
  isUsableProjectFolder,
  previewProjectGroups,
  runSessionImport,
  type ImportProgress,
  type ImportSummary,
} from "../import/importRunner";
import { HarnessIcon } from "./HarnessIcon";
import { DoneView, RunningView, plural } from "./SessionImportResult";

type Props = {
  initialContext?: SessionImportContext;
  onClose: () => void;
  /** Sessions or projects were added; the app should reload what it shows. */
  onImported: () => void;
};

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; report: DiscoveryReport; stored: Set<string> };

type Run =
  | { status: "idle" }
  | { status: "running"; progress: ImportProgress }
  | { status: "done"; summary: ImportSummary };

const PROVIDERS: readonly ImportProvider[] = ["claude", "codex"];
const ALL_PROVIDERS: ReadonlySet<ImportProvider> = new Set(PROVIDERS);

const PROVIDER_LABEL: Record<ImportProvider, string> = {
  claude: "Claude Code",
  codex: "Codex",
};

/** Conversations rendered per open folder before "Show more"; keeps huge folders cheap to open. */
const ITEM_PAGE = 150;

/** Whether the chat will only be history, with no way to continue it. */
function isHistoryOnly(candidate: ImportCandidate): boolean {
  return !isUsableProjectFolder(candidate) || !candidate.resumable;
}

/** Drive roots (`G:/`) that hold conversations, busiest first. */
function driveRoots(candidates: readonly ImportCandidate[]): string[] {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    const drive = /^([A-Za-z]):/.exec(candidate.cwd)?.[1];
    if (!drive) continue;
    const root = `${drive.toUpperCase()}:/`;
    counts.set(root, (counts.get(root) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([root]) => root);
}

async function performImport({
  candidates,
  groupProjects,
  controller,
  abort,
  setRun,
  setLoad,
  onImported,
}: {
  candidates: ImportCandidate[];
  groupProjects: boolean;
  controller: AbortController;
  abort: { current: AbortController | null };
  setRun: (run: Run) => void;
  setLoad: (update: (current: Load) => Load) => void;
  onImported: () => void;
}) {
  const toImport = candidates;
  try {
    const summary = await runSessionImport({
      candidates: toImport,
      groupProjects,
      signal: controller.signal,
      onProgress: (progress) => setRun({ status: "running", progress }),
    });
    setRun({ status: "done", summary });
  } catch (error) {
    setRun({
      status: "done",
      summary: {
        imported: 0,
        skipped: 0,
        failed: [
          {
            candidate: toImport[0],
            error: error instanceof Error ? error.message : String(error),
          },
        ],
        cancelled: false,
        readOnly: 0,
        truncated: 0,
        projects: 0,
        groups: [],
      },
    });
  } finally {
    abort.current = null;
    // Imports already stored show as imported if the dialog stays open.
    const keys = await importedSessionKeys().catch(() => null);
    if (keys) {
      setLoad((current) =>
        current.status === "ready" ? { ...current, stored: new Set(keys) } : current,
      );
    }
    onImported();
  }
}

/**
 * Bring the conversations Claude Code and Codex stored on disk into Bycoda,
 * grouped by the folder each ran in. Nothing is touched until Import is
 * pressed, and the provider files are only ever read.
 */
export function SessionImportDialog({ onClose, onImported, initialContext }: Props) {
  const t = useT();
  const locale = useLocale();
  const { formatNumber } = useFormat();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [providers, setProviders] = useState<ReadonlySet<ImportProvider>>(
    () => new Set(initialContext ? [initialContext.provider] : PROVIDERS),
  );
  const [text, setText] = useState("");
  const deferredText = useDeferredValue(text);
  // "" means every folder.
  const [rootFilter, setRootFilter] = useState(initialContext?.cwd ?? "");
  const [showAutomation, setShowAutomation] = useState(false);
  const [hideTemporary, setHideTemporary] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterAnchor = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [missingOpen, setMissingOpen] = useState(false);
  const [groupProjects, setGroupProjects] = useState(true);
  const [run, setRun] = useState<Run>({ status: "idle" });
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([discoverImportableSessions(), importedSessionKeys()])
      .then(([report, keys]) => {
        if (cancelled) return;
        const stored = new Set(keys);
        setLoad({ status: "ready", report, stored });
        // Everything a person had a conversation in, not yet imported. Folders that are gone
        // and scratch folders start unselected; the decision to import them stays with the user.
        setSelected(
          new Set(
            filterCandidates(report.candidates, {
              providers: new Set(initialContext ? [initialContext.provider] : PROVIDERS),
              root: initialContext?.cwd ?? null,
              text: "",
              showAutomation: false,
            })
              .filter(
                (candidate) =>
                  candidate.kind === "interactive" &&
                  candidate.cwdExists &&
                  !isTemporaryFolder(candidate.cwd) &&
                  !isAlreadyImported(candidate, stored),
              )
              .map(candidateKey),
          ),
        );
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoad({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
      abort.current?.abort();
    };
  }, [initialContext]);

  const report = load.status === "ready" ? load.report : null;
  const stored = load.status === "ready" ? load.stored : EMPTY;
  const roots = useMemo(() => (report ? driveRoots(report.candidates) : []), [report]);
  const rootOptions = [
    { value: "", label: t("All folders") },
    ...(initialContext
      ? [{ value: initialContext.cwd, label: prettyCwd(initialContext.cwd) }]
      : []),
    ...(roots.length > 1
      ? roots
          .filter((root) => root !== initialContext?.cwd)
          .map((root) => ({ value: root, label: root.replace("/", "\\") }))
      : []),
  ];
  // Conversations that match everything except the provider toggle, so each toggle can show its count.
  const matched = useMemo(
    () =>
      report
        ? filterCandidates(report.candidates, {
            providers: ALL_PROVIDERS,
            text: deferredText,
            root: rootFilter || null,
            showAutomation,
          })
        : [],
    [report, deferredText, rootFilter, showAutomation],
  );
  const { visible, providerCounts, temporaryCount } = useMemo(() => {
    const temporary = new Set<ImportCandidate>();
    for (const candidate of matched) if (isTemporaryFolder(candidate.cwd)) temporary.add(candidate);
    const scoped = hideTemporary
      ? matched.filter((candidate) => !temporary.has(candidate))
      : matched;
    const byProvider: Record<ImportProvider, number> = { claude: 0, codex: 0 };
    for (const candidate of scoped) byProvider[candidate.provider] += 1;
    return {
      visible: scoped.filter((candidate) => providers.has(candidate.provider)),
      providerCounts: byProvider,
      temporaryCount: temporary.size,
    };
  }, [matched, hideTemporary, providers]);
  const folders = useMemo(() => groupByFolder(visible), [visible]);
  const presentFolders = folders.filter((folder) => folder.exists);
  const missingFolders = folders.filter((folder) => !folder.exists);
  const counts = useMemo(
    () => countSelection(visible, selected, stored),
    [visible, selected, stored],
  );
  const toImport = useMemo(
    () =>
      visible.filter(
        (candidate) =>
          selected.has(candidateKey(candidate)) && !isAlreadyImported(candidate, stored),
      ),
    [visible, selected, stored],
  );
  const groupPreview = useMemo(
    () => (groupProjects ? previewProjectGroups(toImport) : []),
    [groupProjects, toImport],
  );
  const visibleKeys = new Set(visible.map(candidateKey));
  let hiddenSelected = 0;
  for (const key of selected) if (!visibleKeys.has(key)) hiddenSelected += 1;

  const running = run.status === "running";
  const searching = deferredText.trim() !== "";
  const autoExpand = folders.length <= 6 || searching;
  const filterCount = (showAutomation ? 1 : 0) + (hideTemporary ? 0 : 1);
  const filtering =
    providers.size !== PROVIDERS.length || rootFilter !== "" || searching || filterCount > 0;

  const toggleKeys = (keys: string[], on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  const selectable = (items: ImportCandidate[]) =>
    items.filter((item) => !isAlreadyImported(item, stored)).map(candidateKey);
  const toggleOpen = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const resetFilters = () => {
    setShowAutomation(false);
    setHideTemporary(true);
  };
  const resetAll = () => {
    resetFilters();
    setProviders(new Set(PROVIDERS));
    setRootFilter("");
    setText("");
  };

  const shownKeys = selectable(visible);
  const shownChosen = shownKeys.filter((key) => selected.has(key)).length;
  const missingKeys = selectable(missingFolders.flatMap((folder) => folder.items));
  const missingChosen = missingKeys.filter((key) => selected.has(key)).length;

  const start = async () => {
    if (toImport.length === 0 || running) return;
    const controller = new AbortController();
    abort.current = controller;
    setRun({
      status: "running",
      progress: {
        total: toImport.length,
        done: 0,
        imported: 0,
        skipped: 0,
        failed: [],
        current: null,
      },
    });
    await performImport({
      candidates: toImport,
      groupProjects,
      controller,
      abort,
      setRun,
      setLoad,
      onImported,
    });
  };

  return (
    <Modal
      title={t("Import Claude Code and Codex sessions")}
      description={t(
        "Conversations from the terminal, listed by the folder they ran in. The originals are never changed.",
      )}
      size="lg"
      fitViewport
      // Closing mid-import would only look like it stopped; Cancel says so.
      onClose={running ? () => undefined : onClose}
      footer={
        report && run.status === "idle" ? (
          <ModalActions>
            <Button variant="ghost" type="button" onClick={onClose}>
              {t("Close")}
            </Button>
            <Button
              variant="primary"
              type="button"
              stableWidth
              disabled={counts.toImport === 0}
              onClick={() => void start()}
            >
              {t("Import")} {counts.toImport > 0 ? counts.toImport.toLocaleString(locale) : ""}
            </Button>
          </ModalActions>
        ) : run.status === "running" ? (
          <ModalActions>
            <Button variant="ghost" type="button" onClick={() => abort.current?.abort()}>
              {t("Cancel")}
            </Button>
          </ModalActions>
        ) : run.status === "done" ? (
          <ModalActions>
            <Button variant="primary" type="button" onClick={onClose}>
              {t("Done")}
            </Button>
          </ModalActions>
        ) : undefined
      }
    >
      <div className="flex min-h-0 flex-col gap-3">
        {load.status === "loading" ? (
          <div className="flex flex-col gap-2 py-4">
            <Text role="status" as="p" size="secondary" tone="secondary" className="text-center">
              {t("Scanning Claude Code and Codex history…")}
            </Text>
            {[0, 1, 2, 3, 4].map((row) => (
              <Skeleton key={row} aria-hidden className="h-7 w-full" />
            ))}
          </div>
        ) : null}
        {load.status === "error" ? (
          <Text as="p" size="secondary" tone="danger" className="py-10 text-center">
            {t("Could not read the history: ")}
            {load.message}
          </Text>
        ) : null}

        {report && run.status === "idle" ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <ButtonGroup aria-label={t("Providers")}>
                {PROVIDERS.map((provider) => {
                  const on = providers.has(provider);
                  return (
                    <Button
                      variant="secondary"
                      key={provider}
                      type="button"
                      pressed={on}
                      onClick={() =>
                        setProviders((current) => {
                          const next = new Set(current);
                          if (next.has(provider)) next.delete(provider);
                          else next.add(provider);
                          return next;
                        })
                      }
                    >
                      <HarnessIcon harness={provider} className="size-3" />
                      {PROVIDER_LABEL[provider]}
                      <Text size="inherit" tone="muted" className="tabular-nums">
                        {providerCounts[provider].toLocaleString(locale)}
                      </Text>
                    </Button>
                  );
                })}
              </ButtonGroup>
              {rootOptions.length > 1 ? (
                <SearchableSelect
                  hideLabel
                  label={t("Root folder")}
                  value={rootFilter}
                  options={rootOptions}
                  onChange={setRootFilter}
                />
              ) : null}
              <SearchInput
                appearance="field"
                type="search"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={t("Filter by prompt or folder")}
                aria-label={t("Filter conversations")}
                containerClassName="ml-auto min-w-40 flex-1 sm:max-w-64"
              />
              <FilterTrigger
                ref={filterAnchor}
                label={t("Conversation filters")}
                activeCount={filterCount}
                onReset={resetFilters}
                aria-haspopup="dialog"
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen((open) => !open)}
              />
              {filtersOpen ? (
                <Popover
                  anchor={filterAnchor}
                  role="dialog"
                  aria-label={t("Conversation filters")}
                  align="end"
                  width={320}
                  autoFocus
                  onDismiss={() => setFiltersOpen(false)}
                  className="flex flex-col gap-1 p-2"
                >
                  <ToggleRow
                    label={t("Show automation runs")}
                    description={t("Non-interactive runs and subagent threads.")}
                    checked={showAutomation}
                    onChange={setShowAutomation}
                  />
                  <ToggleRow
                    label={t("Hide temporary folders")}
                    description={
                      temporaryCount > 0
                        ? t("{p0} in scratch folders. They are never deleted.", {
                            p0: plural(formatNumber, temporaryCount, "conversation"),
                          })
                        : t("Scratch folders such as the system temp directory.")
                    }
                    checked={hideTemporary}
                    onChange={setHideTemporary}
                  />
                  <div className="flex justify-end pt-1">
                    <Button
                      variant="ghost"
                      type="button"
                      disabled={filterCount === 0}
                      onClick={resetFilters}
                    >
                      {t("Reset filters")}
                    </Button>
                  </div>
                </Popover>
              ) : null}
            </div>

            <Surface
              variant="outline"
              padding="none"
              className="flex min-h-0 flex-col overflow-hidden"
            >
              <Text
                as="div"
                size="micro"
                tone="secondary"
                {...surfaceAttributes(
                  { frame: "neutral", edge: "bottom" },
                  "flex items-center gap-2.5  border-(--ui-tone-neutral-border) px-3 py-1.5",
                )}
              >
                <Checkbox
                  aria-label={t("Select all shown")}
                  disabled={shownKeys.length === 0}
                  checked={shownKeys.length > 0 && shownChosen === shownKeys.length}
                  indeterminate={shownChosen > 0 && shownChosen < shownKeys.length}
                  onChange={() =>
                    toggleKeys(
                      shownChosen === shownKeys.length ? visible.map(candidateKey) : shownKeys,
                      shownChosen !== shownKeys.length,
                    )
                  }
                />
                <Text size="inherit" tone="inherit" truncate className="min-w-0 flex-1">
                  {plural(formatNumber, folders.length, "folder")} ·{" "}
                  {plural(formatNumber, visible.length, "conversation")}
                  {report.candidates.length !== visible.length
                    ? t(" (of {p0})", { p0: report.candidates.length.toLocaleString(locale) })
                    : ""}
                </Text>
              </Text>
              <div className="max-h-[42vh] min-h-32 overflow-y-auto">
                {folders.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                    <Text as="p" size="caption" tone="secondary">
                      {report.candidates.length === 0
                        ? t("No Claude Code or Codex conversations were found on this computer.")
                        : t("Nothing matches these filters.")}
                    </Text>
                    {report.candidates.length > 0 && filtering ? (
                      <Button variant="secondary" type="button" onClick={resetAll}>
                        {t("Reset filters")}
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <>
                    {presentFolders.map((folder) => (
                      <FolderSection
                        key={folder.key}
                        folder={folder}
                        stored={stored}
                        selected={selected}
                        open={autoExpand || expanded.has(folder.key)}
                        onToggleOpen={() => toggleOpen(folder.key)}
                        onToggleKeys={toggleKeys}
                        selectable={selectable}
                      />
                    ))}
                    {missingFolders.length > 0 ? (
                      <section className="border-t border-(--ui-tone-neutral-border)">
                        <div className="flex items-center gap-2 px-3 py-0.5">
                          <Checkbox
                            aria-label={t("Select all missing folders")}
                            disabled={missingKeys.length === 0}
                            checked={missingKeys.length > 0 && missingChosen === missingKeys.length}
                            indeterminate={missingChosen > 0 && missingChosen < missingKeys.length}
                            onChange={(event) => toggleKeys(missingKeys, event.target.checked)}
                          />
                          <Button
                            variant="ghost"
                            type="button"
                            align="start"
                            aria-expanded={missingOpen || searching}
                            onClick={() => setMissingOpen((value) => !value)}
                            className="min-w-0 flex-1"
                          >
                            {missingOpen || searching ? (
                              <ChevronDown className="icon-sm shrink-0" tone="secondary" />
                            ) : (
                              <ChevronRight className="icon-sm shrink-0" tone="secondary" />
                            )}
                            <Text
                              size="secondary"
                              tone="secondary"
                              truncate
                              className="min-w-0 flex-1"
                            >
                              {t("Missing folders ({p0})", {
                                p0: missingFolders.length.toLocaleString(locale),
                              })}
                            </Text>
                          </Button>
                        </div>
                        {missingOpen || searching
                          ? missingFolders.map((folder) => (
                              <FolderSection
                                key={folder.key}
                                folder={folder}
                                stored={stored}
                                selected={selected}
                                open={autoExpand || expanded.has(folder.key)}
                                onToggleOpen={() => toggleOpen(folder.key)}
                                onToggleKeys={toggleKeys}
                                selectable={selectable}
                              />
                            ))
                          : null}
                      </section>
                    ) : null}
                  </>
                )}
              </div>
            </Surface>

            <div className="flex flex-col gap-2.5 border-t border-(--ui-tone-neutral-border) pt-3">
              <div className="flex min-w-0 items-center gap-2">
                <Switch
                  label={t("Group new projects in the sidebar by their parent folder")}
                  checked={groupProjects}
                  onCheckedChange={setGroupProjects}
                />
                {groupProjects ? (
                  <>
                    <Text size="micro" tone="muted" className="shrink-0">
                      {groupPreview.length === 0
                        ? t("No groups")
                        : plural(formatNumber, groupPreview.length, "group")}
                    </Text>
                    <InfoPopover label={t("Sidebar groups")}>
                      <p>
                        {groupPreview.length === 0
                          ? t("No groups: no folder has two or more projects to group.")
                          : groupPreview
                              .map((group) => `${group.name} (${group.count})`)
                              .join(" · ")}
                      </p>
                    </InfoPopover>
                  </>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Text
                  as="p"
                  size="caption"
                  tone="secondary"
                  leading="snug"
                  className="min-w-0 flex-1"
                >
                  {counts.toImport === 0
                    ? t("Nothing selected to import.")
                    : t("{p0} in {p1} will be imported ({p2} on disk).", {
                        p0: plural(formatNumber, counts.toImport, "conversation"),
                        p1: plural(formatNumber, counts.folders, "folder"),
                        p2: formatBytes(counts.bytes),
                      })}
                  {counts.alreadyImported > 0
                    ? t(" {p0} already imported will be skipped.", {
                        p0: plural(formatNumber, counts.alreadyImported, "conversation"),
                      })
                    : ""}
                  {hiddenSelected > 0 ? (
                    <Text size="inherit" tone="muted">
                      {" "}
                      {t("{p0} hidden by filters will not be imported.", {
                        p0: hiddenSelected.toLocaleString(locale),
                      })}
                    </Text>
                  ) : null}
                </Text>
                <InfoPopover label={t("Scan details")}>
                  <p>
                    {t("Scanned {p0} files in {p1} ms.", {
                      p0: report.filesScanned.toLocaleString(locale),
                      p1: report.elapsedMs.toLocaleString(locale),
                    })}
                  </p>
                  <p>{t("Conversations hidden by a filter are not imported.")}</p>
                </InfoPopover>
              </div>
            </div>
          </>
        ) : null}

        {run.status === "running" ? <RunningView progress={run.progress} /> : null}
        {run.status === "done" ? <DoneView summary={run.summary} /> : null}
      </div>
    </Modal>
  );
}

const EMPTY: ReadonlySet<string> = new Set();

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <ActionHost className="rounded-lg">
      <Switch
        className="w-full min-w-0 flex-1 px-2 py-1.5"
        label={label}
        labelPosition="start"
        description={description}
        checked={checked}
        onCheckedChange={onChange}
      />
    </ActionHost>
  );
}

function FolderSection({
  folder,
  stored,
  selected,
  open,
  onToggleOpen,
  onToggleKeys,
  selectable,
}: {
  folder: FolderGroup;
  stored: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  open: boolean;
  onToggleOpen: () => void;
  onToggleKeys: (keys: string[], on: boolean) => void;
  selectable: (items: ImportCandidate[]) => string[];
}) {
  const t = useT();
  const locale = useLocale();
  const { formatImportDate } = useFormat();
  const [limit, setLimit] = useState(ITEM_PAGE);
  const keys = selectable(folder.items);
  const chosen = keys.filter((key) => selected.has(key)).length;
  const parent = parentPath(folder.path);
  const parentLabel = parent && parent !== folder.path ? prettyCwd(parent) : "";

  return (
    // Offscreen folders skip layout and paint, so ~3k conversations stay cheap to scroll and filter.
    <section className="border-b border-(--ui-tone-neutral-border) [contain-intrinsic-size:auto_36px] [content-visibility:auto] last:border-b-0">
      <div className="flex items-center gap-2 px-3 py-0.5">
        <Checkbox
          aria-label={t("Select every conversation in {p0}", { p0: folder.path })}
          disabled={keys.length === 0}
          checked={keys.length > 0 && chosen === keys.length}
          indeterminate={chosen > 0 && chosen < keys.length}
          onChange={(event) => onToggleKeys(keys, event.target.checked)}
        />
        <Button
          variant="ghost"
          type="button"
          align="start"
          aria-expanded={open}
          onClick={onToggleOpen}
          className="min-w-0 flex-1"
        >
          {open ? (
            <ChevronDown className="icon-sm shrink-0" tone="secondary" />
          ) : (
            <ChevronRight className="icon-sm shrink-0" tone="secondary" />
          )}
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
            <Text
              size="inherit"
              tone="muted"
              className="grid shrink-0 place-items-center"
              title={t("Folder not found. Imported as history only.")}
            >
              <CircleAlert aria-hidden className="icon-sm" />
            </Text>
          ) : null}
          <Text size="micro" tone="muted" className="w-16 shrink-0 text-right tabular-nums">
            {chosen > 0 && chosen < keys.length
              ? `${chosen.toLocaleString(locale)} / ${folder.items.length.toLocaleString(locale)}`
              : folder.items.length.toLocaleString(locale)}
          </Text>
        </Button>
      </div>
      {open ? (
        <ul className="pb-1">
          {folder.items.slice(0, limit).map((item) => {
            const key = candidateKey(item);
            const imported = isAlreadyImported(item, stored);
            return (
              <ActionHost as="li" key={key} className="rounded-none">
                <Checkbox
                  disabled={imported}
                  checked={imported || selected.has(key)}
                  onChange={(event) => onToggleKeys([key], event.target.checked)}
                  label={
                    <>
                      <span
                        title={PROVIDER_LABEL[item.provider]}
                        className="grid shrink-0 place-items-center"
                      >
                        <HarnessIcon harness={item.provider} className="size-3.5" />
                      </span>
                      <Text size="caption" tone="inherit" truncate className="min-w-0 flex-1">
                        {item.firstPrompt}
                      </Text>
                      {imported ? (
                        <Text size="micro" tone="muted" className="shrink-0">
                          {t("imported")}
                        </Text>
                      ) : isHistoryOnly(item) ? (
                        <Text
                          size="inherit"
                          tone="muted"
                          className="grid shrink-0 place-items-center"
                          title={t(
                            "Imported as history; sending a message starts a new conversation",
                          )}
                        >
                          <Clock aria-hidden className="icon-sm" />
                        </Text>
                      ) : null}
                      {item.kind !== "interactive" ? (
                        <Text size="micro" tone="muted" className="shrink-0">
                          {item.kind === "exec" ? t("automation") : t("subagent")}
                        </Text>
                      ) : null}
                      <Text size="micro" tone="secondary" className="w-24 shrink-0 text-right">
                        {formatImportDate(item.lastAt)}
                      </Text>
                      <Text size="micro" tone="secondary" className="w-14 shrink-0 text-right">
                        {formatBytes(item.sizeBytes)}
                      </Text>
                    </>
                  }
                  className={`flex min-w-0 flex-1 items-center gap-2.5 py-1.5 pl-9 pr-3 ${
                    imported ? "" : "cursor-pointer"
                  }`}
                />
              </ActionHost>
            );
          })}
          {folder.items.length > limit ? (
            <li className="pl-9 pr-3 pt-1">
              <Button variant="ghost" type="button" onClick={() => setLimit(limit + ITEM_PAGE)}>
                {t("Show {p0} more", {
                  p0: Math.min(ITEM_PAGE, folder.items.length - limit).toLocaleString(locale),
                })}
              </Button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}
