import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { TextField } from "../../../shared/ui/TextField";
import { Button } from "../../../shared/ui/Button";
import { Badge } from "../../../shared/ui/Badge";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { SearchInput, SearchInputGroup } from "../../../shared/ui/SearchInput";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { useLocale, useT } from "../../../shared/i18n";
import {
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Replace,
  ChevronLeft,
  Regex,
  WholeWord,
} from "../../../shared/ui/icons";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  cancelProjectSearch,
  searchProject,
  replaceProject,
  type OpenFileFn,
  type ProjectSearchMatch,
  type ProjectSearchOptions,
  type ProjectSearchResult,
} from "../../search/model/search";
import { FileTypeIcon } from "../../files/public/FileTypeIcon";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { pathKey } from "../../../shared/lib/paths";
import { isImeComposition } from "../../../shared/lib/keyboard";
import { hasActiveOverlay } from "../../../shared/ui/overlay";

type Props = {
  cwd: string;
  focusToken?: number;
  /** Hidden when a surrounding toolbar already offers the way back. */
  showHeader?: boolean;
  onClose: () => void;
  search?: (options: ProjectSearchOptions) => Promise<ProjectSearchResult>;
} & (
  | { onOpenFile: OpenFileFn; onOpenMatch?: never }
  | {
      onOpenFile?: never;
      onOpenMatch: (match: ProjectSearchMatch, pin: boolean) => void;
    }
);

type MatchGroup = {
  path: string;
  relative: string;
  name: string;
  /** Parent folder of the file; empty at the project root. */
  directory: string;
  matches: ProjectSearchMatch[];
};

export function ProjectSearch(props: Props) {
  return <ProjectSearchContent key={pathKey(props.cwd)} {...props} />;
}

function ProjectSearchContent({
  cwd,
  focusToken = 0,
  showHeader = true,
  onOpenFile,
  onOpenMatch,
  onClose,
  search,
}: Props) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const closeLatest = useStableCallback(onClose);
  const stateKey = `find-in-files:${pathKey(cwd)}`;
  const [query, setQuery] = useRetainedState(`${stateKey}:query`, "");
  const [include, setInclude] = useRetainedState(`${stateKey}:include`, "");
  const [exclude, setExclude] = useRetainedState(`${stateKey}:exclude`, "");
  const [caseSensitive, setCaseSensitive] = useRetainedState(`${stateKey}:case`, false);
  const [wholeWord, setWholeWord] = useRetainedState(`${stateKey}:word`, false);
  const [regex, setRegex] = useRetainedState(`${stateKey}:regex`, false);
  const [detailsExpanded, setDetailsExpanded] = useState(() => !!include || !!exclude);
  const detailsId = useId();
  const replaceId = useId();
  const [replaceExpanded, setReplaceExpanded] = useState(false);
  const [replacement, setReplacement] = useRetainedState(`${stateKey}:replacement`, "");
  const [replacing, setReplacing] = useState(false);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [replaceSummary, setReplaceSummary] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const confirmation = useConfirm();
  const toggleDetails = () => setDetailsExpanded((expanded) => !expanded);
  const request = useMemo(
    () => ({
      cwd,
      query: query.trim(),
      caseSensitive,
      wholeWord,
      regex,
      include: include.trim() || undefined,
      exclude: exclude.trim() || undefined,
    }),
    [cwd, query, caseSensitive, wholeWord, regex, include, exclude],
  );
  const [result, setResult] = useState<{
    request: typeof request;
    matches: ProjectSearchMatch[];
    truncated: boolean;
    error: string | null;
  } | null>(null);
  // Gate during render: an effect-only clear leaves old rows actionable until
  // that effect runs, and throughout the debounce when only loading is checked.
  const currentResult = result?.request === request ? result : null;
  const matches = currentResult?.matches ?? EMPTY_MATCHES;
  const truncated = currentResult?.truncated ?? false;
  const error = currentResult?.error ?? null;
  const loading = !!request.query && !!cwd && cwd !== "~" && !currentResult;
  const activeSearchId = useRef<string | null>(null);

  useEffect(() => {
    if (!focusToken) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusToken]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Child popups (field menus) and IME composition own Escape first;
      // Project Search closes only when nothing else claims the key.
      if (
        event.key !== "Escape" ||
        isImeComposition(event) ||
        event.defaultPrevented ||
        hasActiveOverlay()
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      closeLatest();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [closeLatest]);

  useEffect(() => {
    if (!request.query || !cwd || cwd === "~") return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      const searchId = crypto.randomUUID();
      activeSearchId.current = searchId;
      void (search ?? searchProject)({
        ...request,
        searchId,
      })
        .then((result) => {
          if (cancelled) return;
          setResult({ request, matches: result.matches, truncated: result.truncated, error: null });
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setResult({
            request,
            matches: [],
            truncated: false,
            error: err instanceof Error ? err.message : String(err),
          });
        })
        .finally(() => {
          if (activeSearchId.current === searchId) activeSearchId.current = null;
        });
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      const searchId = activeSearchId.current;
      activeSearchId.current = null;
      if (searchId) {
        void cancelProjectSearch(cwd, searchId).catch(() => undefined);
      }
    };
  }, [cwd, request, search, refresh]);

  const groups = groupMatches(matches);
  const matchCount = matches.length;
  const fileCount = groups.length;

  const replaceAll = () => {
    if (!matches.length || !request.query || replacing) return;
    setReplacing(true);
    setReplaceError(null);
    setReplaceSummary(null);
    const options = { ...request, searchId: crypto.randomUUID(), replacement };
    return replaceProject({ ...options, dryRun: true })
      .then(async (preview) => {
        if (!preview.replacements) {
          setReplaceError(preview.failures.join("\n") || t("No results"));
          return;
        }
        const accepted = await confirmation.confirm({
          title: t("Replace All"),
          message: t("Replace {p0} occurrences across {p1} files with '{p2}'?", {
            p0: preview.replacements,
            p1: preview.filesChanged,
            p2: replacement,
          }),
          confirmLabel: t("Replace All"),
        });
        if (!accepted) {
          return;
        }
        const changed = await replaceProject({
          ...options,
          dryRun: false,
          revisions: preview.revisions,
        });
        setReplaceSummary(
          t("Replaced {p0} occurrences in {p1} files", {
            p0: changed.replacements,
            p1: changed.filesChanged,
          }),
        );
        setReplaceError(changed.failures.join("\n") || null);
        setResult(null);
        setRefresh((value) => value + 1);
      })
      .catch((error: unknown) => {
        setReplaceError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setReplacing(false));
  };

  const openMatch = (match: ProjectSearchMatch, pin = false) => {
    if (!matches.includes(match)) return;
    if (onOpenMatch) onOpenMatch(match, pin);
    else onOpenFile?.(match.path, { line: match.line, column: match.column }, { exact: true, pin });
  };

  const onQueryKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    // Escape is owned by the window listener above, which yields to IME and overlays.
    if (event.key === "Enter" && !isImeComposition(event.nativeEvent) && matches[0]) {
      event.preventDefault();
      openMatch(matches[0]);
    }
  };

  if (!cwd || cwd === "~") {
    return <EmptyState size="inline" className="px-3 py-2" description={t("No project folder")} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {confirmation.dialog}
      {showHeader ? (
        <div
          {...surfaceAttributes(
            { frame: "stroke", edge: "bottom" },
            "flex shrink-0 items-center gap-1 px-1.5 py-1",
          )}
        >
          <Button variant="ghost" iconOnly label={t("Back to files")} onClick={onClose}>
            <ChevronLeft className="icon-md" strokeWidth={1.75} />
          </Button>
          <Text size="caption" tone="secondary" truncate className="min-w-0 flex-1">
            {t("Search in files")}
          </Text>
        </div>
      ) : null}
      <div
        {...surfaceAttributes(
          { frame: "stroke", edge: "bottom" },
          "min-w-0 shrink-0 space-y-1 p-2",
        )}
      >
        <div className="flex min-w-0 items-stretch gap-1">
          <Button
            variant="ghost"
            iconOnly
            size="sm"
            motion="none"
            stretch
            className="w-4 shrink-0"
            label={t("Toggle Replace")}
            aria-expanded={replaceExpanded}
            aria-controls={replaceId}
            onClick={() => setReplaceExpanded((value) => !value)}
          >
            {replaceExpanded ? (
              <ChevronDown className="icon-sm" />
            ) : (
              <ChevronRight className="icon-sm" />
            )}
          </Button>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <SearchInputGroup appearance="field" className="min-w-0 flex-1">
              <SearchInput
                ref={inputRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onQueryKeyDown}
                placeholder={t("Search")}
                aria-label={t("Search")}
                spellCheck={false}
                textSize="caption"
                focusOwner="group"
              />
              <div className="flex shrink-0 items-center">
                <Toggle
                  label={t("Match case")}
                  active={caseSensitive}
                  onClick={() => setCaseSensitive((value) => !value)}
                >
                  <CaseSensitive className="icon-sm" strokeWidth={1.75} />
                </Toggle>
                <Toggle
                  label={t("Match whole word")}
                  active={wholeWord}
                  onClick={() => setWholeWord((value) => !value)}
                >
                  <WholeWord className="icon-sm" strokeWidth={1.75} />
                </Toggle>
                <Toggle
                  label={t("Use regular expression")}
                  active={regex}
                  onClick={() => setRegex((value) => !value)}
                >
                  <Regex className="icon-sm" strokeWidth={1.75} />
                </Toggle>
              </div>
            </SearchInputGroup>
            <div id={replaceId} hidden={!replaceExpanded}>
              <TextField
                label={t("Replace")}
                hideLabel
                aria-label={t("Replace")}
                placeholder={t("Replace")}
                value={replacement}
                onChange={(event) => setReplacement(event.target.value)}
                spellCheck={false}
                fieldVariant="compact"
                fieldSize="sm"
                textSize="caption"
                endAdornment={
                  <Button
                    variant="ghost"
                    iconOnly
                    inset
                    label={t("Replace All")}
                    loading={replacing}
                    disabled={!matches.length || !request.query || replacing}
                    onClick={() => void replaceAll()}
                  >
                    <Replace className="icon-sm" />
                  </Button>
                }
              />
            </div>
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            variant="ghost"
            iconOnly
            size="sm"
            label={t("Toggle Search Details")}
            aria-expanded={detailsExpanded}
            aria-controls={detailsId}
            onClick={toggleDetails}
          >
            <MoreHorizontal className="icon-sm" />
          </Button>
        </div>
        <div id={detailsId} className="ms-5" hidden={!detailsExpanded}>
          <div className="min-w-0 space-y-2">
            <TextField
              label={t("files to include")}
              aria-label={t("files to include")}
              value={include}
              onChange={(event) => setInclude(event.target.value)}
              spellCheck={false}
              fieldSize="sm"
              fieldVariant="compact"
              textSize="caption"
              fieldClassName="min-w-0 w-full"
            />
            <TextField
              label={t("files to exclude")}
              aria-label={t("files to exclude")}
              value={exclude}
              onChange={(event) => setExclude(event.target.value)}
              spellCheck={false}
              fieldSize="sm"
              fieldVariant="compact"
              textSize="caption"
              fieldClassName="min-w-0 w-full"
            />
            <Button
              variant="ghost"
              size="sm"
              inset="text"
              onClick={() => {
                setInclude("");
                setExclude("");
                setCaseSensitive(false);
                setWholeWord(false);
                setRegex(false);
              }}
            >
              {t("Reset")}
            </Button>
          </div>
        </div>
      </div>
      {replaceError ? <InlineError className="px-3 py-1">{replaceError}</InlineError> : null}
      {replaceSummary ? (
        <Text size="micro" tone="secondary" className="px-3 py-1">
          {replaceSummary}
        </Text>
      ) : null}
      <Text
        as="div"
        size="micro"
        tone="secondary"
        className="flex min-h-8 shrink-0 items-center gap-2 px-3 py-1.5"
      >
        {loading ? (
          <LoadingText delay={false}>{t("Searching…")}</LoadingText>
        ) : error ? (
          <InlineError>{error}</InlineError>
        ) : query.trim() ? (
          <span>
            {matchCount === 0
              ? t("No results")
              : t(
                  matchCount === 1
                    ? fileCount === 1
                      ? "{p0} result in {p2} file"
                      : "{p0} result in {p2} files"
                    : fileCount === 1
                      ? "{p0} results in {p2} file"
                      : "{p0} results in {p2} files",
                  { p0: matchCount, p2: fileCount },
                )}
            {truncated ? t(" (limited)") : ""}
          </span>
        ) : (
          <span>{t("Type to search across the project")}</span>
        )}
      </Text>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-none">
        {groups.map((group) => (
          <section key={group.path} {...surfaceAttributes({ frame: "stroke", edge: "bottom" }, "")}>
            {/* Keep exact file identity readable without hover, including duplicate basenames. */}
            <div className="flex min-w-0 items-start gap-1.5 px-2 py-1">
              <FileTypeIcon name={group.name} isDir={false} size="md" />
              <div className="min-w-0 flex-1">
                <Text as="div" wrap="anywhere" size="caption" tone="primary">
                  {group.name}
                </Text>
                <Text as="div" wrap="anywhere" size="micro" tone="muted">
                  {group.relative}
                </Text>
              </div>
              <Badge variant="count" size="xs" tone="accent" max={Infinity}>
                {group.matches.length}
              </Badge>
            </div>
            <ul>
              {group.matches.map((match) => (
                <li key={`${match.path}:${match.line}:${match.column}`}>
                  <Button
                    variant="item"
                    motion="none"
                    type="button"
                    onClick={() => openMatch(match)}
                    onDoubleClick={() => openMatch(match, true)}
                    className="flex w-full items-start gap-2 text-left"
                  >
                    <Tooltip label={t("Line {p0}", { p0: match.line })} asChild>
                      <Text
                        role="img"
                        aria-label={t("Line {p0}", { p0: match.line })}
                        size="micro"
                        tone="muted"
                        className="w-7 shrink-0 pt-0 text-right font-mono tabular-nums"
                      >
                        {match.line}
                      </Text>
                    </Tooltip>
                    <Text
                      as="span"
                      size="micro"
                      tone="primary"
                      leading="relaxed"
                      truncate
                      className="min-w-0 flex-1 font-mono"
                    >
                      <MatchPreview
                        preview={match.preview.trimEnd()}
                        query={query.trim()}
                        caseSensitive={caseSensitive}
                        regex={regex}
                      />
                    </Text>
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

const EMPTY_MATCHES: ProjectSearchMatch[] = [];

function Toggle({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  useLocale();
  return (
    <Button variant="ghost" iconOnly inset label={label} pressed={active} onClick={onClick}>
      {children}
    </Button>
  );
}

function groupMatches(matches: ProjectSearchMatch[]): MatchGroup[] {
  const byPath = new Map<string, MatchGroup>();
  for (const match of matches) {
    const existing = byPath.get(match.path);
    if (existing) {
      existing.matches.push(match);
      continue;
    }
    const slash = match.relative.lastIndexOf("/");
    byPath.set(match.path, {
      path: match.path,
      relative: match.relative,
      name: match.relative.slice(slash + 1),
      directory: slash < 0 ? "" : match.relative.slice(0, slash),
      matches: [match],
    });
  }
  return [...byPath.values()];
}

function MatchPreview({
  preview,
  query,
  caseSensitive,
  regex,
}: {
  preview: string;
  query: string;
  caseSensitive: boolean;
  regex: boolean;
}) {
  useLocale();
  const range = highlightRange(preview, query, caseSensitive, regex);
  if (!range) return <>{preview}</>;
  const [start, end] = range;
  return (
    <>
      {preview.slice(0, start)}
      <Text
        as="mark"
        size="inherit"
        tone="primary"
        {...surfaceAttributes({ radius: "sm", tone: "accent" })}
      >
        {preview.slice(start, end)}
      </Text>
      {preview.slice(end)}
    </>
  );
}

/** The `[start, end)` span of the first match of `query` in `preview`, or `null`. */
function highlightRange(
  preview: string,
  query: string,
  caseSensitive: boolean,
  regex: boolean,
): [number, number] | null {
  if (!query) return null;
  if (regex) {
    try {
      const match = preview.match(new RegExp(query, caseSensitive ? "" : "i"));
      if (!match || match.index == null) return null;
      return [match.index, match.index + match[0].length];
    } catch {
      return null;
    }
  }
  const source = caseSensitive ? preview : preview.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const index = source.indexOf(needle);
  return index < 0 ? null : [index, index + needle.length];
}
