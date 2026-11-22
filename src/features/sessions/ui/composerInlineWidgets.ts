import {
  EditorState,
  StateEffect,
  StateField,
  type ChangeDesc,
  type Extension,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { openExternal } from "../../../platform/tauri/openExternal";
import {
  isInlineMentionMark,
  type InlineReference,
  type InlineReferenceContext,
} from "./composerInlineReferences";
import { createInlineScan, updateInlineScan, type InlineScan } from "./composerInlineScan";
import styles from "../../../shared/ui/DraftToken.module.css";
import { textAttributes } from "../../../shared/ui/Text";

const namespace = "http://www.w3.org/2000/svg";
const iconPaths = {
  image: "M3 4h18v16H3z M6 17l5-5 3 3 3-4 3 4 M7 8h2v2H7z",
  file: "M6 3h8l4 4v13H6z M14 3v5h4 M9 12h6m-6 4h6",
  code: "m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16",
  spreadsheet: "M4 5h16v14H4z M4 10h16m-16 4h16M10 10v9",
  json: "M9 4H7a2 2 0 0 0-2 2v4l-2 2 2 2v4a2 2 0 0 0 2 2h2m6-16h2a2 2 0 0 1 2 2v4l2 2-2 2v4a2 2 0 0 1-2 2h-2",
  skill: "M3 6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z m11.5 2-5 8",
  group:
    "M3 6a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z m9 1-4 6m13-6v12a2 2 0 0 1-2 2H7",
  link: "M10 13a3 3 0 0 0 4.2 0l4-4a3 3 0 0 0-4.2-4.2l-2 2m2 4a3 3 0 0 0-4.2 0l-4 4A3 3 0 0 0 10 19l2-2",
  external: "M14 4h6v6m0-6-9 9m7-2v8H5V6h8",
  down: "m6 9 6 6 6-6",
  quote: "M4 7h6v7l-3 3m7-10h6v7l-3 3",
};

function icon(document: Document, path: keyof typeof iconPaths) {
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const element = document.createElementNS(namespace, "path");
  element.setAttribute("d", iconPaths[path]);
  svg.append(element);
  return svg;
}

function referenceIcon(ref: InlineReference): keyof typeof iconPaths {
  switch (ref.kind) {
    case "skill":
    case "group":
    case "quote":
      return ref.kind;
    case "url":
      return "link";
    case "file":
    case "mcp":
      return "code";
    case "attachment":
      if (ref.tone === "image") return "image";
      if (/\.json$/i.test(ref.label)) return "json";
      if (/\.(?:csv|tsv|xlsx?)$/i.test(ref.label)) return "spreadsheet";
  }
  return "file";
}

function atomicDecorations(decorations: DecorationSet, references: readonly InlineReference[]) {
  return references.some(isInlineMentionMark)
    ? decorations.update({ filter: (_from, _to, value) => Boolean(value.spec.widget) })
    : decorations;
}

const { className: mentionClassName, "data-tone": mentionTone } = textAttributes(
  { tone: "accent" },
  styles.token,
);

type WidgetActions = {
  open(reference: InlineReference, anchor: HTMLElement): void;
  remove(id: string): void;
  menu(reference: InlineReference, anchor: HTMLElement): void;
  openLabel(reference: InlineReference): string;
};

class ReferenceWidget extends WidgetType {
  constructor(
    readonly reference: InlineReference,
    readonly actions: WidgetActions,
  ) {
    super();
  }

  override eq(other: ReferenceWidget) {
    const a = this.reference;
    const b = other.reference;
    return (
      a.kind === b.kind &&
      a.value === b.value &&
      a.label === b.label &&
      a.detail === b.detail &&
      a.tone === b.tone
    );
  }

  toDOM(view: EditorView) {
    const { reference: ref, actions } = this;
    const document = view.dom.ownerDocument;
    const interactive = ref.kind !== "quote" && ref.kind !== "mcp";
    const chip = document.createElement(ref.kind === "url" ? "a" : interactive ? "button" : "span");
    chip.className = styles.compact;
    chip.dataset.inlineReference = ref.kind;
    chip.dataset.attachmentKind = ref.tone;
    const mark = referenceIcon(ref);
    chip.dataset.inlineIcon = mark;
    chip.contentEditable = "false";
    chip.spellcheck = false;
    if (chip instanceof HTMLButtonElement) {
      chip.type = "button";
      chip.setAttribute("aria-label", actions.openLabel(ref));
      if (ref.kind !== "file") chip.setAttribute("aria-haspopup", "dialog");
      chip.addEventListener("click", () => actions.open(ref, chip));
      if (ref.kind === "attachment")
        chip.addEventListener("keydown", (event) => {
          if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            event.stopPropagation();
            actions.remove(ref.value);
          }
        });
      if (ref.kind === "attachment")
        chip.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          actions.menu(ref, chip);
        });
    } else if (chip instanceof HTMLAnchorElement) {
      chip.href = ref.value;
      chip.setAttribute("aria-label", ref.value);
      chip.addEventListener("click", (event) => {
        event.preventDefault();
        void openExternal(ref.value).catch((error: unknown) =>
          console.error("Failed to open composer link:", error),
        );
      });
      chip.addEventListener("keydown", (event) => {
        if (event.key !== "F2") return;
        event.preventDefault();
        event.stopPropagation();
        view.dispatch({ selection: { anchor: view.posAtDOM(chip) + 1 } });
        view.focus();
      });
    }
    const label = document.createElement("span");
    label.textContent = ref.label;
    chip.append(icon(document, mark), label);
    if (ref.detail) {
      const detail = document.createElement("small");
      detail.textContent = ref.detail;
      chip.append(detail);
    }
    if (ref.kind === "url" || ref.kind === "group")
      chip.append(icon(document, ref.kind === "url" ? "external" : "down"));
    return chip;
  }
}

/** Whether `next` is `previous` carried through `changes` with no edit at any widget's edge. */
function sameReferences(
  previous: readonly InlineReference[],
  next: readonly InlineReference[],
  changes: ChangeDesc,
) {
  return (
    previous.length === next.length &&
    previous.every((a, index) => {
      const b = next[index]!;
      return (
        a.kind === b.kind &&
        a.value === b.value &&
        a.label === b.label &&
        a.detail === b.detail &&
        a.tone === b.tone &&
        changes.mapPos(a.start, -1) === b.start &&
        changes.mapPos(a.start, 1) === b.start &&
        changes.mapPos(a.end, -1) === b.end &&
        changes.mapPos(a.end, 1) === b.end
      );
    })
  );
}

export function inlineComposerWidgets(initial: InlineReferenceContext, actions: WidgetActions) {
  const configure = StateEffect.define<InlineReferenceContext>();
  const decorate = (references: InlineReference[], edited?: InlineReference): DecorationSet =>
    Decoration.set(
      references
        .filter((reference) => reference !== edited)
        .map((reference) => {
          const decoration = isInlineMentionMark(reference)
            ? Decoration.mark({
                class: mentionClassName,
                attributes: { "data-scoped-mention": reference.kind, "data-tone": mentionTone },
              })
            : Decoration.replace({ widget: new ReferenceWidget(reference, actions) });
          return decoration.range(reference.start, reference.end);
        }),
    );
  const ranges = StateField.define<{
    context: InlineReferenceContext;
    scan: InlineScan;
    references: InlineReference[];
    edited?: InlineReference;
    decorations: DecorationSet;
    atomic: DecorationSet;
  }>({
    create(state) {
      const scan = createInlineScan(state, initial);
      const decorations = decorate(scan.references);
      return {
        context: initial,
        scan,
        references: scan.references,
        decorations,
        atomic: atomicDecorations(decorations, scan.references),
      };
    },
    update(value, transaction) {
      const context =
        transaction.effects.find((effect) => effect.is(configure))?.value ?? value.context;
      // Each edit rescans only the lines it touched and reparses only the blocks it changed.
      const scan =
        transaction.docChanged || context !== value.context
          ? updateInlineScan(
              value.scan,
              transaction.newDoc.toString(),
              transaction.changes,
              context,
            )
          : value.scan;
      const { references } = scan;
      const { head } = transaction.newSelection.main;
      const edited = references.find(
        (item) => item.kind === "url" && item.start < head && item.end > head,
      );
      if (scan === value.scan && edited === value.edited) return value;
      // Typing that leaves every widget as it was keeps their decorations, shifted by the edit.
      const decorations =
        !edited &&
        !value.edited &&
        sameReferences(value.references, references, transaction.changes)
          ? value.decorations.map(transaction.changes)
          : decorate(references, edited);
      return {
        context,
        scan,
        references,
        edited,
        decorations,
        atomic: atomicDecorations(decorations, references),
      };
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
  });
  const extension: Extension = [
    ranges,
    EditorView.atomicRanges.of((view) => view.state.field(ranges).atomic),
    EditorState.transactionFilter.of((transaction) => {
      if (
        !transaction.isUserEvent("input.type") ||
        transaction.isUserEvent("input.type.compose") ||
        !transaction.docChanged
      )
        return transaction;
      let split: number | undefined;
      transaction.changes.iterChanges((from, to, _fromB, toB, inserted) => {
        if (from !== to || !inserted.length || /\s$/.test(inserted.toString())) return;
        transaction.startState
          .field(ranges)
          .decorations.between(from, from, (edge, _end, decoration) => {
            const widget = decoration.spec.widget;
            if (
              edge === from &&
              widget instanceof ReferenceWidget &&
              (widget.reference.kind === "skill" || widget.reference.kind === "group")
            )
              split = toB;
          });
      });
      if (split === undefined) return transaction;
      return [
        transaction,
        { sequential: true, changes: { from: split, insert: " " }, selection: { anchor: split } },
      ];
    }),
  ];
  return { configure, extension };
}
