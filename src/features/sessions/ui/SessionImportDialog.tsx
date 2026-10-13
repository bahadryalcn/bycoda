import { t, useLocale, getLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  discoverImportableSessions,
  type DiscoveryReport,
  type ImportCandidate,
  type ImportProvider,
} from "../../../platform/tauri/sessionImport";
import { prettyCwd } from "../../../shared/lib/paths";
import { ChevronDown, ChevronRight, Folder } from "../../../shared/ui/icons";
import { Modal } from "../../../shared/ui/Modal";
import { importedSessionKeys } from "../data/sessionStore";
import {
  candidateKey,
  countSelection,
  dominantRoot,
  filterCandidates,
  formatBytes,
  groupByFolder,
  isAlreadyImported,
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

const PROVIDER_LABEL: Record<ImportProvider, string> = {
  claude: "Claude Code",
  codex: "Codex",
};

const checkbox = "size-3.5 shrink-0 accent-accent";
const chip =
  "rounded-md border px-2 py-0.5 text-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-accent";

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString(getLocale())} ${count === 1 ? one : many}`;
}

function formatDate(at: number): string {
  if (!at) return "unknown date";
  return new Date(at).toLocaleDateString(getLocale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Whether the chat will only be history, with no way to continue it. */
function isHistoryOnly(candidate: ImportCandidate): boolean {
  return !isUsableProjectFolder(candidate) || !candidate.resumable;
}

/**
 * Bring the conversations Claude Code and Codex stored on disk into Bycoda,
 * grouped by the folder each ran in. Nothing is touched until Import is
 * pressed, and the provider files are only ever read.
 */
export function SessionImportDialog({ onClose, onImported, initialContext }: Props) {
  useLocale();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [providers, setProviders] = useState<ReadonlySet<ImportProvider>>(
    () => new Set(initialContext ? [initialContext.provider] : ["claude", "codex"]),
  );
  const [text, setText] = useState("");
  const [onlyRoot, setOnlyRoot] = useState(!!initialContext);
  const [showAutomation, setShowAutomation] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
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
        // Everything a person had a conversation in, not yet imported.
        setSelected(
          new Set(
            filterCandidates(report.candidates, {
              providers: new Set(initialContext ? [initialContext.provider] : ["claude", "codex"]),
              root: initialContext?.cwd ?? null,
              text: "",
              showAutomation: false,
            })
              .filter(
                (candidate) =>
                  candidate.kind === "interactive" && !isAlreadyImported(candidate, stored),
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
  const root = useMemo(
    () => initialContext?.cwd ?? (report ? dominantRoot(report.candidates) : null),
    [report, initialContext?.cwd],
  );
  const visible = useMemo(
    () =>
      report
        ? filterCandidates(report.candidates, {
            providers,
            text,
            root: onlyRoot ? root : null,
            showAutomation,
          })
        : [],
    [report, providers, text, onlyRoot, root, showAutomation],
  );
  const folders = useMemo(() => groupByFolder(visible), [visible]);
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

  const running = run.status === "running";
  const autoExpand = folders.length <= 6 || text.trim() !== "";

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
    >
      <div className="flex min-h-0 flex-col gap-3 p-4 pt-3">
        {load.status === "loading" ? (
          <p className="py-10 text-center text-[13px] text-content/55">
            {t("Scanning Claude Code and Codex history…")}
          </p>
        ) : null}
        {load.status === "error" ? (
          <p className="py-10 text-center text-[13px] text-red-400">
            {t("Could not read the history: ")}
            {load.message}
          </p>
        ) : null}

        {report && run.status === "idle" ? (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              {(["claude", "codex"] as const).map((provider) => {
                const on = providers.has(provider);
                return (
                  <button
                    key={provider}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setProviders((current) => {
                        const next = new Set(current);
                        if (next.has(provider)) next.delete(provider);
                        else next.add(provider);
                        return next;
                      })
                    }
                    className={`${chip} flex items-center gap-1.5 ${
                      on
                        ? "border-content/25 bg-content/10 text-content"
                        : "border-content/10 text-content/45 hover:text-content"
                    }`}
                  >
                    <HarnessIcon harness={provider} className="size-3" />
                    {PROVIDER_LABEL[provider]}
                  </button>
                );
              })}
              {root ? (
                <button
                  type="button"
                  aria-pressed={onlyRoot}
                  onClick={() => setOnlyRoot((value) => !value)}
                  className={`${chip} ${
                    onlyRoot
                      ? "border-content/25 bg-content/10 text-content"
                      : "border-content/10 text-content/45 hover:text-content"
                  }`}
                >
                  {t("Only under ")}
                  {root.replace("/", "\\")}
                </button>
              ) : null}
              <label className="flex items-center gap-1.5 px-1.5 text-[11px] text-content/65">
                <input
                  type="checkbox"
                  className={checkbox}
                  checked={showAutomation}
                  onChange={(event) => setShowAutomation(event.target.checked)}
                />
                {t("Show automation runs")}
              </label>
              <input
                type="search"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={t("Filter by prompt or folder")}
                aria-label={t("Filter conversations")}
                className="ml-auto min-w-40 flex-1 rounded-md border border-content/15 bg-content/3 px-2.5 py-1 text-[12px] outline-none focus:border-content/35 sm:max-w-64"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 text-[11px] text-content/55">
              <button
                type="button"
                className="hover:text-content"
                onClick={() => toggleKeys(selectable(visible), true)}
              >
                {t("Select all shown")}
              </button>
              <button
                type="button"
                className="hover:text-content"
                onClick={() => toggleKeys(visible.map(candidateKey), false)}
              >
                {t("Clear selection")}
              </button>
              <span className="ml-auto">
                {plural(visible.length, "conversation")}
                {t(" in")} {plural(folders.length, "folder")}
                {report.candidates.length !== visible.length
                  ? t(" (of {p0})", { p0: report.candidates.length.toLocaleString(getLocale()) })
                  : ""}
              </span>
            </div>

            <div className="max-h-[46vh] min-h-32 overflow-y-auto rounded-xl border border-content/10 bg-content/3">
              {folders.length === 0 ? (
                <p className="px-4 py-8 text-center text-[12px] text-content/45">
                  {report.candidates.length === 0
                    ? t("No Claude Code or Codex conversations were found on this computer.")
                    : t("Nothing matches these filters.")}
                </p>
              ) : (
                folders.map((folder) => (
                  <FolderSection
                    key={folder.key}
                    folder={folder}
                    stored={stored}
                    selected={selected}
                    open={autoExpand || expanded.has(folder.key)}
                    onToggleOpen={() =>
                      setExpanded((current) => {
                        const next = new Set(current);
                        if (next.has(folder.key)) next.delete(folder.key);
                        else next.add(folder.key);
                        return next;
                      })
                    }
                    onToggleKeys={toggleKeys}
                    selectable={selectable}
                  />
                ))
              )}
            </div>

            <div className="flex flex-col gap-2 rounded-xl border border-content/10 bg-content/3 px-3 py-2.5">
              <label className="flex items-center gap-2 text-[12px] text-content/80">
                <input
                  type="checkbox"
                  className={checkbox}
                  checked={groupProjects}
                  onChange={(event) => setGroupProjects(event.target.checked)}
                />
                {t("Group new projects in the sidebar by their parent folder")}
              </label>
              {groupProjects ? (
                <p className="pl-5 text-[11px] leading-relaxed text-content/50">
                  {groupPreview.length === 0
                    ? t("No groups: no folder has two or more projects to group.")
                    : groupPreview.map((group) => `${group.name} (${group.count})`).join(" · ")}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <p className="min-w-0 flex-1 text-[12px] leading-snug text-content/65">
                {counts.toImport === 0
                  ? t("Nothing selected to import.")
                  : t("{p0} in {p1} will be imported ({p2} on disk).", {
                      p0: plural(counts.toImport, "conversation"),
                      p1: plural(counts.folders, "folder"),
                      p2: formatBytes(counts.bytes),
                    })}
                {counts.alreadyImported > 0
                  ? t(" {p0} already imported will be skipped.", {
                      p0: plural(counts.alreadyImported, "conversation"),
                    })
                  : ""}
                <span className="block text-[11px] text-content/40">
                  {t("Scanned ")}
                  {report.filesScanned.toLocaleString(getLocale())}
                  {t(" files in")} {report.elapsedMs.toLocaleString(getLocale())}
                  {t(" ms. Conversations hidden by a filter are not imported.")}
                </span>
              </p>
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/8 hover:text-content"
                onClick={onClose}
              >
                {t("Close")}
              </button>
              <button
                type="button"
                disabled={counts.toImport === 0}
                onClick={() => void start()}
                className="rounded-md bg-selection px-3 py-1.5 text-[12px] font-medium hover:bg-selection-hover disabled:opacity-40"
              >
                {t("Import")}{" "}
                {counts.toImport > 0 ? counts.toImport.toLocaleString(getLocale()) : ""}
              </button>
            </div>
          </>
        ) : null}

        {run.status === "running" ? (
          <RunningView progress={run.progress} onCancel={() => abort.current?.abort()} />
        ) : null}
        {run.status === "done" ? <DoneView summary={run.summary} onClose={onClose} /> : null}
      </div>
    </Modal>
  );
}

const EMPTY: ReadonlySet<string> = new Set();

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
  useLocale();
  const keys = selectable(folder.items);
  const chosen = keys.filter((key) => selected.has(key)).length;
  const header = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (header.current) {
      header.current.indeterminate = chosen > 0 && chosen < keys.length;
    }
  }, [chosen, keys.length]);

  return (
    <section className="border-b border-content/5 last:border-b-0">
      <div className="flex items-center gap-2 px-3 py-2">
        <input
          ref={header}
          type="checkbox"
          className={checkbox}
          aria-label={t("Select every conversation in {p0}", { p0: folder.path })}
          disabled={keys.length === 0}
          checked={keys.length > 0 && chosen === keys.length}
          onChange={(event) => onToggleKeys(keys, event.target.checked)}
        />
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggleOpen}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {open ? (
            <ChevronDown className="size-3.5 shrink-0 text-content/45" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-content/45" />
          )}
          <Folder className="size-3.5 shrink-0 text-content/55" />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
            {prettyCwd(folder.path)}
          </span>
          {!folder.exists ? (
            <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-500">
              {t("missing folder")}
            </span>
          ) : null}
          <span className="shrink-0 text-[11px] text-content/45">
            {chosen > 0 ? t("{p0} of ", { p0: chosen }) : ""}
            {plural(folder.items.length, "conversation")}
          </span>
        </button>
      </div>
      {open ? (
        <ul className="pb-1">
          {folder.items.map((item) => {
            const key = candidateKey(item);
            const imported = isAlreadyImported(item, stored);
            return (
              <li key={key}>
                <label
                  className={`flex items-center gap-2.5 py-1.5 pl-9 pr-3 hover:bg-content/5 ${
                    imported ? "opacity-50" : "cursor-pointer"
                  }`}
                >
                  <input
                    type="checkbox"
                    className={checkbox}
                    disabled={imported}
                    checked={imported || selected.has(key)}
                    onChange={(event) => onToggleKeys([key], event.target.checked)}
                  />
                  <span
                    title={PROVIDER_LABEL[item.provider]}
                    className="grid shrink-0 place-items-center"
                  >
                    <HarnessIcon harness={item.provider} className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px]">{item.firstPrompt}</span>
                  {imported ? (
                    <span className="shrink-0 rounded bg-content/10 px-1.5 py-0.5 text-[10px]">
                      {t("imported")}
                    </span>
                  ) : isHistoryOnly(item) ? (
                    <span
                      className="shrink-0 rounded bg-content/10 px-1.5 py-0.5 text-[10px] text-content/60"
                      title={t("Imported as history; sending a message starts a new conversation")}
                    >
                      {t("history only")}
                    </span>
                  ) : null}
                  {item.kind !== "interactive" ? (
                    <span className="shrink-0 rounded bg-content/10 px-1.5 py-0.5 text-[10px] text-content/60">
                      {item.kind === "exec" ? t("automation") : t("subagent")}
                    </span>
                  ) : null}
                  <span className="w-24 shrink-0 text-right text-[11px] text-content/45">
                    {formatDate(item.lastAt)}
                  </span>
                  <span className="w-14 shrink-0 text-right text-[11px] text-content/45">
                    {formatBytes(item.sizeBytes)}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

function RunningView({ progress, onCancel }: { progress: ImportProgress; onCancel: () => void }) {
  useLocale();
  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="flex flex-col gap-3 py-6" role="status" aria-live="polite">
      <p className="text-[13px] font-medium">
        {t("Importing ")}
        {progress.done.toLocaleString(getLocale())}
        {t(" of")} {progress.total.toLocaleString(getLocale())}…
      </p>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-content/10"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="truncate text-[12px] text-content/55">{progress.current ?? " "}</p>
      <p className="text-[11px] text-content/45">
        {progress.imported.toLocaleString(getLocale())}
        {t(" imported")}
        {progress.skipped > 0 ? t(" · {p0} skipped", { p0: progress.skipped }) : ""}
        {progress.failed.length > 0 ? t(" · {p0} failed", { p0: progress.failed.length }) : ""}
      </p>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/8 hover:text-content"
        >
          {t("Cancel")}
        </button>
      </div>
    </div>
  );
}

function DoneView({ summary, onClose }: { summary: ImportSummary; onClose: () => void }) {
  useLocale();
  return (
    <div className="flex flex-col gap-3 py-4">
      <p className="text-[14px] font-medium">
        {summary.cancelled ? t("Import cancelled") : t("Import finished")}
      </p>
      <ul className="flex flex-col gap-1 text-[12px] text-content/70">
        <li>
          {plural(summary.imported, "conversation")}
          {t(" imported.")}
        </li>
        {summary.skipped > 0 ? (
          <li>
            {summary.skipped}
            {t(" already in ")}
            {PRODUCT_IDENTITY.displayName}
            {t(", skipped.")}
          </li>
        ) : null}
        {summary.projects > 0 ? (
          <li>
            {plural(summary.projects, "folder")}
            {t(" added to the sidebar")}
            {summary.groups.length > 0
              ? t(", grouped as {p0}", { p0: summary.groups.join(", ") })
              : ""}
            .
          </li>
        ) : null}
        {summary.readOnly > 0 ? (
          <li>
            {summary.readOnly}
            {t(
              " can only be read: their folder is gone or could not be matched, so a new message starts a new conversation.",
            )}
          </li>
        ) : null}
        {summary.truncated > 0 ? (
          <li>
            {summary.truncated}
            {t(" were large, so only their most recent part was imported.")}
          </li>
        ) : null}
      </ul>
      {summary.failed.length > 0 ? (
        <details className="rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2 text-[12px]">
          <summary className="cursor-pointer text-red-400">
            {plural(summary.failed.length, "conversation")}
            {t(" could not be imported")}
          </summary>
          <ul className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto">
            {summary.failed.map((failure) => (
              <li key={candidateKey(failure.candidate)} className="text-content/70">
                <span className="text-content">{failure.candidate.firstPrompt}</span>
                {" — "}
                {failure.error}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-selection px-3 py-1.5 text-[12px] font-medium hover:bg-selection-hover"
        >
          {t("Done")}
        </button>
      </div>
    </div>
  );
}
