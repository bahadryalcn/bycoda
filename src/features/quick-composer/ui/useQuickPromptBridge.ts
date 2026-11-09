import { useLayoutEffect, type RefObject } from "react";
import type { QuickComposerOwner } from "../model/quickComposerClosure";

/**
 * Bridges the actual prompt DOM node to the closure owner: the owner reads the
 * live value, gates edits while a launch is closing, and learns about external
 * (non-React) changes and IME composition. `promptRef` is owned by the caller.
 */
export function useQuickPromptBridge(
  owner: QuickComposerOwner,
  promptRef: RefObject<HTMLTextAreaElement | null>,
) {
  useLayoutEffect(() => {
    const input = promptRef.current;
    let composing = false;
    let closed = false;
    const originalReadOnly = input?.readOnly ?? false;
    const detach = owner.mount({
      readPrompt: () => input?.value ?? null,
      composing: () => composing,
      gate: (value) => {
        closed = value;
        if (input && !composing) input.readOnly = value || originalReadOnly;
      },
    });
    const before = (event: Event) => {
      if (!composing && !owner.canMutate()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const changed = () => {
      if (input) owner.externalPrompt(input.value);
    };
    const start = () => {
      composing = true;
    };
    const end = () => {
      composing = false;
      changed();
      owner.changed();
      if (input) input.readOnly = closed || originalReadOnly;
    };
    input?.addEventListener("beforeinput", before, true);
    input?.addEventListener("paste", before, true);
    input?.addEventListener("drop", before, true);
    input?.addEventListener("input", changed);
    input?.addEventListener("compositionstart", start);
    input?.addEventListener("compositionend", end);
    return () => {
      detach();
      input?.removeEventListener("beforeinput", before, true);
      input?.removeEventListener("paste", before, true);
      input?.removeEventListener("drop", before, true);
      input?.removeEventListener("input", changed);
      input?.removeEventListener("compositionstart", start);
      input?.removeEventListener("compositionend", end);
      if (input) input.readOnly = originalReadOnly;
    };
  }, [owner, promptRef]);
}
