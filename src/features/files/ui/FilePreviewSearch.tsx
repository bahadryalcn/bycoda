import { LiveText } from "../../../shared/ui/LiveText";
import { Button } from "../../../shared/ui/Button";
import { SearchInput, SearchInputGroup } from "../../../shared/ui/SearchInput";
import { t, useLocale } from "../../../shared/i18n/technical";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronUp, X } from "../../../shared/ui/icons";
import { keybindingPressed } from "../../settings/public/settings";
import { startPreviewSearch } from "./previewSearchTask";
import { evaluatePreviewSearch } from "./previewSearchEvaluation";

const MATCH_HIGHLIGHT = "bycoda-file-preview-search-match";
const CURRENT_HIGHLIGHT = "bycoda-file-preview-search-current";
const HIGHLIGHT_STYLE_ID = "bycoda-file-preview-search-styles";
const BLOCK_ELEMENTS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

type SearchOptions = {
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
};

type SearchResult<T> = {
  matches: T[];
  capped: boolean;
  invalid: boolean;
  timedOut?: boolean;
};

type TextMatch = { from: number; to: number };
type TextSegment = { node: Text; from: number; to: number };
type TextRun = { text: string; segments: TextSegment[]; key: Element };

type PreviewSearchController = {
  root: () => HTMLElement | null;
  active: () => boolean;
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
  next: () => void;
  previous: () => void;
};

const controllers = new Set<PreviewSearchController>();
let highlightOwner: symbol | null = null;

export function handleFilePreviewFindKey(event: KeyboardEvent): boolean {
  if (event.isComposing) return false;
  const controller = activeController();
  if (!controller) return false;

  const mod = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();
  const defaultFind = mod && !event.altKey && !event.shiftKey && key === "f";
  if (defaultFind && !keybindingPressed("Editor: Find", event, true)) {
    event.preventDefault();
    return true;
  }
  if (keybindingPressed("Editor: Find", event, defaultFind)) {
    event.preventDefault();
    controller.open();
    return true;
  }
  if (controller.isOpen() && (event.key === "F3" || (mod && !event.altKey && key === "g"))) {
    event.preventDefault();
    (event.shiftKey ? controller.previous : controller.next)();
    return true;
  }
  if (controller.isOpen() && event.key === "Escape") {
    event.preventDefault();
    controller.close();
    return true;
  }
  return false;
}

export function openFindInActiveFilePreview(): boolean {
  const controller = activeController();
  if (!controller) return false;
  controller.open();
  return true;
}

function activeController(): PreviewSearchController | null {
  const ordered = [...controllers];
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const controller = ordered[index];
    const root = controller.root();
    if (
      controller.active() &&
      root &&
      !root.closest(".hidden, .invisible, [hidden], [aria-hidden='true']")
    ) {
      return controller;
    }
  }
  return null;
}

export function FilePreviewSearch({
  active,
  contentVersion,
  children,
}: {
  active: boolean;
  contentVersion: string;
  children: ReactNode;
}) {
  useLocale();
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const previewOwnerRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusFrameRef = useRef<number | null>(null);
  const activeRef = useRef(active);
  const openRef = useRef(false);
  const matchesRef = useRef<Range[]>([]);
  const currentRef = useRef(-1);
  const signatureRef = useRef("");
  const revealRef = useRef(false);
  const ownerRef = useRef(Symbol("file-preview-search"));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regexp, setRegexp] = useState(false);
  const [current, setCurrent] = useState(-1);
  const [result, setResult] = useState<Omit<SearchResult<Range>, "matches">>({
    capped: false,
    invalid: false,
  });
  const [total, setTotal] = useState(0);
  const [mutationVersion, setMutationVersion] = useState(0);
  activeRef.current = active;
  openRef.current = open;

  useLayoutEffect(() => {
    // Accessible names are translated; find and keyboard recovery share the
    // actual document scroll owner instead of looking up its English label.
    previewOwnerRef.current =
      contentRef.current?.querySelector<HTMLElement>(".markdown-preview") ?? contentRef.current;
  }, [active, contentVersion]);

  const cancelFocus = useCallback(() => {
    if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current);
    focusFrameRef.current = null;
  }, []);

  const focusInput = useCallback(() => {
    cancelFocus();
    focusFrameRef.current = requestAnimationFrame(() => {
      focusFrameRef.current = null;
      if (!activeRef.current || !openRef.current) return;
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [cancelFocus]);

  const openSearch = useCallback(() => {
    openRef.current = true;
    revealRef.current = true;
    setOpen(true);
    focusInput();
  }, [focusInput]);

  const closeSearch = useCallback(() => {
    cancelFocus();
    openRef.current = false;
    setOpen(false);
    clearHighlights(ownerRef.current);
    focusFrameRef.current = requestAnimationFrame(() => {
      focusFrameRef.current = null;
      if (!activeRef.current) return;
      previewOwnerRef.current?.focus({ preventScroll: true });
    });
  }, [cancelFocus]);

  const step = useCallback((delta: number) => {
    const matches = matchesRef.current;
    if (matches.length === 0) return;
    const next = (Math.max(0, currentRef.current) + delta + matches.length) % matches.length;
    currentRef.current = next;
    setCurrent(next);
    paintHighlights(ownerRef.current, matches, next);
    revealRange(matches[next], previewOwnerRef.current);
  }, []);

  useLayoutEffect(() => {
    const controller: PreviewSearchController = {
      root: () => rootRef.current,
      active: () => activeRef.current,
      open: openSearch,
      close: closeSearch,
      isOpen: () => openRef.current,
      next: () => step(1),
      previous: () => step(-1),
    };
    controllers.add(controller);
    return () => {
      controllers.delete(controller);
    };
  }, [closeSearch, openSearch, step]);

  useLayoutEffect(() => {
    if (active) return;
    cancelFocus();
    openRef.current = false;
    setOpen(false);
    clearHighlights(ownerRef.current);
  }, [active, cancelFocus]);

  useEffect(() => {
    if (!open || !contentRef.current) return;
    const observer = new MutationObserver(() => {
      setMutationVersion((version) => version + 1);
    });
    observer.observe(contentRef.current, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, [open]);

  useLayoutEffect(() => {
    const root = contentRef.current;
    if (!open || !active || !root || !query) {
      matchesRef.current = [];
      currentRef.current = -1;
      setCurrent(-1);
      setTotal(0);
      setResult({ capped: false, invalid: false });
      clearHighlights(ownerRef.current);
      return;
    }

    const signature = `${query}\0${caseSensitive}\0${wholeWord}\0${regexp}`;
    const runs = previewTextRuns(root);
    const task = startPreviewSearch(
      runs.map((run) => run.text),
      query,
      {
        caseSensitive,
        wholeWord,
        regexp,
      },
    );
    let cancelled = false;
    matchesRef.current = [];
    setTotal(0);
    clearHighlights(ownerRef.current);
    void task.result.then((found) => {
      if (cancelled) return;
      const search = {
        ...found,
        matches: found.matches.flatMap((match) => {
          const range = domRange(runs[match.run]!, match.from, match.to, root.ownerDocument);
          return range ? [range] : [];
        }),
      };
      const nextCurrent =
        search.matches.length === 0
          ? -1
          : signatureRef.current === signature
            ? Math.min(Math.max(0, currentRef.current), search.matches.length - 1)
            : 0;
      signatureRef.current = signature;
      matchesRef.current = search.matches;
      currentRef.current = nextCurrent;
      setCurrent(nextCurrent);
      setTotal(search.matches.length);
      setResult({ capped: search.capped, invalid: search.invalid, timedOut: search.timedOut });
      paintHighlights(ownerRef.current, search.matches, nextCurrent);
      if (revealRef.current && nextCurrent >= 0) {
        revealRange(search.matches[nextCurrent], previewOwnerRef.current);
      }
      revealRef.current = false;
    });
    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [active, caseSensitive, contentVersion, mutationVersion, open, query, regexp, wholeWord]);

  useEffect(
    () => () => {
      cancelFocus();
      clearHighlights(ownerRef.current);
    },
    [cancelFocus],
  );

  const updateQuery = (value: string) => {
    revealRef.current = true;
    setQuery(value);
  };
  const toggle = (setter: (update: (value: boolean) => boolean) => void) => {
    revealRef.current = true;
    setter((value) => !value);
  };
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
      return;
    }
    if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
      if (event.code === "KeyC") {
        event.preventDefault();
        toggle(setCaseSensitive);
      } else if (event.code === "KeyW") {
        event.preventDefault();
        toggle(setWholeWord);
      } else if (event.code === "KeyR") {
        event.preventDefault();
        toggle(setRegexp);
      }
    }
  };

  const count = result.invalid
    ? t("Invalid regex")
    : result.timedOut
      ? t("Regex search timed out")
      : query && total === 0
        ? t("No results")
        : total > 0
          ? t("{p0} of {p1}{p2}", { p0: current + 1, p1: total, p2: result.capped ? "+" : "" })
          : "";

  return (
    <div
      ref={rootRef}
      data-file-preview-search-open={open && active ? "" : undefined}
      className="flex h-full min-h-0 flex-col"
    >
      {open ? (
        <div
          role="search"
          aria-label={t("Find in preview")}
          className="relative z-1 flex min-h-(--ui-control-height-compact) shrink-0 flex-wrap items-center gap-1 border-b border-(--ui-pane-border) bg-(--ui-workspace-reading-panel) px-2 py-1 text-content"
          onKeyDown={onKeyDown}
        >
          <SearchInputGroup appearance="field" className="min-w-0 flex-1">
            <SearchInput
              ref={inputRef}
              focusOwner="group"
              aria-invalid={Boolean((query && total === 0) || result.invalid)}
              type="text"
              value={query}
              aria-label={t("Find")}
              placeholder={t("Find")}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(event) => updateQuery(event.currentTarget.value)}
              className="min-w-0 flex-1"
            />
            <LiveText
              text={count}
              className={`w-[13ch] shrink-0 overflow-hidden pl-2 text-right font-mono text-ui-caption tabular-nums text-ellipsis whitespace-nowrap ${
                (query && total === 0) || result.invalid
                  ? "text-(--ui-tone-danger-fg)"
                  : "text-[var(--ui-text-muted)]"
              }`}
            />
          </SearchInputGroup>
          <FindToggle
            label={t("Aa")}
            title={t("Match Case")}
            shortcut="Alt+C"
            pressed={caseSensitive}
            onClick={() => toggle(setCaseSensitive)}
          />
          <FindToggle
            label={t("ab")}
            title={t("Match Whole Word")}
            shortcut="Alt+W"
            pressed={wholeWord}
            onClick={() => toggle(setWholeWord)}
          />
          <FindToggle
            label=".*"
            title={t("Use Regular Expression")}
            shortcut="Alt+R"
            pressed={regexp}
            onClick={() => toggle(setRegexp)}
          />
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            label={t("Previous Match")}
            shortcut="Mod+Shift+G"
            disabled={total === 0}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => step(-1)}
          >
            <ChevronUp className="icon-sm" strokeWidth={1.75} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            label={t("Next Match")}
            shortcut="Mod+G"
            disabled={total === 0}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => step(1)}
          >
            <ChevronDown className="icon-sm" strokeWidth={1.75} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            label={t("Close")}
            shortcut="Esc"
            onMouseDown={(event) => event.preventDefault()}
            onClick={closeSearch}
          >
            <X className="icon-sm" strokeWidth={1.75} />
          </Button>
        </div>
      ) : null}
      <div ref={contentRef} tabIndex={-1} className="isolate min-h-0 min-w-0 flex-1">
        {children}
      </div>
    </div>
  );
}

function FindToggle({
  label,
  title,
  shortcut,
  pressed,
  onClick,
}: {
  label: string;
  title: string;
  shortcut?: string;
  pressed: boolean;
  onClick: () => void;
}) {
  useLocale();
  return (
    <Button
      size="sm"
      variant="ghost"
      motion="none"
      type="button"
      tooltip={title}
      shortcut={shortcut}
      aria-label={title}
      aria-pressed={pressed}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="shrink-0 font-mono"
    >
      {label}
    </Button>
  );
}

export async function findPreviewTextMatches(
  text: string,
  query: string,
  options: SearchOptions,
): Promise<SearchResult<TextMatch>> {
  const result = options.regexp
    ? await startPreviewSearch([text], query, options).result
    : evaluatePreviewSearch([text], query, options);
  return { ...result, matches: result.matches.map(({ from, to }) => ({ from, to })) };
}
function previewTextRuns(root: HTMLElement): TextRun[] {
  const showText = root.ownerDocument.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = root.ownerDocument.createTreeWalker(root, showText);
  const runs: TextRun[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node instanceof Text) || !node.data) continue;
    const parent = node.parentElement;
    if (!parent || parent.closest("script, style, noscript, [hidden], [aria-hidden='true']")) {
      continue;
    }
    const key = blockContainer(parent, root);
    let run = runs[runs.length - 1];
    if (!run || run.key !== key) {
      run = { text: "", segments: [], key };
      runs.push(run);
    }
    const from = run.text.length;
    run.text += node.data;
    run.segments.push({ node, from, to: run.text.length });
  }
  return runs;
}

function blockContainer(element: Element, root: HTMLElement): Element {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (current === root || BLOCK_ELEMENTS.has(current.localName)) return current;
  }
  return root;
}

function domRange(run: TextRun, from: number, to: number, document: Document): Range | null {
  const start = run.segments.find((segment) => from >= segment.from && from < segment.to);
  const endOffset = to - 1;
  const end = run.segments.find((segment) => endOffset >= segment.from && endOffset < segment.to);
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, from - start.from);
  range.setEnd(end.node, to - end.from);
  return range;
}

function paintHighlights(owner: symbol, ranges: Range[], current: number) {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
  ensureHighlightStyles(ranges[0]?.startContainer.ownerDocument);
  const registry = CSS.highlights;
  if (highlightOwner !== owner) {
    registry.delete(MATCH_HIGHLIGHT);
    registry.delete(CURRENT_HIGHLIGHT);
  }
  highlightOwner = owner;
  registry.set(MATCH_HIGHLIGHT, new Highlight(...ranges));
  registry.delete(CURRENT_HIGHLIGHT);
  if (current >= 0 && ranges[current]) {
    registry.set(CURRENT_HIGHLIGHT, new Highlight(ranges[current]));
  }
}

function clearHighlights(owner: symbol) {
  if (highlightOwner !== owner) return;
  if (typeof CSS !== "undefined" && "highlights" in CSS) {
    CSS.highlights.delete(MATCH_HIGHLIGHT);
    CSS.highlights.delete(CURRENT_HIGHLIGHT);
  }
  highlightOwner = null;
}

function ensureHighlightStyles(document: Document | null | undefined) {
  if (!document || document.getElementById(HIGHLIGHT_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = `
    ::highlight(${MATCH_HIGHLIGHT}) {
      background-color: var(--color-selection);
    }
    ::highlight(${CURRENT_HIGHLIGHT}) {
      background-color: var(--color-selection-strong);
    }
  `;
  document.head.append(style);
}

function revealRange(range: Range, root: HTMLElement | null) {
  if (!root) return;
  const rangeWithRect = range as Range & {
    getBoundingClientRect?: () => DOMRect;
  };
  const scroller = root;
  const rangeRect = rangeWithRect.getBoundingClientRect?.();
  if (rangeRect) {
    const scrollerRect = scroller.getBoundingClientRect();
    if (rangeRect.top >= scrollerRect.top && rangeRect.bottom <= scrollerRect.bottom) {
      return;
    }
    scroller.scrollTo({
      top: scroller.scrollTop + rangeRect.top - scrollerRect.top - scroller.clientHeight / 2,
    });
    return;
  }
  range.startContainer.parentElement?.scrollIntoView({ block: "center" });
}
