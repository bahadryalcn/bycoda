import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { indentWithTab, redo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { openSearchPanel } from "@codemirror/search";
import { Annotation, Compartment, Prec } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, placeholder } from "@codemirror/view";
import { minimalSetup } from "codemirror";
import { useEffect, useLayoutEffect, useRef } from "react";
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
  Search,
  Strikethrough,
  Table,
  type IconComponent,
} from "../../../shared/ui/icons";
import { filesFromClipboard } from "../../sessions/model/attachments";
import { schemeExtensions } from "../../files/editor/editorChrome";
import { editorSearch, openReplacePanel } from "../../files/editor/editorSearch";
import { markdownEdit, type MarkdownCommand } from "../markdownCommands";

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

// The owning pane scrolls, so the editor grows with its text.
const noteEditorTheme = (minHeight: number) =>
  EditorView.theme({
    "&.cm-editor": {
      height: "auto",
    },
    "&.cm-editor .cm-scroller": {
      overflow: "visible",
      lineHeight: "20px",
    },
    "&.cm-editor .cm-content": {
      minHeight: `${minHeight}px`,
      paddingTop: "0",
      cursor: "text",
    },
    "&.cm-editor .cm-panels.cm-panels-top": {
      backgroundColor: "var(--color-background-base)",
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
}) {
  useLocale();
  const hostRef = useRef<HTMLDivElement>(null);
  const scheme = useColorScheme();
  const schemeConfig = useRef(new Compartment());
  const initial = useRef({ scheme, autoFocus, minHeight, showLineNumbers });
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onPasteImagesRef = useRef(onPasteImages);
  valueRef.current = value;
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onPasteImagesRef.current = onPasteImages;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({
      doc: normalizeLineBreaks(valueRef.current),
      parent: host,
      extensions: [
        minimalSetup,
        ...(initial.current.showLineNumbers ? [lineNumbers()] : []),
        EditorView.lineWrapping,
        markdown(),
        placeholder(t("Write markdown…")),
        schemeConfig.current.of(schemeExtensions(initial.current.scheme)),
        noteEditorTheme(initial.current.minHeight),
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
          paste: (event) => {
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
          if (!update.docChanged) return;
          if (update.transactions.every((tr) => tr.annotation(externalChange))) {
            return;
          }
          onChangeRef.current(update.state.doc.toString());
        }),
      ],
    });
    viewRef.current = view;
    if (initial.current.autoFocus) view.focus();
    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, [viewRef]);

  // A layout effect, so no keystroke can land between the render and the sync
  // and be overwritten by the older text.
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const next = normalizeLineBreaks(value);
    const current = view.state.doc.toString();
    if (next === current) return;
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
    view.dispatch({
      changes: {
        from: start,
        to: currentEnd,
        insert: next.slice(start, nextEnd),
      },
      annotations: externalChange.of(true),
    });
  }, [value, viewRef]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: schemeConfig.current.reconfigure(schemeExtensions(scheme)),
    });
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

export function NoteMarkdownToolbar({
  viewRef,
  editing,
  imageBusy = false,
  onInsertImage,
}: {
  viewRef: NoteEditorViewRef;
  /** Formatting buttons only make sense while the source is visible. */
  editing: boolean;
  imageBusy?: boolean;
  onInsertImage: () => void;
}) {
  useLocale();
  const run = (action: (view: EditorView) => void) => {
    const view = viewRef.current;
    if (view) action(view);
  };
  return (
    <div
      role="toolbar"
      aria-label={t("Markdown formatting")}
      className="ms-auto flex min-w-0 flex-wrap items-center gap-0.5"
      // Keep the selection in the editor while a button is pressed.
      onMouseDown={(event) => event.preventDefault()}
    >
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        label={t("Insert image")}
        motion="none"
        type="button"
        title={t("Insert image · or paste ({p0}V) / drop one", { p0: MOD })}
        aria-label={t("Insert image")}
        disabled={imageBusy}
        onClick={onInsertImage}
      >
        <ImagePlus className="size-3.5" />
      </Button>
      {editing ? <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-content/10" /> : null}
      {(editing ? TOOLBAR : []).map(({ command, label, icon: Icon }) => (
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          label={label}
          motion="none"
          key={command}
          type="button"
          title={label}
          aria-label={label}
          onClick={() => run((view) => runMarkdownCommand(view, command))}
        >
          <Icon className="size-3.5" />
        </Button>
      ))}
      {editing ? (
        <>
          <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-content/10" />
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            label={t("Find and replace")}
            motion="none"
            type="button"
            title={t("Find ({p0}F) · Replace ({p1}H)", { p0: MOD, p1: MOD })}
            aria-label={t("Find and replace")}
            onClick={() => run(openSearchPanel)}
          >
            <Search className="size-3.5" />
          </Button>
        </>
      ) : null}
    </div>
  );
}
