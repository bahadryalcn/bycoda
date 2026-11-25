import { defaultKeymap, history, historyKeymap, isolateHistory, redo } from "@codemirror/commands";
import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  Transaction,
  type Extension,
} from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { changesBetween, transferHistory } from "./composerInlineHistory";

const externalChange = Annotation.define<boolean>();
const managedDeletion = Annotation.define<boolean>();
const editors = new WeakMap<HTMLTextAreaElement, EditorView>();

export function composerInputFocused(field: HTMLTextAreaElement) {
  return field.ownerDocument.activeElement === field || editors.get(field)?.hasFocus === true;
}

type FieldSettings = {
  label: string;
  placeholder: string;
  readOnly: boolean;
  disabled: boolean;
  spellCheck: boolean;
};

function fieldExtensions(settings: FieldSettings): Extension {
  return [
    EditorState.readOnly.of(settings.readOnly || settings.disabled),
    EditorView.editable.of(!settings.readOnly && !settings.disabled),
    EditorView.contentAttributes.of({
      role: "textbox",
      "aria-multiline": "true",
      "aria-label": settings.label,
      "aria-readonly": String(settings.readOnly),
      "aria-disabled": String(settings.disabled),
      spellcheck: String(settings.spellCheck),
      tabindex: settings.disabled ? "-1" : "0",
      "data-composer-inline-input": "",
      "data-ui-focus": "group",
    }),
    placeholder(settings.placeholder),
  ];
}

/** Composer-owned deletion is recorded in one isolated editor undo step. */
export function applyComposerInlineDeletion(
  field: HTMLTextAreaElement,
  text: string,
  caret: number,
  userEvent = "delete.cut",
) {
  const view = editors.get(field);
  if (!view) return false;
  view.dispatch({
    changes: changesBetween(view.state.doc.toString(), text),
    selection: EditorSelection.single(caret),
    annotations: [managedDeletion.of(true), isolateHistory.of("full")],
    userEvent,
  });
  return true;
}

/** Keep draft/IME/clipboard owners on their existing input endpoint while the view owns text layout. */
export function attachComposerInlineInput(
  field: HTMLTextAreaElement,
  parent: HTMLElement,
  initial: FieldSettings,
  extensions: Extension,
  /** History carried over from an editor that left this draft; its text must equal the field. */
  seed?: EditorState,
) {
  const selection = field.setSelectionRange.bind(field);
  const moveFocus = field.focus.bind(field);
  const moveBlur = field.blur.bind(field);
  const selectAll = field.select.bind(field);
  const settings = new Compartment();
  let disposed = false;
  let pendingInput: string | null = null;
  const config = {
    doc: field.value,
    selection: EditorSelection.single(field.selectionStart, field.selectionEnd),
    extensions: [
      extensions,
      history(),
      EditorView.lineWrapping,
      settings.of(fieldExtensions(initial)),
      EditorView.domEventHandlers({
        keydown(event) {
          return relay(
            event,
            new KeyboardEvent("keydown", {
              ...eventInit(event),
              key: event.key,
              code: event.code,
              ctrlKey: event.ctrlKey,
              metaKey: event.metaKey,
              altKey: event.altKey,
              shiftKey: event.shiftKey,
              repeat: event.repeat,
              isComposing: event.isComposing,
            }),
          );
        },
        keyup(event) {
          return relay(
            event,
            new KeyboardEvent("keyup", {
              ...eventInit(event),
              key: event.key,
              code: event.code,
              ctrlKey: event.ctrlKey,
              metaKey: event.metaKey,
              altKey: event.altKey,
              shiftKey: event.shiftKey,
              isComposing: event.isComposing,
            }),
          );
        },
        paste(event) {
          return relay(
            event,
            new ClipboardEvent("paste", {
              ...eventInit(event),
              clipboardData: event.clipboardData,
            }),
          );
        },
        copy(event) {
          return relayClipboard(event);
        },
        cut(event) {
          return relayClipboard(event);
        },
        focus(event) {
          field.dispatchEvent(
            new FocusEvent("focusin", { bubbles: true, relatedTarget: event.relatedTarget }),
          );
        },
        click(event) {
          if (!isWidget(event)) field.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        },
        compositionstart(event) {
          field.dispatchEvent(new CompositionEvent("compositionstart", { data: event.data }));
        },
        compositionend(event) {
          queueMicrotask(() => {
            if (!disposed)
              field.dispatchEvent(new CompositionEvent("compositionend", { data: event.data }));
          });
        },
      }),
      keymap.of([...defaultKeymap, ...historyKeymap, { win: "Ctrl-Shift-z", run: redo }]),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged && !update.selectionSet) return;
        if (update.transactions.every((transaction) => transaction.annotation(externalChange)))
          return;
        if (update.docChanged) {
          const inputType = update.transactions.some((transaction) =>
            transaction.isUserEvent("undo"),
          )
            ? "historyUndo"
            : update.transactions.some((transaction) => transaction.isUserEvent("redo"))
              ? "historyRedo"
              : "";
          if (!update.transactions.some((transaction) => transaction.annotation(managedDeletion)))
            field.dispatchEvent(new InputEvent("beforeinput", { inputType }));
          field.value = update.state.doc.toString();
          pendingInput = inputType;
        }
        const range = update.state.selection.main;
        selection(range.from, range.to, range.anchor > range.head ? "backward" : "forward");
        queueMicrotask(() => {
          if (disposed) return;
          if (pendingInput !== null) {
            const inputType = pendingInput;
            pendingInput = null;
            field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType }));
          } else field.dispatchEvent(new Event("select", { bubbles: true }));
        });
      }),
    ],
  };
  const view = new EditorView({
    parent,
    state: seed ? transferHistory(seed, config.extensions) : EditorState.create(config),
  });

  function isWidget(event: Event) {
    return Boolean((event.target as Element | null)?.closest?.("[data-inline-reference]"));
  }

  function relay(event: Event, forwarded: Event) {
    if (isWidget(event)) return false;
    event.stopPropagation();
    const blocked = !field.dispatchEvent(forwarded);
    if (blocked) event.preventDefault();
    return blocked;
  }

  function relayClipboard(event: ClipboardEvent) {
    return relay(
      event,
      new ClipboardEvent(event.type, { ...eventInit(event), clipboardData: event.clipboardData }),
    );
  }

  function sync(scrollIntoView = false) {
    const before = view.state.doc.toString();
    const text = field.value;
    const start = Math.min(field.selectionStart, text.length);
    const end = Math.min(field.selectionEnd, text.length);
    const range =
      field.selectionDirection === "backward"
        ? EditorSelection.single(end, start)
        : EditorSelection.single(start, end);
    if (before === text && view.state.selection.eq(range)) return;
    view.dispatch({
      ...(before === text ? {} : { changes: changesBetween(before, text) }),
      selection: range,
      scrollIntoView,
      annotations: [externalChange.of(true), Transaction.addToHistory.of(false)],
    });
  }

  editors.set(field, view);
  const wasFocused = field.ownerDocument.activeElement === field;
  field.focus = () => {
    if (field.disabled) return;
    sync();
    view.focus();
  };
  field.blur = () => view.contentDOM.blur();
  field.setSelectionRange = (start, end, direction) => {
    selection(start, end, direction);
    sync();
  };
  field.select = () => {
    selection(0, field.value.length);
    sync();
  };
  if (wasFocused) view.focus();
  return {
    view,
    sync,
    configure(next: FieldSettings) {
      view.dispatch({ effects: settings.reconfigure(fieldExtensions(next)) });
    },
    destroy() {
      disposed = true;
      editors.delete(field);
      field.focus = moveFocus;
      field.blur = moveBlur;
      field.select = selectAll;
      field.setSelectionRange = selection;
      view.destroy();
    },
  };
}

function eventInit(event: Event): EventInit {
  return { bubbles: true, cancelable: event.cancelable, composed: event.composed };
}
