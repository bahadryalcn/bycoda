import { errorText } from "../../../shared/lib/errors";
import { presentRemoteError } from "../../connections/public/remoteFailure";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { ActionHost } from "../../../shared/ui/ActionHost";
import { Surface } from "../../../shared/ui/Surface";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { FilterTrigger } from "../../../shared/ui/FilterTrigger";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Popover } from "../../../shared/ui/Popover";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { SkeletonList } from "../../../shared/ui/SkeletonList";
import { Switch } from "../../../shared/ui/Switch";
import { useLocale, useT } from "../../../shared/i18n";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  IMPORT_PROVIDERS,
  discoverImportableSessions,
  type DiscoveryReport,
  type ImportCandidate,
} from "../../../platform/tauri/sessionImport";
import { prettyCwd } from "../../../shared/lib/paths";
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
  type SessionImportContext,
} from "../import/importModel";
import {
  previewProjectGroups,
  runSessionImport,
  type ImportProgress,
  type ImportSummary,
} from "../import/importRunner";
import { DoneView, RunningView, importCount } from "./SessionImportResult";
import { ProviderSection } from "./SessionImportList";

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

const ALL_PROVIDERS = new Set(IMPORT_PROVIDERS);
/** With this many providers or fewer, every provider group starts open. */
const OPEN_PROVIDER_GROUPS = 2;

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
            error: presentRemoteError(error, { explicit: true }),
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
 * Bring the conversations provider CLIs stored on disk into Bycoda, grouped by
 * provider and then by the folder each ran in. Nothing is touched until Import
 * is pressed, and the provider files are only ever read.
 */
export function SessionImportDialog({ onClose, onImported, initialContext }: Props) {
  const t = useT();
  const locale = useLocale();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [text, setText] = useState("");
  const deferredText = useDeferredValue(text);
  // "" means every folder.
  const [rootFilter, setRootFilter] = useState(initialContext?.cwd ?? "");
  const [showAutomation, setShowAutomation] = useState(false);
  const [hideTemporary, setHideTemporary] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterAnchor = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
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
              providers: initialContext ? new Set([initialContext.provider]) : ALL_PROVIDERS,
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
            message: errorText(error),
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
  const { visible, temporaryCount } = useMemo(() => {
    const temporary = new Set<ImportCandidate>();
    for (const candidate of matched) if (isTemporaryFolder(candidate.cwd)) temporary.add(candidate);
    return {
      visible: hideTemporary ? matched.filter((candidate) => !temporary.has(candidate)) : matched,
      temporaryCount: temporary.size,
    };
  }, [matched, hideTemporary]);
  const folders = useMemo(() => groupByFolder(visible), [visible]);
  // Providers in the order the dialog lists them, each with its visible conversations.
  const groups = useMemo(
    () =>
      IMPORT_PROVIDERS.map((provider) => ({
        provider,
        items: visible.filter((candidate) => candidate.provider === provider),
      })).filter((group) => group.items.length > 0),
    [visible],
  );
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
  const filterCount = (showAutomation ? 1 : 0) + (hideTemporary ? 0 : 1);
  const filtering = rootFilter !== "" || searching || filterCount > 0;

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
  const resetFilters = () => {
    setShowAutomation(false);
    setHideTemporary(true);
  };
  const resetAll = () => {
    resetFilters();
    setRootFilter("");
    setText("");
  };

  const shownKeys = selectable(visible);
  const shownChosen = shownKeys.filter((key) => selected.has(key)).length;

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
      title={t("Import sessions")}
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
              disabledReason={t("Select at least one conversation to import.")}
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
            <LoadingText layout="fill" inset="none" size="secondary" delay={false}>
              {t("Scanning conversation history…")}
            </LoadingText>
            <SkeletonList rows={5} framed leading="icon" trailing="text" seed={9} />
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
                aria-label={t("Filter sessions")}
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
                  kind="dialog"
                  aria-label={t("Conversation filters")}
                  align="end"
                  width={320}
                  onDismiss={() => setFiltersOpen(false)}
                  variant="compact"
                  className="flex flex-col gap-1"
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
                            p0: importCount(t, temporaryCount, "conversation"),
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
                      disabledReason={t("No filters are active.")}
                      onClick={resetFilters}
                    >
                      {t("Reset filters")}
                    </Button>
                  </div>
                </Popover>
              ) : null}
            </div>

            <Surface
              variant="card"
              padding="none"
              className="flex min-h-0 flex-col overflow-hidden"
            >
              <Text
                as="div"
                size="micro"
                tone="secondary"
                {...surfaceAttributes(
                  { frame: "pane", edge: "bottom" },
                  "flex items-center gap-2.5  border-(--ui-tone-neutral-border) px-3 py-1.5",
                )}
              >
                <Checkbox
                  aria-label={t("Select all shown")}
                  disabled={shownKeys.length === 0}
                  disabledReason={t("No conversations to select.")}
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
                  {importCount(t, folders.length, "folder")} ·{" "}
                  {importCount(t, visible.length, "conversation")}
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
                        ? t(
                            "No conversations from supported coding agents were found on this computer.",
                          )
                        : t("Nothing matches these filters.")}
                    </Text>
                    {report.candidates.length > 0 && filtering ? (
                      <Button variant="secondary" type="button" onClick={resetAll}>
                        {t("Reset filters")}
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  groups.map((group, index) => (
                    <ProviderSection
                      key={group.provider}
                      provider={group.provider}
                      items={group.items}
                      // `/resume` opens its own provider; the rest stay closed and unselected.
                      defaultOpen={
                        initialContext
                          ? group.provider === initialContext.provider
                          : groups.length <= OPEN_PROVIDER_GROUPS
                      }
                      searching={searching}
                      divider={index < groups.length - 1}
                      selection={{ stored, selected, onToggleKeys: toggleKeys, selectable }}
                    />
                  ))
                )}
              </div>
            </Surface>

            <div
              {...surfaceAttributes({ frame: "pane", edge: "top" }, "flex flex-col gap-2.5 pt-3")}
            >
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
                        : importCount(t, groupPreview.length, "group")}
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
                        p0: importCount(t, counts.toImport, "conversation"),
                        p1: importCount(t, counts.folders, "folder"),
                        p2: formatBytes(counts.bytes),
                      })}
                  {counts.alreadyImported > 0
                    ? t(" {p0} already imported will be skipped.", {
                        p0: importCount(t, counts.alreadyImported, "conversation"),
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
    <ActionHost {...surfaceAttributes({ radius: "card" })}>
      <Switch
        className="w-full min-w-0 flex-1"
        padding={{ inline: "md", block: "sm" }}
        label={label}
        labelPosition="start"
        description={description}
        checked={checked}
        onCheckedChange={onChange}
      />
    </ActionHost>
  );
}
