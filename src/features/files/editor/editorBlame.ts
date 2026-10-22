import {
  ChangeSet,
  Facet,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Text,
} from "@codemirror/state";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";
import type { GitBlameLine, GitHistoryCommit } from "../../../platform/tauri/fs";
import { blameByLine, mapBlameLines } from "../../source-control/model/blameMapping";
import {
  authorColor,
  formatAbsoluteTime,
  formatRelativeTime,
} from "../../source-control/model/gitGraphDisplay";
import { editorDocChanges } from "./editorDoc";

/**
 * A blame gutter: per line, the commit that last changed it, drawn on the
 * first line of each run from one commit. It is a real CodeMirror gutter, so
 * only the lines in view get an element.
 *
 * The blame describes the file as saved. While the buffer holds unsaved edits
 * the state field carries it through every change (`mapBlameLines`), so lines
 * the user touched read "Not committed yet" instead of naming the wrong commit.
 */

type PendingBlame = {
  id: number;
  /** The text git blamed: what is on disk. */
  base: Text;
  /** From `base` to the current document. */
  changes: ChangeSet;
};

type BlameState = {
  /** One slot per current line; `null` when no commit describes it. */
  lines: (GitBlameLine | null)[];
  pending: PendingBlame | null;
};

const blameRequested = StateEffect.define<{ id: number; base: Text }>();
const blameLoaded = StateEffect.define<{
  id: number;
  blame: readonly GitBlameLine[];
}>();

function changesBetween(base: Text, doc: Text): ChangeSet {
  if (base.eq(doc)) return ChangeSet.empty(base.length);
  return ChangeSet.of(editorDocChanges(base.toString(), doc.toString()), base.length);
}

const blameField = StateField.define<BlameState>({
  create(state) {
    return { lines: new Array(state.doc.lines).fill(null), pending: null };
  },
  update(value, tr) {
    let { lines, pending } = value;
    if (tr.docChanged) {
      lines = mapBlameLines(lines, tr.startState.doc, tr.changes, tr.state.doc);
      if (pending) {
        pending = { ...pending, changes: pending.changes.compose(tr.changes) };
      }
    }
    for (const effect of tr.effects) {
      if (effect.is(blameRequested)) {
        const { id, base } = effect.value;
        pending = { id, base, changes: changesBetween(base, tr.state.doc) };
      } else if (effect.is(blameLoaded) && pending?.id === effect.value.id) {
        lines = mapBlameLines(
          blameByLine(effect.value.blame, pending.base.lines),
          pending.base,
          pending.changes,
          tr.state.doc,
        );
        pending = null;
      }
    }
    if (lines === value.lines && pending === value.pending) return value;
    return { lines, pending };
  },
});

/** The blame of each current line, `null` where none applies. */
export function blameLinesOf(state: EditorState): readonly (GitBlameLine | null)[] {
  return state.field(blameField).lines;
}

let requestCounter = 0;

/**
 * Fetch blame for the text in `base` (what is on disk) and show it, carried
 * over any edits made while git ran. A newer call supersedes an older one.
 * `current` lets the caller drop a result once its editor is gone.
 */
export async function refreshBlame(
  view: EditorView,
  base: Text,
  fetchBlame: () => Promise<readonly GitBlameLine[]>,
  current: () => boolean,
): Promise<void> {
  const id = ++requestCounter;
  view.dispatch({ effects: blameRequested.of({ id, base }) });
  const blame = await fetchBlame();
  if (!current()) return;
  view.dispatch({ effects: blameLoaded.of({ id, blame }) });
}

type OpenCommit = (commit: GitHistoryCommit) => void;

const openCommitFacet = Facet.define<OpenCommit, OpenCommit | null>({
  combine: (values) => values[0] ?? null,
});

/** What the editor knows of the commit, in the shape the commit view opens. */
export function blameCommit(entry: GitBlameLine): GitHistoryCommit {
  return {
    sha: entry.sha,
    shortSha: entry.shortSha,
    parents: [],
    author: entry.author,
    timestamp: entry.timestamp,
    subject: entry.summary,
    refs: [],
    head: false,
  };
}

const NOT_COMMITTED = "Not committed yet";

function blameLabel(entry: GitBlameLine): string {
  const age = formatRelativeTime(entry.timestamp, Date.now());
  return `${entry.author} · ${age === "now" ? age : `${age} ago`}`;
}

// One hover card for the whole gutter: the gutter clips overflow, so it lives
// on the body and is positioned from the hovered entry.
let card: HTMLDivElement | null = null;
let cardOwner: HTMLElement | null = null;

function showCard(anchor: HTMLElement, entry: GitBlameLine) {
  card ??= document.createElement("div");
  card.className = "cm-blameCard";
  card.setAttribute("role", "tooltip");
  card.replaceChildren(
    ...[
      ["cm-blameCardSha", entry.shortSha],
      ["cm-blameCardAuthor", entry.author],
      ["cm-blameCardDate", entry.timestamp > 0 ? formatAbsoluteTime(entry.timestamp) : ""],
      ["cm-blameCardSubject", entry.summary],
    ].map(([className, text]) => {
      const row = document.createElement("div");
      row.className = className;
      row.textContent = text;
      return row;
    }),
  );
  card.style.visibility = "hidden";
  document.body.append(card);
  cardOwner = anchor;
  const rect = anchor.getBoundingClientRect();
  const height = card.offsetHeight;
  card.style.left = `${Math.round(rect.right + 6)}px`;
  card.style.top = `${Math.round(
    Math.max(8, Math.min(rect.top, window.innerHeight - height - 8)),
  )}px`;
  card.style.visibility = "visible";
}

function hideCard(anchor: HTMLElement) {
  if (cardOwner !== anchor) return;
  cardOwner = null;
  card?.remove();
}

class BlameMarker extends GutterMarker {
  constructor(
    readonly entry: GitBlameLine | null,
    readonly first: boolean,
    readonly onOpen: OpenCommit | null,
  ) {
    super();
  }

  eq(other: BlameMarker) {
    return (
      other.entry?.sha === this.entry?.sha &&
      other.first === this.first &&
      other.onOpen === this.onOpen
    );
  }

  toDOM() {
    const { entry, first, onOpen } = this;
    const el = document.createElement("div");
    el.className = `cm-blameEntry ${first ? "cm-blameFirst" : "cm-blameContinued"}`;
    if (!entry) {
      el.classList.add("cm-blameNone");
      if (first) el.textContent = NOT_COMMITTED;
      return el;
    }
    el.style.setProperty("--blame-color", authorColor(entry.author));
    if (first) el.textContent = blameLabel(entry);
    el.classList.add("cm-blameCommit");
    el.addEventListener("mouseenter", () => showCard(el, entry));
    el.addEventListener("mouseleave", () => hideCard(el));
    el.addEventListener("click", () => onOpen?.(blameCommit(entry)));
    if (first) {
      el.tabIndex = 0;
      el.setAttribute("role", "button");
      el.setAttribute(
        "aria-label",
        `${blameLabel(entry)}, ${entry.shortSha} ${entry.summary}. Open commit`,
      );
      el.addEventListener("focus", () => showCard(el, entry));
      el.addEventListener("blur", () => hideCard(el));
      el.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onOpen?.(blameCommit(entry));
      });
    }
    return el;
  }

  destroy(dom: Node) {
    hideCard(dom as HTMLElement);
  }
}

/** Lines from one commit share a run; lines with no commit share another. */
function runKey(entry: GitBlameLine | null | undefined): string {
  return entry ? entry.sha : "";
}

const blameGutter = gutter({
  class: "cm-blameGutter",
  lineMarker(view, line) {
    const { lines } = view.state.field(blameField);
    const number = view.state.doc.lineAt(line.from).number;
    const entry = lines[number - 1] ?? null;
    const first = number === 1 || runKey(lines[number - 2]) !== runKey(entry);
    return new BlameMarker(entry, first, view.state.facet(openCommitFacet));
  },
  lineMarkerChange: (update) =>
    update.startState.field(blameField).lines !== update.state.field(blameField).lines,
});

const blameTheme = EditorView.theme({
  ".cm-blameGutter": {
    width: "176px",
    minWidth: "176px",
    paddingRight: "6px",
    fontFamily: "var(--font-sans, sans-serif)",
    fontSize: "11px",
  },
  ".cm-blameEntry": {
    boxSizing: "border-box",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    paddingLeft: "6px",
    borderLeft: "2px solid transparent",
    color: "color-mix(in srgb, var(--color-content) 50%, transparent)",
  },
  ".cm-blameCommit": {
    cursor: "pointer",
    borderLeftColor: "color-mix(in srgb, var(--blame-color) 45%, transparent)",
  },
  ".cm-blameCommit:hover, .cm-blameCommit:focus-visible": {
    color: "var(--color-content)",
    borderLeftColor: "var(--blame-color)",
    outline: "none",
  },
  ".cm-blameFirst.cm-blameCommit": {
    borderLeftColor: "var(--blame-color)",
  },
  ".cm-blameNone": {
    fontStyle: "italic",
    color: "color-mix(in srgb, var(--color-content) 32%, transparent)",
  },
});

export const editorBlame = (options: { onOpenCommit: OpenCommit }): Extension => [
  blameField,
  openCommitFacet.of(options.onOpenCommit),
  blameGutter,
  blameTheme,
];
