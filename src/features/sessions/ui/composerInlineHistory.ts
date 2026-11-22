import { history, historyField, redo, undo } from "@codemirror/commands";
import {
  EditorSelection,
  EditorState,
  Transaction,
  type Extension,
  type StateCommand,
} from "@codemirror/state";

/** The smallest replacement that turns `before` into `after`. */
export function changesBetween(before: string, after: string) {
  let from = 0;
  let to = before.length;
  let end = after.length;
  while (from < to && from < end && before[from] === after[from]) from++;
  while (from < to && from < end && before[to - 1] === after[end - 1]) {
    to--;
    end--;
  }
  return { from, to, insert: after.slice(from, end) };
}

/** Carry document, selection and undo history into a state that has different extensions. */
export function transferHistory(state: EditorState, extensions: Extension) {
  return EditorState.fromJSON(
    state.toJSON({ history: historyField }),
    { extensions },
    { history: historyField },
  );
}

function userEventFor(inputType: string) {
  if (inputType === "insertFromPaste" || inputType === "insertFromDrop") return "input.paste";
  if (inputType === "deleteContentBackward") return "delete.backward";
  if (inputType === "deleteContentForward") return "delete.forward";
  if (inputType.startsWith("delete")) return "delete";
  return inputType === "insertText" ? "input.type" : "input";
}

function fieldRange(field: HTMLTextAreaElement) {
  const start = Math.min(field.selectionStart, field.value.length);
  const end = Math.min(field.selectionEnd, field.value.length);
  return field.selectionDirection === "backward"
    ? EditorSelection.single(end, start)
    : EditorSelection.single(start, end);
}

export type NativeHistory = {
  readonly composing: boolean;
  /** Take in text or selection the field changed without an input event. */
  sync(): void;
  /** Stop handling the field and hand back the state, with its history, for an editor view. */
  release(): EditorState;
};

/**
 * Keep the undo history of an editor that left the draft while the native field edits it.
 * Edits are recorded from input events and undo/redo run on the editor state, because a native
 * field has no way to adopt another editor's history. Composition is recorded when it ends.
 * Keys and menu commands that the draft owner already handled are left alone.
 */
export function attachNativeHistory(field: HTMLTextAreaElement, seed?: EditorState): NativeHistory {
  const root = field.ownerDocument;
  let state = seed
    ? transferHistory(seed, history())
    : EditorState.create({ doc: field.value, selection: fieldRange(field), extensions: history() });
  let applying = false;
  let composing = false;

  function record(userEvent: string) {
    const before = state.doc.toString();
    if (before === field.value) return;
    state = state.update({
      changes: changesBetween(before, field.value),
      selection: fieldRange(field),
      userEvent,
    }).state;
  }

  function sync() {
    if (applying || composing) return;
    const before = state.doc.toString();
    const range = fieldRange(field);
    if (before === field.value) {
      if (!state.selection.main.eq(range.main)) state = state.update({ selection: range }).state;
      return;
    }
    state = state.update({
      changes: changesBetween(before, field.value),
      selection: range,
      annotations: Transaction.addToHistory.of(false),
    }).state;
  }

  function run(command: StateCommand, inputType: string, announce: boolean) {
    sync();
    let next = state;
    if (!command({ state, dispatch: (transaction) => (next = transaction.state) })) return false;
    applying = true;
    try {
      if (announce)
        field.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType }));
      state = next;
      field.value = state.doc.toString();
      const range = state.selection.main;
      field.setSelectionRange(
        range.from,
        range.to,
        range.anchor > range.head ? "backward" : "forward",
      );
      field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType }));
    } finally {
      applying = false;
    }
    return true;
  }

  const onInput = (event: Event) => {
    if (applying || composing || (event as InputEvent).isComposing) return;
    record(userEventFor((event as InputEvent).inputType ?? ""));
  };
  const onCompositionStart = () => {
    composing = true;
  };
  const finishComposition = () => {
    composing = false;
    record("input.type");
  };
  const editable = () => !field.readOnly && !field.disabled;
  // Registered on the document so the draft owner's own key handling, which already covers
  // attachment-aware undo, runs first and a handled key is not repeated here.
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      event.target !== field ||
      event.defaultPrevented ||
      event.isComposing ||
      composing ||
      !editable() ||
      (!event.ctrlKey && !event.metaKey) ||
      event.altKey
    )
      return;
    const key = event.key.toLowerCase();
    const redoing = key === "y" || (key === "z" && event.shiftKey);
    if (key !== "z" && key !== "y") return;
    if (run(redoing ? redo : undo, redoing ? "historyRedo" : "historyUndo", true))
      event.preventDefault();
  };
  const onBeforeInput = (event: Event) => {
    const { inputType, cancelable, defaultPrevented } = event as InputEvent;
    if (
      applying ||
      composing ||
      event.target !== field ||
      !cancelable ||
      defaultPrevented ||
      !editable() ||
      (inputType !== "historyUndo" && inputType !== "historyRedo")
    )
      return;
    if (run(inputType === "historyUndo" ? undo : redo, inputType, false)) event.preventDefault();
  };

  field.addEventListener("input", onInput);
  field.addEventListener("compositionstart", onCompositionStart);
  field.addEventListener("compositionend", finishComposition);
  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("beforeinput", onBeforeInput);
  sync();
  return {
    get composing() {
      return composing;
    },
    sync,
    release() {
      composing = false;
      sync();
      field.removeEventListener("input", onInput);
      field.removeEventListener("compositionstart", onCompositionStart);
      field.removeEventListener("compositionend", finishComposition);
      root.removeEventListener("keydown", onKeyDown);
      root.removeEventListener("beforeinput", onBeforeInput);
      return state;
    },
  };
}
