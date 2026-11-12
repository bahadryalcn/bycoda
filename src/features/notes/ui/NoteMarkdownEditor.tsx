import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Popover } from "../../../shared/ui/Popover";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { indentWithTab, redo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { openSearchPanel } from "@codemirror/search";
import { Annotation, Compartment, Prec, type Text } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, placeholder } from "@codemirror/view";
import { minimalSetup } from "codemirror";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MOD } from "../../../platform/tauri/platform";
import { useColorScheme } from "../../../shared/hooks/useColorScheme";
import {
  BlockQuote,
  Bold,
  CheckList,
  CodeBlock,
  Heading,
  ImagePlus,
  Italic,
  Link,
  ListBullet,
  ListNumbered,
  Minus,
  MoreHorizontal,
  Search,
  Strikethrough,
  Table,
  type IconComponent,
} from "../../../shared/ui/icons";
import { filesFromClipboard } from "../../sessions/model/attachments";
import { schemeExtensions } from "../../files/editor/editorChrome";
import { editorSearch, openReplacePanel } from "../../files/editor/editorSearch";
import { markdownEdit, type MarkdownCommand } from "../markdownCommands";
import type {
  NativeInputObserver,
  NativeInputRegistration,
  NativeInputPublication,
} from "../../../shared/lib/native-input-observer";
import { consumeNativeInputPublication } from "../../../shared/lib/native-input-observer";
import { installEditorInputGate } from "../../files/ui/useMountedEditorClosure";
import { canRetainNoteInputText } from "../notesInputOwners";

export type NoteEditorViewRef = { current: EditorView | null };

// Marks a change that came from the note itself rather than from typing.
const externalChange = Annotation.define<boolean>();

function normalizeLineBreaks(value: string) {
  return value.replace(/\r\n?/g, "\n");
}

export function runMarkdownCommand(view: EditorView, command: MarkdownCommand) {
  const { from, to } = view.state.selection.main;
  const edit = markdownEdit(command, view.state.doc.toString(), from, to);
  view.dispatch({
    changes: { from: edit.from, to: edit.to, insert: edit.insert },
    selection: { anchor: edit.anchor, head: edit.head },
    scrollIntoView: true,
    userEvent: "input",
  });
  view.focus();
  return true;
}

// CodeMirror documents are immutable, so one string per document version serves the
// input-retention check and the change listener of the same transaction.
const documentTexts = new WeakMap<Text, string>();
function documentText(doc: Text): string {
  let text = documentTexts.get(doc);
  if (text === undefined) {
    text = doc.toString();
    documentTexts.set(doc, text);
  }
  return text;
}

// The owning pane scrolls, so the editor grows with its text.
const noteEditorTheme = (minHeight: number, prose: boolean) =>
  EditorView.theme({
    "&.cm-editor": {
      height: "auto",
    },
    "&.cm-editor .cm-scroller": {
      overflow: "visible",
      lineHeight: "var(--ui-leading-body)",
      ...(prose ? { fontFamily: "var(--font-sans)", fontSize: "var(--ui-font-body)" } : {}),
    },
    "&.cm-editor .cm-content": {
      minHeight: `${minHeight}px`,
      paddingTop: "0",
      cursor: "text",
    },
    "&.cm-editor .cm-panels.cm-panels-top": {
      backgroundColor: "var(--ui-surface)",
      marginBottom: "8px",
    },
  });

export function NoteMarkdownEditor({
  value,
  onChange,
  onSave,
  onPasteImages,
  viewRef,
  autoFocus = false,
  minHeight = 448,
  showLineNumbers = true,
  onFocus,
  label,
  inputObserver,
  inputPublication,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  /** Pasted image files; text pastes still go to the editor. */
  onPasteImages?: (files: File[]) => void;
  viewRef: NoteEditorViewRef;
  autoFocus?: boolean;
  minHeight?: number;
  showLineNumbers?: boolean;
  onFocus?: () => void;
  label?: string;
  inputObserver?: NativeInputObserver;
  inputPublication?: NativeInputPublication;
}) {
  useLocale();
  const hostRef = useRef<HTMLDivElement>(null);
  const scheme = useColorScheme();
  const schemeConfig = useRef(new Compartment());
  const initial = useRef({ scheme, autoFocus, minHeight, showLineNumbers });
  const valueRef = useRef(value);
  const documentValue = useRef<string | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onPasteImagesRef = useRef(onPasteImages);
  const inputRef = useRef<NativeInputRegistration | null>(null);
  valueRef.current = value;
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onPasteImagesRef.current = onPasteImages;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    documentValue.current = normalizeLineBreaks(valueRef.current);
    let composing = false;
    let settling = false;
    const view = new EditorView({
      doc: documentValue.current,
      parent: host,
      extensions: [
        minimalSetup,
        ...(initial.current.showLineNumbers ? [lineNumbers()] : []),
        EditorView.lineWrapping,
        markdown(),
        placeholder(t("Write markdown…")),
        schemeConfig.current.of(schemeExtensions(initial.current.scheme)),
        noteEditorTheme(initial.current.minHeight, !initial.current.showLineNumbers),
        EditorView.contentAttributes.of({
          "aria-label": label ?? t("Note body"),
          spellcheck: "true",
        }),
        editorSearch,
        // Keep a match clear of the find panel pinned to the top of the page.
        EditorView.scrollMargins.of((view) => ({
          top: view.dom.querySelector<HTMLElement>(".cm-panels-top")?.offsetHeight ?? 0,
        })),
        Prec.high(
          keymap.of([
            { key: "Mod-b", run: (view) => runMarkdownCommand(view, "bold") },
            { key: "Mod-i", run: (view) => runMarkdownCommand(view, "italic") },
            { key: "Mod-Shift-z", run: redo, preventDefault: true },
            {
              key: "Mod-h",
              run: openReplacePanel,
              scope: "editor search-panel",
              preventDefault: true,
            },
            {
              key: "Mod-s",
              run: () => {
                onSaveRef.current();
                return true;
              },
              scope: "editor search-panel",
              preventDefault: true,
            },
            indentWithTab,
          ]),
        ),
        EditorView.domEventHandlers({
          compositionstart: () => {
            composing = true;
            inputRef.current?.changed();
          },
          compositionend: () => {
            composing = false;
            settling = true;
            inputRef.current?.changed();
            view.requestMeasure({
              read: () => null,
              write: () => {
                if (viewRef.current === view && !view.compositionStarted) {
                  settling = false;
                  inputRef.current?.changed();
                }
              },
            });
          },
          paste: (event) => {
            if (inputRef.current && !inputRef.current.allowed()) {
              event.preventDefault();
              return true;
            }
            const onImages = onPasteImagesRef.current;
            if (!onImages) return false;
            const images = filesFromClipboard(event.clipboardData).filter((file) =>
              file.type.startsWith("image/"),
            );
            if (images.length === 0) return false;
            event.preventDefault();
            onImages(images);
            return true;
          },
          // Dropped files belong to the note's image drop zone, not to
          // CodeMirror, which would insert their bytes as text.
          drop: (event) => [...(event.dataTransfer?.types ?? [])].includes("Files"),
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) documentValue.current = documentText(update.state.doc);
          if (update.docChanged || update.startState.readOnly !== update.state.readOnly)
            inputRef.current?.changed();
          if (!update.docChanged) return;
          if (update.transactions.every((tr) => tr.annotation(externalChange))) {
            return;
          }
          const next = documentValue.current!;
          onChangeRef.current(next);
        }),
      ],
    });
    let gate: ReturnType<typeof installEditorInputGate> | undefined;
    const registration = inputObserver?.attach(
      () => ({
        snapshot: {
          inputKind: "codemirror",
          text: documentValue.current ?? view.state.doc.toString(),
          canonicalValue: valueRef.current,
          readOnly: view.state.readOnly,
          composing,
          settling,
          compositionStarted: view.compositionStarted,
        },
        ...(composing ||
        settling ||
        view.compositionStarted ||
        normalizeLineBreaks(valueRef.current) !==
          (documentValue.current ?? view.state.doc.toString())
          ? { busy: "notes-view-reconciliation" }
          : {}),
      }),
      {
        canClose: () => !composing && !settling && !view.compositionStarted,
        close: (closed) => gate?.setClosed(closed),
      },
    );
    inputRef.current = registration ?? null;
    gate = installEditorInputGate(
      view,
      registration ? { ...registration, attach: () => {} } : undefined,
    );
    if (registration && !registration.allowed()) gate.setClosed(true);
    // These actual public paths include prebuilt/filter:false transactions.
    // Refuse a new document before CM mutates; a failed projection remains held.
    const update = view.update;
    const setState = view.setState;
    const budgetedUpdate: EditorView["update"] = (transactions) => {
      const next = transactions[transactions.length - 1]?.newDoc;
      if (
        next &&
        transactions.some((transaction) => transaction.docChanged) &&
        !canRetainNoteInputText(inputObserver, documentText(next))
      )
        return;
      update.call(view, transactions);
    };
    const budgetedState: EditorView["setState"] = (state) => {
      if (
        !state.doc.eq(view.state.doc) &&
        !canRetainNoteInputText(inputObserver, state.doc.toString())
      )
        return;
      setState.call(view, state);
    };
    view.update = budgetedUpdate;
    view.setState = budgetedState;
    viewRef.current = view;
    if (initial.current.autoFocus) view.focus();
    return () => {
      registration?.unregister();
      if (view.update === budgetedUpdate) view.update = update;
      if (view.setState === budgetedState) view.setState = setState;
      gate?.release();
      if (inputRef.current === registration) inputRef.current = null;
      viewRef.current = null;
      view.destroy();
    };
  }, [viewRef, inputObserver]);

  // A layout effect, so no keystroke can land between the render and the sync
  // and be overwritten by the older text.
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const next = normalizeLineBreaks(value);
    // The local update listener already materialized this exact document for onChange.
    const current = documentValue.current ?? view.state.doc.toString();
    if (next === current) {
      documentValue.current = next;
      if (inputObserver && inputPublication)
        if (!consumeNativeInputPublication(inputPublication, inputObserver, value))
          inputRef.current?.external(() => {});
      return;
    }
    // Replace only what differs so the caret and undo history stay useful.
    const limit = Math.min(next.length, current.length);
    let start = 0;
    while (start < limit && next[start] === current[start]) start += 1;
    let currentEnd = current.length;
    let nextEnd = next.length;
    while (currentEnd > start && nextEnd > start && current[currentEnd - 1] === next[nextEnd - 1]) {
      currentEnd -= 1;
      nextEnd -= 1;
    }
    const apply = () => {
      view.dispatch({
        changes: {
          from: start,
          to: currentEnd,
          insert: next.slice(start, nextEnd),
        },
        annotations: externalChange.of(true),
      });
      if (view.state.doc.toString() !== next)
        throw new Error("Notes document projection did not apply");
      documentValue.current = next;
    };
    if (inputObserver && inputPublication) {
      let attempted = false;
      const owned = consumeNativeInputPublication(inputPublication, inputObserver, value, () => {
        attempted = true;
        apply();
      });
      if (!owned) {
        // A stale proof grants nothing: preserve the incoming canonical value
        // through the ordinary external path. An attempted projection with an
        // unknown outcome must not run a second time.
        inputRef.current?.external(attempted ? () => {} : apply);
      }
    } else {
      if (inputRef.current) inputRef.current.external(apply);
      else apply();
    }
  }, [value, viewRef, inputObserver, inputPublication]);

  useEffect(() => {
    const apply = () =>
      viewRef.current?.dispatch({
        effects: schemeConfig.current.reconfigure(schemeExtensions(scheme)),
      });
    if (inputRef.current) inputRef.current.external(apply);
    else apply();
  }, [scheme, viewRef]);

  return <div ref={hostRef} data-note-editor className="min-w-0" onFocus={onFocus} />;
}

const TOOLBAR: {
  command: MarkdownCommand;
  label: string;
  icon: IconComponent;
}[] = [
  {
    command: "bold",
    get label() {
      return t("Bold ({p0}B)", { p0: MOD });
    },
    icon: Bold,
  },
  {
    command: "italic",
    get label() {
      return t("Italic ({p0}I)", { p0: MOD });
    },
    icon: Italic,
  },
  {
    command: "strike",
    get label() {
      return t("Strikethrough");
    },
    icon: Strikethrough,
  },
  {
    command: "heading",
    get label() {
      return t("Heading");
    },
    icon: Heading,
  },
  {
    command: "bullet",
    get label() {
      return t("Bullet list");
    },
    icon: ListBullet,
  },
  {
    command: "numbered",
    get label() {
      return t("Numbered list");
    },
    icon: ListNumbered,
  },
  {
    command: "checklist",
    get label() {
      return t("Checklist");
    },
    icon: CheckList,
  },
  {
    command: "quote",
    get label() {
      return t("Quote");
    },
    icon: BlockQuote,
  },
  {
    command: "code",
    get label() {
      return t("Code block");
    },
    icon: CodeBlock,
  },
  {
    command: "link",
    get label() {
      return t("Link");
    },
    icon: Link,
  },
  {
    command: "table",
    get label() {
      return t("Table");
    },
    icon: Table,
  },
  {
    command: "rule",
    get label() {
      return t("Divider");
    },
    icon: Minus,
  },
];

const QUICK_COMMANDS: readonly MarkdownCommand[] = [
  "bold",
  "italic",
  "heading",
  "bullet",
  "checklist",
  "link",
];

const TOOLBAR_GROUPS: { label: string; commands: readonly MarkdownCommand[] }[] = [
  { label: "Text", commands: ["strike"] },
  { label: "Block", commands: ["numbered", "quote"] },
  { label: "Insert", commands: ["code", "table", "rule"] },
];

export function NoteMarkdownToolbar({
  viewRef,
  editing,
  imageBusy = false,
  onInsertImage,
}: {
  viewRef: NoteEditorViewRef;
  /** Formatting acts on the visible source or active document range. */
  editing: boolean;
  imageBusy?: boolean;
  onInsertImage: () => void;
}) {
  useLocale();
  const [expanded, setExpanded] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const run = (action: (view: EditorView) => void) => {
    const view = viewRef.current;
    if (view) action(view);
  };
  return (
    <div
      role="toolbar"
      aria-label={t("Markdown formatting")}
      className="note-markdown-toolbar ms-auto flex min-w-0 flex-wrap items-center gap-0.5"
      // Keep the selection in the editor while a button is pressed.
      onMouseDown={(event) => event.preventDefault()}
    >
      {(editing ? TOOLBAR.filter((item) => QUICK_COMMANDS.includes(item.command)) : []).map(
        ({ command, label, icon: Icon }) => (
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            label={label}
            motion="none"
            key={command}
            type="button"
            onClick={() => run((view) => runMarkdownCommand(view, command))}
          >
            <Icon className="icon-sm" />
          </Button>
        ),
      )}
      {editing ? (
        <>
          <Button
            ref={moreRef}
            variant="ghost"
            size="sm"
            iconOnly
            label={t("Markdown formatting")}
            aria-expanded={expanded}
            aria-haspopup="dialog"
            onClick={() => setExpanded((current) => !current)}
          >
            <MoreHorizontal className="icon-sm" />
          </Button>
          {expanded ? (
            <Popover
              anchor={moreRef}
              align="end"
              onDismiss={() => setExpanded(false)}
              kind="dialog"
              autoFocus={false}
              aria-label={t("Markdown formatting")}
              className="flex max-h-96 w-60 flex-col gap-2 overflow-y-auto p-2"
            >
              {TOOLBAR_GROUPS.map((group) => (
                <section key={group.label} aria-label={t(group.label)}>
                  <SectionLabel className="px-2">{t(group.label)}</SectionLabel>
                  <div className="grid grid-cols-2 gap-0.5">
                    {TOOLBAR.filter((item) => group.commands.includes(item.command)).map(
                      ({ command, label, icon: Icon }) => (
                        <Button
                          key={command}
                          variant="ghost"
                          size="sm"
                          align="start"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            run((view) => runMarkdownCommand(view, command));
                            setExpanded(false);
                          }}
                        >
                          <Icon className="icon-sm" />
                          {label}
                        </Button>
                      ),
                    )}
                  </div>
                </section>
              ))}
            </Popover>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            label={t("Find and replace")}
            motion="none"
            type="button"
            shortcut="Mod+F / Mod+H"
            onClick={() => run(openSearchPanel)}
          >
            <Search className="icon-sm" />
          </Button>
        </>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        label={t("Insert image")}
        motion="none"
        type="button"
        tooltip={t("Insert image · or paste ({p0}V) / drop one", { p0: MOD })}
        loading={imageBusy}
        onClick={onInsertImage}
      >
        <ImagePlus className="icon-sm" />
      </Button>
    </div>
  );
}
