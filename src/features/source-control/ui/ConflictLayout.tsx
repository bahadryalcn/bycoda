import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { EditorState, Compartment, type Text } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { minimalSetup } from "codemirror";
import { presentableDiff } from "@codemirror/merge";
import { editorSearch } from "../../files/public/editorSearch";
import { Button } from "../../../shared/ui/Button";
import { PaneHeader } from "../../../shared/ui/PaneHeader";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import {
  ChevronDown,
  ChevronUp,
  Link,
  Search,
  PanelTop,
  SplitSquare,
  File,
} from "../../../shared/ui/icons";
import { openSearchPanel } from "@codemirror/search";
import { mergeResolution, type MergeChoice, type MergeResolution } from "../model/mergeResolution";
import { t, useLocale } from "../../../shared/i18n/git";
import { useColorScheme } from "../../../shared/hooks/useColorScheme";
import { isLightScheme } from "../../settings/public/appearance";
import { languageForPath } from "../../files/public/editorLanguage";
import { schemeExtensions } from "../../files/public/editorChrome";
import { editorReadability } from "../../files/public/editorReadability";
import { editorSurface } from "../../files/public/editorSurface";
import {
  conflictReplacement,
  findConflictBlocks,
  resolveConflictMarkers,
} from "../model/conflictMarkers";
import { stepConflict } from "./mergeResultActions";
import { ConflictScrollSync } from "./conflictScrollSync";
import { useConflictProvenance, type ConflictProvenance } from "./useConflictProvenance";
import {
  ConflictSash,
  DEFAULT_PANE_SIZES,
  clampSizes,
  loadPaneSizes,
  savePaneSizes,
  type PaneSizes,
} from "./ConflictSash";
import "./conflict-layout.css";
type Layout = "stacked" | "columns" | "inline";
export type ConflictControls = {
  state: MergeResolution;
  disabled?: boolean;
  choose: (id: number, side: MergeChoice) => void;
  chooseAll?: (side: "ours" | "theirs") => void;
  select: (id: number) => void;
  measure?: () => void;
  /** The editable result view, aligned with the sources while scrolling. */
  view?: () => EditorView | null;
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

function loadScrollSync() {
  try {
    return localStorage.getItem("bycoda.conflictScrollSync") !== "0";
  } catch {
    return true;
  }
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
  cwd,
  path,
  ours,
  theirs,
  children,
  resultActions,
  dirty = false,
  controls,
}: {
  cwd?: string;
  path: string;
  ours: ConflictSource;
  theirs: ConflictSource;
  children: ReactNode;
  resultActions?: ReactNode;
  dirty?: boolean;
  controls?: ConflictControls;
}) {
  useLocale();
  const provenance = useConflictProvenance(cwd, ours.label, theirs.label);
  const [layout, setLayout] = useState(loadLayout);
  const [sizes, setSizes] = useState(loadPaneSizes);
  const sizesRef = useRef(sizes);
  sizesRef.current = sizes;
  const panes = useRef<HTMLDivElement>(null);
  const [sync] = useState(() => new ConflictScrollSync());
  const [syncScroll, setSyncScroll] = useState(loadScrollSync);
  sync.enabled = syncScroll;
  const resultView = controls?.view?.() ?? null;
  useEffect(() => {
    if (!resultView) return;
    return sync.register("result", resultView, () => mergeResolution(resultView.state).regions);
  }, [resultView, sync]);
  useEffect(() => {
    controls?.measure?.();
  }, [layout]);
  const resize = (patch: Partial<PaneSizes>) =>
    setSizes((current) => {
      const next = clampSizes({ ...current, ...patch });
      sizesRef.current = next;
      return next;
    });
  const commitSizes = () => savePaneSizes(sizesRef.current);
  const resetSizes = (key: keyof PaneSizes) => {
    const next = clampSizes({ ...sizesRef.current, [key]: DEFAULT_PANE_SIZES[key] });
    sizesRef.current = next;
    setSizes(next);
    savePaneSizes(next);
  };
  const percent = (value: number) => `${value * 100}%`;
  const sash = (
    key: keyof PaneSizes,
    axis: "x" | "y",
    label: string,
    style: CSSProperties,
    reverse = false,
  ) => (
    <ConflictSash
      key={key}
      axis={axis}
      reverse={reverse}
      value={sizes[key]}
      label={t(label)}
      style={style}
      container={panes}
      onChange={(value) => resize({ [key]: value })}
      onCommit={commitSizes}
      onReset={() => resetSizes(key)}
    />
  );
  return (
    <div
      className="conflict-workspace"
      data-layout={layout}
      style={
        {
          "--conflict-x": percent(sizes.x),
          "--conflict-y": percent(sizes.y),
          "--conflict-c1": percent(sizes.c1),
          "--conflict-c3": percent(sizes.c3),
        } as CSSProperties
      }
    >
      <PaneHeader
        className="conflict-toolbar"
        leading={
          <div className="conflict-layout-controls">
            <SegmentedControl
              label={t("Conflict layout")}
              value={layout}
              options={[
                {
                  value: "stacked",
                  label: t("Sources above"),
                  icon: <PanelTop className="icon-sm" aria-hidden />,
                  iconOnly: true,
                },
                {
                  value: "columns",
                  label: t("Side by side"),
                  icon: <SplitSquare className="icon-sm" aria-hidden />,
                  iconOnly: true,
                },
                {
                  value: "inline",
                  label: t("Result only"),
                  icon: <File className="icon-sm" aria-hidden />,
                  iconOnly: true,
                },
              ]}
              onValueChange={(value) => {
                const next = value as Layout;
                setLayout(next);
                try {
                  localStorage.setItem("bycoda.conflictLayout", next);
                } catch {
                  /* In-memory preference still works. */
                }
              }}
            />
            {layout !== "inline" ? (
              <Button
                variant="ghost"
                size="sm"
                motion="none"
                iconOnly
                label={t("Sync scrolling")}
                tooltip={t("Keep matching conflicts aligned while scrolling")}
                pressed={syncScroll}
                onClick={() => {
                  const next = !syncScroll;
                  setSyncScroll(next);
                  sync.enabled = next;
                  if (next) sync.follow("result");
                  try {
                    localStorage.setItem("bycoda.conflictScrollSync", next ? "1" : "0");
                  } catch {
                    /* In-memory preference still works. */
                  }
                }}
              >
                <Link className="icon-sm" />
              </Button>
            ) : null}
          </div>
        }
        actions={
          controls ? (
            <div className="conflict-navigation" role="group" aria-label={t("Merge conflicts")}>
              <span
                role="status"
                className="conflict-progress"
                data-complete={controls.state.regions.every((region) => region.choice !== null)}
              >
                {`${controls.state.active + 1} / ${controls.state.regions.length}`}
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
                <ChevronUp className="icon-sm" />
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
                <ChevronDown className="icon-sm" />
              </Button>
            </div>
          ) : undefined
        }
      >
        {provenance ? (
          <Tooltip label={[provenance.ours.detail, provenance.theirs.detail].join(" ← ")}>
            <div className="conflict-provenance">
              <span className="conflict-provenance-operation">
                {t(
                  provenance.operation === "rebase"
                    ? "Rebase"
                    : provenance.operation === "cherry-pick"
                      ? "Cherry-pick"
                      : provenance.operation === "revert"
                        ? "Revert"
                        : "Merge",
                )}
              </span>
              <strong>{provenance.ours.label || t("Current")}</strong>
              <span aria-hidden="true">←</span>
              <strong>{provenance.theirs.label || t("Incoming")}</strong>
            </div>
          </Tooltip>
        ) : null}
      </PaneHeader>
      <div className="conflict-layout-panes" ref={panes}>
        <section className="conflict-pane conflict-pane-result" aria-label={t("Resolved output")}>
          <PaneHeader
            as="header"
            titleAs="div"
            className="conflict-pane-header"
            title={`${t("Resolved output")}${dirty ? " *" : ""}`}
            meta={
              <span className="conflict-result-meta">{`${t("Working tree")} · ${t("Editable")}`}</span>
            }
            actions={resultActions}
          />
          {children}
        </section>
        <ConflictSourcePane
          side="ours"
          source={ours}
          provenance={provenance?.ours}
          path={path}
          layout={layout}
          controls={controls}
          sync={sync}
        />
        <ConflictSourcePane
          side="theirs"
          source={theirs}
          provenance={provenance?.theirs}
          path={path}
          layout={layout}
          controls={controls}
          sync={sync}
        />
        {layout === "stacked"
          ? [
              sash("x", "x", "Resize source panes", {
                insetInlineStart: percent(sizes.x),
                insetBlockStart: 0,
                blockSize: percent(sizes.y),
              }),
              sash("y", "y", "Resize sources and result", {
                insetBlockStart: percent(sizes.y),
                insetInlineStart: 0,
                inlineSize: "100%",
              }),
            ]
          : layout === "columns"
            ? [
                sash("c1", "x", "Resize current pane", {
                  insetInlineStart: percent(sizes.c1),
                  insetBlockStart: 0,
                  blockSize: "100%",
                }),
                sash(
                  "c3",
                  "x",
                  "Resize incoming pane",
                  {
                    insetInlineStart: percent(1 - sizes.c3),
                    insetBlockStart: 0,
                    blockSize: "100%",
                  },
                  true,
                ),
              ]
            : null}
      </div>
    </div>
  );
}

function ConflictSourcePane({
  provenance,
  side,
  source,
  path,
  layout,
  controls,
  sync,
}: {
  provenance?: ConflictProvenance;
  side: "ours" | "theirs";
  source: ConflictSource;
  path: string;
  layout: Layout;
  controls?: ConflictControls;
  sync: ConflictScrollSync;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const scheme = useRef(new Compartment());
  const decorations = useRef(new Compartment());
  const controlsRef = useRef(controls);
  controlsRef.current = controls;
  const colorScheme = useColorScheme();
  const heading = side === "ours" ? "Current" : "Incoming";
  const identity = provenance?.label
    ? provenance.label
    : source.label.replace(/^([a-f0-9]{7})[a-f0-9]{1,33}(?=\s|$)/i, "$1");
  useEffect(() => {
    if (!host.current || source.text === null) return;
    const language = new Compartment();
    const doc = EditorState.create({ doc: source.text }).doc;
    const view = new EditorView({
      parent: host.current,
      doc: source.text,
      extensions: [
        minimalSetup,
        editorSurface,
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
        editorReadability(path),
        decorations.current.of(
          EditorView.decorations.of(
            sourceDecorations(doc, source, controlsRef.current?.state.active ?? 0),
          ),
        ),
        EditorView.decorations.of(
          Decoration.set(
            (source.highlights ?? []).map((range, id) =>
              Decoration.widget({
                widget: new SourceChoiceWidget(id, side, () => controlsRef.current),
                block: true,
                side: -1,
              }).range(doc.lineAt(range.from).from),
            ),
            true,
          ),
        ),
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
    const unregister = sync.register(side, view, () => source.highlights ?? []);
    view.dispatch({
      effects: EditorView.scrollIntoView(source.highlights?.[0]?.from ?? 0, { y: "center" }),
    });
    let disposed = false;
    void languageForPath(path).then((extension) => {
      if (!disposed && extension) view.dispatch({ effects: language.reconfigure(extension) });
    });
    return () => {
      disposed = true;
      unregister();
      viewRef.current = null;
      view.destroy();
    };
  }, [path, source.text, source.highlights, heading, sync, side]);
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
      button.disabled = !controls || !!controls.disabled;
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
      <PaneHeader
        as="header"
        titleAs="div"
        className="conflict-pane-header"
        icon={<span className="conflict-side-dot" />}
        title={t(heading)}
        meta={
          <Tooltip
            asChild
            label={`${t(source.origin)} · ${t("Read only")} · ${provenance?.detail ?? source.label}`}
          >
            <span className="conflict-source-identity" data-origin={t(source.origin)}>
              {identity ? <strong>{identity}</strong> : null}
              {provenance?.subject ? <span>{provenance.subject}</span> : null}
            </span>
          </Tooltip>
        }
        actions={
          <>
            {controls?.chooseAll ? (
              <Button
                variant="ghost"
                size="sm"
                motion="none"
                label={t(side === "ours" ? "Accept All Current" : "Accept All Incoming")}
                tooltip={t("Accept this side for every conflict in this file")}
                disabled={controls.disabled}
                onClick={() => controls.chooseAll?.(side)}
              >
                {t("Accept all")}
              </Button>
            ) : null}
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
              <Search className="icon-sm" />
            </Button>
          </>
        }
      />
      {source.text === null ? (
        <p className="conflict-source-missing">{t("Deleted in this version")}</p>
      ) : (
        <div className="conflict-source-editor" ref={host} />
      )}
    </section>
  );
}

/** Each source conflict carries its accept action directly above it, like the
 * result widgets. Pressed/disabled state is synced from React by the pane effect. */
class SourceChoiceWidget extends WidgetType {
  constructor(
    readonly id: number,
    readonly side: "ours" | "theirs",
    readonly controls: () => ConflictControls | undefined,
  ) {
    super();
  }
  override eq(other: SourceChoiceWidget) {
    return other.id === this.id && other.side === this.side;
  }
  toDOM() {
    const root = document.createElement("div");
    root.className = "conflict-inline-actions conflict-source-actions";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "conflict-inline-choice";
    button.dataset.mergeChoice = String(this.id);
    const controls = this.controls();
    button.disabled = !controls || !!controls.disabled;
    const choice = controls?.state.regions[this.id]?.choice;
    button.setAttribute("aria-pressed", String(choice === this.side || choice === "both"));
    button.textContent = t(this.side === "ours" ? "Accept Current" : "Accept Incoming");
    button.title = t(this.side === "ours" ? "Accept Current (Alt+1)" : "Accept Incoming (Alt+2)");
    button.setAttribute(
      "aria-label",
      `${button.textContent} · ${t("Conflict {p0} of {p1}", {
        p0: this.id + 1,
        p1: controls?.state.regions.length ?? this.id + 1,
      })}`,
    );
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      const current = this.controls();
      if (current && !current.disabled) current.choose(this.id, this.side);
    });
    root.append(button);
    return root;
  }
  override ignoreEvent() {
    return true;
  }
}
