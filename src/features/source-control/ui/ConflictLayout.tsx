import { useEffect, useRef, useState, type ReactNode } from "react";
import { EditorState, Compartment, type Text } from "@codemirror/state";
import { Decoration, EditorView, lineNumbers, gutter, GutterMarker } from "@codemirror/view";
import { RangeSet } from "@codemirror/state";
import { minimalSetup } from "codemirror";
import { presentableDiff } from "@codemirror/merge";
import { editorSearch } from "../../files/editor/editorSearch";
import { Button } from "../../../shared/ui/Button";
import { ChevronDown, ChevronUp, Search } from "../../../shared/ui/icons";
import { openSearchPanel } from "@codemirror/search";
import type { MergeChoice, MergeResolution } from "../model/mergeResolution";
import { t, useLocale } from "../../../shared/i18n/git";
import { useColorScheme } from "../../../shared/hooks/useColorScheme";
import { isLightScheme } from "../../settings/model/appearance";
import { languageForPath, schemeExtensions } from "../../files/editor/editorChrome";
import {
  conflictReplacement,
  findConflictBlocks,
  resolveConflictMarkers,
} from "../model/conflictMarkers";
import { stepConflict } from "./mergeResultActions";
import "./conflict-layout.css";

type Layout = "stacked" | "columns" | "inline";
export type ConflictControls = {
  state: MergeResolution;
  disabled?: boolean;
  choose: (id: number, side: MergeChoice) => void;
  select: (id: number) => void;
  measure?: () => void;
};
export type ConflictSource = {
  text: string | null;
  label: string;
  origin: string;
  highlights?: { from: number; to: number }[];
  /** The other side's text for each highlight, used for intra-conflict differences. */
  counterparts?: string[];
};

/** Marker labels describe Git's sides without assuming ours means the user's branch
 * (which would be misleading during a rebase). These are previews, not index blobs. */
export function conflictSourcesFromMarkers(text: string) {
  text = text.replace(/\r\n?/g, "\n");
  const blocks = findConflictBlocks(text);
  const labels = (side: "oursLabel" | "theirsLabel") =>
    [...new Set(blocks.map((block) => block[side]).filter(Boolean))].join(", ");
  const highlights = (side: "ours" | "theirs") => {
    let removed = 0;
    return blocks.map((block) => {
      const length = conflictReplacement(text, block, side).length;
      const from = block.from - removed;
      removed += block.to - block.from - length;
      return { from, to: from + length };
    });
  };
  return {
    ours: {
      text: resolveConflictMarkers(text, "ours"),
      label: labels("oursLabel"),
      origin: "Current side of conflict markers",
      highlights: highlights("ours"),
      counterparts: blocks.map((block) => conflictReplacement(text, block, "theirs")),
    },
    theirs: {
      text: resolveConflictMarkers(text, "theirs"),
      label: labels("theirsLabel"),
      origin: "Incoming side of conflict markers",
      highlights: highlights("theirs"),
      counterparts: blocks.map((block) => conflictReplacement(text, block, "ours")),
    },
  };
}

/** Line tint marks each conflict; inner marks show what differs from the other side. */
function sourceDecorations(doc: Text, source: ConflictSource, active: number) {
  return Decoration.set(
    (source.highlights ?? []).flatMap(({ from, to }, index) => {
      if (from === to) return [];
      const ranges = [];
      for (let n = doc.lineAt(from).number; n <= doc.lineAt(to - 1).number; n++)
        ranges.push(
          Decoration.line({
            class:
              index === active
                ? "conflict-source-change conflict-source-active"
                : "conflict-source-change",
          }).range(doc.line(n).from),
        );
      const other = source.counterparts?.[index];
      if (other) {
        for (const change of presentableDiff(doc.sliceString(from, to), other, {
          scanLimit: 500,
        })) {
          // A side with nothing in common is already conveyed by the line tint.
          if (change.fromA === change.toA || change.toA - change.fromA === to - from) continue;
          ranges.push(
            Decoration.mark({ class: "conflict-source-word" }).range(
              from + change.fromA,
              from + change.toA,
            ),
          );
        }
      }
      return ranges;
    }),
    true,
  );
}

function loadLayout(): Layout {
  try {
    const value = localStorage.getItem("bycoda.conflictLayout");
    return value === "columns" || value === "inline" ? value : "stacked";
  } catch {
    return "stacked";
  }
}

/** CSS changes placement only: the result editor never remounts on a layout switch. */
export function ConflictLayout({
  path,
  ours,
  theirs,
  children,
  resultActions,
  dirty = false,
  controls,
}: {
  path: string;
  ours: ConflictSource;
  theirs: ConflictSource;
  children: ReactNode;
  resultActions?: ReactNode;
  dirty?: boolean;
  controls?: ConflictControls;
}) {
  useLocale();
  const [layout, setLayout] = useState(loadLayout);
  useEffect(() => {
    controls?.measure?.();
  }, [layout]);
  return (
    <div className="conflict-workspace" data-layout={layout}>
      <div className="conflict-layout-controls" role="group" aria-label={t("Conflict layout")}>
        {(
          [
            ["stacked", "Sources above"],
            ["columns", "Side by side"],
            ["inline", "Result only"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            variant="tab"
            size="sm"
            motion="none"
            aria-pressed={layout === value}
            onClick={() => {
              setLayout(value);
              try {
                localStorage.setItem("bycoda.conflictLayout", value);
              } catch {
                /* In-memory preference still works. */
              }
            }}
          >
            {t(label)}
          </Button>
        ))}
        {controls ? (
          <div className="conflict-navigation" role="group" aria-label={t("Merge conflicts")}>
            <span
              role="status"
              className="conflict-progress"
              data-complete={controls.state.regions.every((region) => region.choice !== null)}
            >
              {t("Conflict {p0} of {p1}", {
                p0: controls.state.active + 1,
                p1: controls.state.regions.length,
              })}
              {" · "}
              {t("{p0} unresolved", {
                p0: controls.state.regions.filter((region) => region.choice === null).length,
              })}
            </span>
            <Button
              variant="ghost"
              size="sm"
              motion="none"
              iconOnly
              label={t("Previous conflict")}
              tooltip={t("Previous conflict (Shift+F7)")}
              disabled={controls.disabled || controls.state.regions.length < 2}
              onClick={() => controls.select(stepConflict(controls.state, -1))}
            >
              <ChevronUp size={14} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              motion="none"
              iconOnly
              label={t("Next conflict")}
              tooltip={t("Next conflict (F7)")}
              disabled={controls.disabled || controls.state.regions.length < 2}
              onClick={() => controls.select(stepConflict(controls.state, 1))}
            >
              <ChevronDown size={14} />
            </Button>
          </div>
        ) : null}
      </div>
      <div className="conflict-layout-panes">
        <section className="conflict-pane conflict-pane-result" aria-label={t("Resolved output")}>
          <header className="conflict-pane-heading">
            <strong
              className="conflict-pane-heading-text"
              title={`${t("Working tree")} · ${t("Editable")}`}
            >
              {t("Resolved output")}
              {dirty ? " *" : ""}
            </strong>
            <div className="conflict-pane-actions">{resultActions}</div>
          </header>
          {children}
        </section>
        <ConflictSourcePane
          side="ours"
          source={ours}
          path={path}
          layout={layout}
          controls={controls}
        />
        <ConflictSourcePane
          side="theirs"
          source={theirs}
          path={path}
          layout={layout}
          controls={controls}
        />
      </div>
    </div>
  );
}

function ConflictSourcePane({
  side,
  source,
  path,
  layout,
  controls,
}: {
  side: "ours" | "theirs";
  source: ConflictSource;
  path: string;
  layout: Layout;
  controls?: ConflictControls;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const scheme = useRef(new Compartment());
  const decorations = useRef(new Compartment());
  const controlsRef = useRef(controls);
  controlsRef.current = controls;
  const colorScheme = useColorScheme();
  const heading = side === "ours" ? "Current (ours)" : "Incoming (theirs)";
  useEffect(() => {
    if (!host.current || source.text === null) return;
    const language = new Compartment();
    const doc = EditorState.create({ doc: source.text }).doc;
    const view = new EditorView({
      parent: host.current,
      doc: source.text,
      extensions: [
        minimalSetup,
        lineNumbers(),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.contentAttributes.of({
          "aria-label": t(heading),
          tabindex: "0",
          "aria-readonly": "true",
        }),
        editorSearch,
        scheme.current.of(schemeExtensions(isLightScheme() ? "light" : "dark")),
        language.of([]),
        decorations.current.of(
          EditorView.decorations.of(
            sourceDecorations(doc, source, controlsRef.current?.state.active ?? 0),
          ),
        ),
        gutter({
          class: "conflict-choice-gutter",
          markers: () =>
            RangeSet.of(
              (source.highlights ?? []).map((range, id) =>
                new SourceChoiceMarker(id, side, () => controlsRef.current).range(
                  doc.lineAt(range.from).from,
                ),
              ),
              true,
            ),
        }),
        EditorView.domEventHandlers({
          mousedown: (event, view) => {
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos == null) return false;
            const index =
              source.highlights?.findIndex((range) => pos >= range.from && pos <= range.to) ?? -1;
            if (index >= 0) controlsRef.current?.select(index);
            return false;
          },
        }),
      ],
      // Sources are immutable, so these ranges require no update field.
    });
    viewRef.current = view;
    view.dispatch({
      effects: EditorView.scrollIntoView(source.highlights?.[0]?.from ?? 0, { y: "center" }),
    });
    let disposed = false;
    void languageForPath(path).then((extension) => {
      if (!disposed && extension) view.dispatch({ effects: language.reconfigure(extension) });
    });
    return () => {
      disposed = true;
      viewRef.current = null;
      view.destroy();
    };
  }, [path, source.text, source.highlights, heading]);
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: scheme.current.reconfigure(schemeExtensions(colorScheme)),
    });
  }, [colorScheme]);
  useEffect(() => {
    const view = viewRef.current;
    const range = source.highlights?.[controlsRef.current?.state.active ?? 0];
    view?.requestMeasure();
    if (view && range)
      view.dispatch({ effects: EditorView.scrollIntoView(range.from, { y: "center" }) });
  }, [layout]);
  useEffect(() => {
    for (const button of host.current?.querySelectorAll<HTMLButtonElement>("[data-merge-choice]") ??
      []) {
      const choice = controls?.state.regions[Number(button.dataset.mergeChoice)]?.choice;
      button.setAttribute("aria-pressed", String(choice === side || choice === "both"));
      button.disabled = !!controls?.disabled;
    }
  }, [controls?.state.regions, controls?.disabled, side]);
  useEffect(() => {
    const view = viewRef.current;
    const range = source.highlights?.[controls?.state.active ?? 0];
    if (!view || !range) return;
    const marks = sourceDecorations(view.state.doc, source, controls?.state.active ?? 0);
    view.dispatch({
      effects: [
        decorations.current.reconfigure(EditorView.decorations.of(marks)),
        EditorView.scrollIntoView(range.from, { y: "center" }),
      ],
    });
  }, [controls?.state.active, source.highlights]);
  return (
    <section className={`conflict-pane conflict-pane-${side}`} aria-label={t(heading)}>
      <header className="conflict-pane-heading">
        <div className="conflict-source-title">
          <strong title={`${t(source.origin)} · ${t("Read only")}`}>
            {t(heading)}
            {source.label ? ` · ${source.label}` : ""}
          </strong>
          <div className="conflict-pane-actions">
            <Button
              variant="ghost"
              size="sm"
              motion="none"
              iconOnly
              label={t("Find in this pane")}
              onClick={() => {
                const view = viewRef.current;
                if (view) openSearchPanel(view);
              }}
            >
              <Search size={14} />
            </Button>
          </div>
        </div>
      </header>
      {source.text === null ? (
        <p className="conflict-source-missing">{t("Deleted in this version")}</p>
      ) : (
        <div className="conflict-source-editor" ref={host} />
      )}
    </section>
  );
}

/** A source-line action is a CodeMirror gutter control, not an application toolbar. */
class SourceChoiceMarker extends GutterMarker {
  constructor(
    readonly id: number,
    readonly side: "ours" | "theirs",
    readonly controls: () => ConflictControls | undefined,
  ) {
    super();
  }
  toDOM() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "conflict-gutter-choice";
    button.dataset.mergeChoice = String(this.id);
    button.disabled = !!this.controls()?.disabled;
    const choice = this.controls()?.state.regions[this.id]?.choice;
    button.setAttribute("aria-pressed", String(choice === this.side || choice === "both"));
    button.textContent = this.side === "ours" ? "»" : "«";
    button.title = t(
      this.side === "ours" ? "Use current conflict {p0}" : "Use incoming conflict {p0}",
      { p0: this.id + 1 },
    );
    button.setAttribute("aria-label", button.title);
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      const controls = this.controls();
      if (controls && !controls.disabled) controls.choose(this.id, this.side);
    });
    return button;
  }
}
