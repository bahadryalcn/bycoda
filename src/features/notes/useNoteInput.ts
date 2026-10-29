import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { RefObject } from "react";
import type { NoteInputOwner } from "./notesInputOwners";
import type { NativeInputObserver } from "../../shared/lib/native-input-observer";

/** Capture phase runs before native/Arc callbacks; no async permit or value rewrite. */
export function noteInputBudgetHandlers(
  owner: NoteInputOwner,
  keyFor: (field: HTMLInputElement | HTMLTextAreaElement) => string | undefined,
) {
  const check = (event: { target: unknown; preventDefault(): void }, inserted: string) => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
    const key = keyFor(field);
    if (!key) return;
    const next =
      field.value.slice(0, field.selectionStart ?? field.value.length) +
      inserted +
      field.value.slice(field.selectionEnd ?? field.value.length);
    if (!owner.allowed() || !owner.canRetainText(key, next)) event.preventDefault();
  };
  return {
    onBeforeInputCapture(event: import("react").FormEvent<HTMLElement>) {
      const input = event.nativeEvent as InputEvent;
      if (input.inputType?.startsWith("delete")) return;
      if (typeof input.data === "string") check(event, input.data);
      else if (input.inputType === "insertLineBreak" || input.inputType === "insertParagraph")
        check(event, "\n");
    },
    onPasteCapture(event: import("react").ClipboardEvent<HTMLElement>) {
      check(event, event.clipboardData.getData("text/plain"));
    },
    onDropCapture(event: import("react").DragEvent<HTMLElement>) {
      if (event.dataTransfer.types.includes("text/plain"))
        check(event, event.dataTransfer.getData("text/plain"));
    },
  };
}

export function useNoteInputState(
  owner: NoteInputOwner,
  key: string,
  snapshot: Record<string, unknown>,
) {
  const current = useRef(snapshot);
  const registration = useRef<ReturnType<NativeInputObserver["attach"]> | null>(null);
  useLayoutEffect(() => {
    current.current = snapshot;
    registration.current?.refresh();
  });
  const observer = owner.observer(key);
  useLayoutEffect(() => {
    const port = observer.attach(() => ({ snapshot: current.current }), {
      canClose: () => true,
      close: () => {},
    });
    registration.current = port;
    return () => {
      port.unregister();
      if (registration.current === port) registration.current = null;
    };
  }, [observer]);
}

export function useNotePreparing(owner: NoteInputOwner) {
  return useSyncExternalStore(owner.subscribe, owner.closed, () => false);
}

/** Native field port; raw draft/caret stays selectable while admission is closed. */
export function useNoteTextInput(
  owner: NoteInputOwner,
  key: string,
  ref: RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
) {
  const observer = owner.observer(key);
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    const original = field.readOnly;
    let composing = false;
    let settling = false;
    let frame = 0;
    const registration = observer.attach(
      () => ({
        snapshot: {
          inputKind: "native-text",
          text: field.value,
          readOnly: field.readOnly,
          composing,
          settling,
          selectionStart: field.selectionStart,
          selectionEnd: field.selectionEnd,
        },
        ...(composing || settling ? { busy: "notes-ime" } : {}),
      }),
      {
        canClose: () => !composing && !settling,
        close: (closed) => {
          field.readOnly = closed || original;
        },
      },
    );
    const start = () => {
      composing = true;
      registration.changed();
    };
    const end = () => {
      composing = false;
      settling = true;
      registration.changed();
      frame = requestAnimationFrame(() => {
        settling = false;
        registration.changed();
      });
    };
    const changed = () => registration.changed();
    const before = (event: Event) => {
      if (!registration.allowed()) event.preventDefault();
    };
    field.addEventListener("compositionstart", start);
    field.addEventListener("compositionend", end);
    field.addEventListener("beforeinput", before);
    field.addEventListener("input", changed);
    return () => {
      cancelAnimationFrame(frame);
      field.removeEventListener("compositionstart", start);
      field.removeEventListener("compositionend", end);
      field.removeEventListener("beforeinput", before);
      field.removeEventListener("input", changed);
      registration.unregister();
      field.readOnly = original;
    };
  }, [observer, ref]);
}

export function useNoteExternal(owner: NoteInputOwner, value: unknown) {
  const previous = useRef(value);
  const target = useRef({}).current;
  useLayoutEffect(() => owner.attachCanonical(target), [owner, target]);
  useLayoutEffect(() => {
    if (previous.current !== value) {
      previous.current = value;
      if (!owner.commitCanonical(target, value)) owner.external(() => {});
    } else owner.refresh();
  }, [owner, value, target]);
}

export function useNoteObserver(owner: NoteInputOwner, key: string): NativeInputObserver {
  return owner.observer(key);
}
