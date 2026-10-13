import { useEffect, useRef, useState, type ReactNode } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { Decoration, EditorView, lineNumbers } from "@codemirror/view";
import { minimalSetup } from "codemirror";
import { t, useLocale } from "../../../shared/i18n/git";
import { useColorScheme } from "../../../shared/hooks/useColorScheme";
import { isLightScheme } from "../../settings/model/appearance";
import { languageForPath, schemeExtensions } from "../../files/editor/editorChrome";
import {
  conflictReplacement,
  findConflictBlocks,
  resolveConflictMarkers,
} from "../model/conflictMarkers";
import "./conflict-layout.css";

type Layout = "stacked" | "columns" | "inline";
export type ConflictSource = {
  text: string | null;
  label: string;
  origin: string;
  highlights?: { from: number; to: number }[];
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
    },
    theirs: {
      text: resolveConflictMarkers(text, "theirs"),
      label: labels("theirsLabel"),
      origin: "Incoming side of conflict markers",
      highlights: highlights("theirs"),
    },
  };
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
}: {
  path: string;
  ours: ConflictSource;
  theirs: ConflictSource;
  children: ReactNode;
  resultActions?: ReactNode;
  dirty?: boolean;
}) {
  useLocale();
  const [layout, setLayout] = useState(loadLayout);
  return (
    <div className="conflict-workspace" data-layout={layout}>
      <div className="conflict-layout-controls" role="group" aria-label={t("Conflict layout")}>
        {(
          [
            ["stacked", "Sources above result"],
            ["columns", "Current · Result · Incoming"],
            ["inline", "Inline conflicts"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
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
          </button>
        ))}
      </div>
      <div className="conflict-layout-panes">
        <section className="conflict-pane conflict-pane-result" aria-label={t("Resolved output")}>
          <header className="conflict-pane-heading">
            <div className="conflict-pane-heading-text">
              <strong>{t("Resolved output")}</strong>
              <span>
                {t("Working tree")} · {t("Editable")}
                {dirty ? " *" : ""}
              </span>
            </div>
            {resultActions}
          </header>
          {children}
        </section>
        <ConflictSourcePane side="ours" source={ours} path={path} layout={layout} />
        <ConflictSourcePane side="theirs" source={theirs} path={path} layout={layout} />
      </div>
    </div>
  );
}

function ConflictSourcePane({
  side,
  source,
  path,
  layout,
}: {
  side: "ours" | "theirs";
  source: ConflictSource;
  path: string;
  layout: Layout;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const scheme = useRef(new Compartment());
  const colorScheme = useColorScheme();
  const heading = side === "ours" ? "Current (ours)" : "Incoming (theirs)";
  useEffect(() => {
    if (!host.current || source.text === null) return;
    const language = new Compartment();
    const doc = EditorState.create({ doc: source.text }).doc;
    const ranges = (source.highlights ?? []).flatMap(({ from, to }) => {
      if (from === to) return [];
      const lines = [];
      for (let n = doc.lineAt(from).number; n <= doc.lineAt(to - 1).number; n++) {
        lines.push(Decoration.line({ class: "conflict-source-change" }).range(doc.line(n).from));
      }
      return lines;
    });
    const view = new EditorView({
      parent: host.current,
      doc: source.text,
      extensions: [
        minimalSetup,
        lineNumbers(),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.contentAttributes.of({ "aria-label": t(heading) }),
        scheme.current.of(schemeExtensions(isLightScheme() ? "light" : "dark")),
        language.of([]),
        EditorView.decorations.of(Decoration.set(ranges, true)),
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
    viewRef.current?.requestMeasure();
  }, [layout]);
  return (
    <section className={`conflict-pane conflict-pane-${side}`} aria-label={t(heading)}>
      <header className="conflict-pane-heading">
        <strong title={source.label}>
          {t(heading)}
          {source.label ? ` · ${source.label}` : ""}
        </strong>
        <span title={`${t(source.origin)} · ${source.label}`}>
          {t(source.origin)} · {t("Read only")}
        </span>
      </header>
      {source.text === null ? (
        <p className="conflict-source-missing">{t("Deleted in this version")}</p>
      ) : (
        <div className="conflict-source-editor" ref={host} />
      )}
    </section>
  );
}
