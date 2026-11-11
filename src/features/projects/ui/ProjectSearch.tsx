import { OverflowTooltip, Tooltip } from "../../../shared/ui/Tooltip";
import { Popover } from "../../../shared/ui/Popover";
import { TextField } from "../../../shared/ui/TextField";
import { Button } from "../../../shared/ui/Button";
import { Badge } from "../../../shared/ui/Badge";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { t, useLocale } from "../../../shared/i18n";
import { CaseSensitive, ListFilter, ChevronLeft, Regex, WholeWord } from "../../../shared/ui/icons";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  cancelProjectSearch,
  searchProject,
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
  search = searchProject,
}: Props) {
  useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const [filtersAnchor, setFiltersAnchor] = useState<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const stateKey = `find-in-files:${pathKey(cwd)}`;
  const [query, setQuery] = useRetainedState(`${stateKey}:query`, "");
  const [include, setInclude] = useRetainedState(`${stateKey}:include`, "");
  const [exclude, setExclude] = useRetainedState(`${stateKey}:exclude`, "");
  const [caseSensitive, setCaseSensitive] = useRetainedState(`${stateKey}:case`, false);
  const [wholeWord, setWholeWord] = useRetainedState(`${stateKey}:word`, false);
  const [regex, setRegex] = useRetainedState(`${stateKey}:regex`, false);
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
      // Child popups (filters, field menus) and IME composition own Escape first;
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
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    if (!request.query || !cwd || cwd === "~") return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      const searchId = crypto.randomUUID();
      activeSearchId.current = searchId;
      void search({
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
  }, [cwd, request, search]);

  const groups = useMemo(() => groupMatches(matches), [matches]);
  const matchCount = matches.length;
  const fileCount = groups.length;

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
      {showHeader ? (
        <div className="flex shrink-0 items-center gap-1 border-b border-stroke px-1.5 py-1">
          <Button variant="ghost" iconOnly label={t("Back to files")} onClick={onClose}>
            <ChevronLeft className="icon-md" strokeWidth={1.75} />
          </Button>
          <span className="min-w-0 flex-1 truncate text-ui-caption text-(--ui-text-secondary)">
            {t("Search in files")}
          </span>
        </div>
      ) : null}
      <div className="flex shrink-0 items-center gap-1 border-b border-stroke p-2">
        <SearchInput
          standalone
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onQueryKeyDown}
          placeholder={t("Search")}
          aria-label={t("Search")}
          spellCheck={false}
          className="text-ui-caption"
          containerClassName="min-w-0 flex-1"
        />
        <Button
          variant="ghost"
          iconOnly
          label={t("Filters")}
          selected={!!include || !!exclude || caseSensitive || wholeWord || regex}
          aria-haspopup="dialog"
          aria-expanded={!!filtersAnchor}
          onClick={(event) => setFiltersAnchor(filtersAnchor ? null : event.currentTarget)}
        >
          <ListFilter className="icon-md" />
        </Button>
      </div>
      {filtersAnchor ? (
        <Popover
          anchor={filtersAnchor}
          role="dialog"
          aria-label={t("Filters")}
          width={280}
          onDismiss={() => setFiltersAnchor(null)}
          className="space-y-2 p-2"
        >
          <div className="flex items-center gap-1">
            {" "}
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
          <TextField
            hideLabel
            label=""
            value={include}
            onChange={(event) => setInclude(event.target.value)}
            placeholder={t("files to include")}
            aria-label={t("files to include")}
            spellCheck={false}
            className="w-full"
          />
          <TextField
            hideLabel
            label=""
            value={exclude}
            onChange={(event) => setExclude(event.target.value)}
            placeholder={t("files to exclude")}
            aria-label={t("files to exclude")}
            spellCheck={false}
            className="w-full"
          />

          <Button
            variant="secondary"
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
        </Popover>
      ) : null}
      <div className="flex min-h-8 shrink-0 items-center gap-2 px-3 py-1.5 text-ui-micro text-(--ui-text-secondary)">
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
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-none">
        {groups.map((group) => (
          <section key={group.path} className="border-b border-stroke">
            {/* One line per file: name, then its folder (full path on hover when it is cut). */}
            <div className="flex min-w-0 items-center gap-1.5 px-2 py-1">
              <FileTypeIcon name={group.name} isDir={false} size="md" />
              <span className="min-w-0 max-w-[60%] shrink-0 truncate text-ui-caption text-content">
                {group.name}
              </span>
              <OverflowTooltip label={group.relative}>
                <span className="min-w-0 flex-1 truncate text-ui-micro text-(--ui-text-muted)">
                  {group.directory}
                </span>
              </OverflowTooltip>
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
                      <span
                        role="img"
                        aria-label={t("Line {p0}", { p0: match.line })}
                        className="w-7 shrink-0 pt-px text-right font-mono text-ui-micro text-(--ui-text-muted) tabular-nums"
                      >
                        {match.line}
                      </span>
                    </Tooltip>
                    <span className="min-w-0 flex-1 truncate font-mono text-ui-micro leading-5 text-content">
                      <MatchPreview
                        preview={match.preview.trimEnd()}
                        query={query.trim()}
                        caseSensitive={caseSensitive}
                        regex={regex}
                      />
                    </span>
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
    <Button variant="ghost" iconOnly label={label} aria-pressed={active} onClick={onClick}>
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
  if (!query) return <>{preview}</>;
  if (regex) {
    try {
      const pattern = new RegExp(query, caseSensitive ? "" : "i");
      const match = preview.match(pattern);
      if (!match || match.index == null) return <>{preview}</>;
      const start = match.index;
      const end = start + match[0].length;
      return (
        <>
          {preview.slice(0, start)}
          <mark className="rounded-sm bg-[var(--ui-tone-accent-subtle)] text-content">
            {preview.slice(start, end)}
          </mark>
          {preview.slice(end)}
        </>
      );
    } catch {
      return <>{preview}</>;
    }
  }

  const source = caseSensitive ? preview : preview.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const index = source.indexOf(needle);
  if (index < 0) return <>{preview}</>;
  const end = index + needle.length;
  return (
    <>
      {preview.slice(0, index)}
      <mark className="rounded-sm bg-[var(--ui-tone-accent-subtle)] text-content">
        {preview.slice(index, end)}
      </mark>
      {preview.slice(end)}
    </>
  );
}
