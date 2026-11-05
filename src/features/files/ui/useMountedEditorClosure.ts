import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  registerMountedEditor,
  type MountedEditorRead,
  type MountedEditorRegistration,
  type EditorWorkTicket,
} from "../data/mountedEditorClosure";
export type { EditorWorkTicket } from "../data/mountedEditorClosure";
import type { NativeCaptureState, NativeEditorDraftMetadata } from "../data/editorDraftPersistence";
import {
  Compartment,
  EditorState,
  Prec,
  StateEffect,
  Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { mergeResolutionField } from "../../source-control/public/mergeResolution";

/** Public instance boundaries are installed before the owned view is exposed.
 * Dispatch rejection precedes MergeView's chunk mutation; aliases/prototype
 * writers outside these owned routes remain explicitly unsupported. */
export function installEditorInputGate(view: EditorView, observer?: MountedEditorObserver) {
  if (!observer)
    return {
      setClosed: (_closed: boolean) => {},
      maintain<T>(apply: () => T): T {
        return apply();
      },
      release() {},
    };
  const dispatch = view.dispatch;
  const update = view.update;
  const setState = view.setState;
  const readOnly = new Compartment();
  let control = false;
  let installed = false;
  const sameInput = (tr: Transaction) =>
    tr instanceof Transaction &&
    !tr.docChanged &&
    tr.startState.field(mergeResolutionField, false) ===
      tr.state.field(mergeResolutionField, false);
  const navigation = (trs: readonly Transaction[]) =>
    trs.every(
      (tr) =>
        tr instanceof Transaction &&
        !tr.docChanged &&
        !tr.reconfigured &&
        tr.startState.field(mergeResolutionField, false) ===
          tr.state.field(mergeResolutionField, false),
    );
  view.dispatch = ((...input: unknown[]) => {
    if (observer.allowed()) return (dispatch as (...args: unknown[]) => void)(...input);
    const first = input[0];
    const trs =
      first instanceof Transaction
        ? [first]
        : Array.isArray(first)
          ? (first as Transaction[])
          : [view.state.update(...(input as TransactionSpec[]))];
    if (control ? trs.every(sameInput) : navigation(trs)) dispatch(trs);
  }) as EditorView["dispatch"];
  view.update = function (trs) {
    if (observer.allowed() || (control ? trs.every(sameInput) : navigation(trs)))
      update.call(view, trs);
  };
  view.setState = function (state) {
    if (
      observer.allowed() ||
      (control &&
        state.doc.eq(view.state.doc) &&
        state.field(mergeResolutionField, false) === view.state.field(mergeResolutionField, false))
    )
      setState.call(view, state);
  };
  const prevent = (event: Event) => {
    if (!observer.allowed() && event.cancelable) event.preventDefault();
  };
  for (const type of ["beforeinput", "paste", "drop"])
    view.contentDOM.addEventListener(type, prevent, true);
  return {
    maintain<T>(apply: () => T): T {
      const previous = control;
      control = true;
      try {
        return apply();
      } finally {
        control = previous;
      }
    },
    setClosed(closed: boolean) {
      control = true;
      try {
        dispatch({
          effects: installed
            ? readOnly.reconfigure(closed ? Prec.highest(EditorState.readOnly.of(true)) : [])
            : StateEffect.appendConfig.of(
                readOnly.of(closed ? Prec.highest(EditorState.readOnly.of(true)) : []),
              ),
        });
        installed = true;
      } finally {
        control = false;
      }
    },
    release() {
      for (const type of ["beforeinput", "paste", "drop"])
        view.contentDOM.removeEventListener(type, prevent, true);
      view.dispatch = dispatch;
      view.update = update;
      view.setState = setState;
    },
  };
}
export function applyExternalEditorUpdate<T>(
  observer: MountedEditorObserver | undefined,
  apply: () => T,
): T {
  return observer ? observer.external(apply) : apply();
}

/** An ACK for a coalesced or older body never describes the mounted document. */
export function exactMountedEditorDraftReceipt(
  binding: NativeCaptureState | undefined,
  input: {
    origin: string;
    documentId: string;
    path: string;
    text: string | null;
    eol: string;
    serializedText?: string;
    diskBaseline: string | null;
  },
): NativeEditorDraftMetadata | null {
  const ack = binding?.acknowledgedDraft;
  const record = binding?.currentDraft;
  if (
    input.origin !== "local-native" ||
    !binding ||
    !ack ||
    !record ||
    !["retained", "save-reported"].includes(binding.phase) ||
    binding.pending ||
    binding.error ||
    binding.disposed ||
    binding.initializationDecisionRequired ||
    binding.ownerEpoch !== ack.ownerId ||
    binding.documentId !== input.documentId ||
    binding.path !== input.path ||
    ack.documentId !== input.documentId ||
    ack.path !== input.path ||
    !Object.keys(ack).every((key) =>
      Object.is(
        record.metadata[key as keyof NativeEditorDraftMetadata],
        ack[key as keyof NativeEditorDraftMetadata],
      ),
    ) ||
    record.payload.documentId !== input.documentId ||
    record.payload.revision !== ack.revision ||
    record.payload.path !== input.path ||
    record.payload.text !== input.text ||
    record.payload.diskBaseline !== input.diskBaseline ||
    record.payload.eol !== input.eol ||
    (input.serializedText !== undefined &&
      (record.payload.serializedText ??
        record.payload.text.replace(
          /\n/g,
          record.payload.eol === "crlf" ? "\r\n" : record.payload.eol === "cr" ? "\r" : "\n",
        )) !== input.serializedText)
  )
    return null;
  return ack;
}

export interface MountedEditorView {
  setClosed?(closed: boolean): void;
  read(): {
    text: string;
    composing: boolean;
    compositionStarted?: boolean;
    readOnly: boolean;
    pendingAutosave: boolean;
    kind: "source" | "merge";
    mergeState?: Record<string, unknown>;
  };
}
export interface MountedEditorObserver {
  attach(view: MountedEditorView | null): void;
  changed(): void;
  operation(kind: string, parent?: EditorWorkTicket): EditorWorkTicket | null;
  allowed(): boolean;
  closed(): boolean;
  external<T>(callback: () => T): T;
}
type RegistrationOwner = {
  registration: MountedEditorRegistration;
  retired: boolean;
  obligations: Set<symbol>;
};
/** Passive inspection only: no producer registration, draft binding, flush or edit gate. */
export function useMountedEditorClosure(
  read: (view: MountedEditorView | null) => MountedEditorRead,
  scope = "file-editor",
  onReopen?: () => void,
) {
  const [, setPreparing] = useState(false);
  const latest = useRef(read);
  const reopen = useRef(onReopen);
  const wasClosed = useRef(false);
  useLayoutEffect(() => {
    latest.current = read;
    reopen.current = onReopen;
  });
  const view = useRef<MountedEditorView | null>(null);
  const currentOwner = useRef<RegistrationOwner | null>(null);
  const owners = useRef(new Set<RegistrationOwner>());
  const operations = useRef(new Map<symbol, string>());
  const coreTickets = useRef(new WeakMap<EditorWorkTicket, EditorWorkTicket>());
  const changed = useCallback(() => currentOwner.current?.registration.changed(), []);
  const releaseRetired = useCallback((owner: RegistrationOwner) => {
    if (!owner.retired || owner.obligations.size || !owners.current.delete(owner)) return;
    owner.registration.unregister();
    if (currentOwner.current === owner) currentOwner.current = null;
  }, []);
  const createOwner = useCallback((retired: boolean) => {
    const owner: RegistrationOwner = {
      retired,
      obligations: new Set(operations.current.keys()),
      // The registry may synchronously close a newly arriving owner.
      registration: undefined as unknown as MountedEditorRegistration,
    };
    owner.registration = registerMountedEditor(
      () => {
        // Accepted work outlives its DOM/view. A retiring obligation never reads
        // the removed component, and can only disappear after its real finalizers.
        if (owner.retired)
          return {
            snapshot: { version: 1, qualified: false, state: "retiring" },
            busy: "Retired editor work is still settling",
          };
        const value = latest.current(view.current);
        return operations.current.size
          ? { ...value, busy: "Editor accepted work is still settling" }
          : value;
      },
      {
        canClose() {
          if (owner.retired) return true;
          try {
            const input = view.current?.read();
            return !input?.composing && !input?.compositionStarted;
          } catch {
            return false;
          }
        },
        close(closed) {
          if (!owner.retired) {
            view.current?.setClosed?.(closed);
            setPreparing(closed);
            const previous = wasClosed.current;
            wasClosed.current = closed;
            if (previous && !closed) reopen.current?.();
          }
        },
      },
    );
    owners.current.add(owner);
    return owner;
  }, []);
  const observer = useMemo<MountedEditorObserver>(
    () => ({
      changed,
      allowed: () => currentOwner.current?.registration.allowed() ?? true,
      closed: () => currentOwner.current?.registration.closed() ?? false,
      external: (callback) =>
        currentOwner.current ? currentOwner.current.registration.external(callback) : callback(),
      attach(next) {
        const attach = () => {
          view.current = next;
          next?.setClosed?.(currentOwner.current?.registration.closed() ?? false);
          changed();
        };
        if (view.current !== next && currentOwner.current?.registration.closed())
          currentOwner.current.registration.external(attach);
        else attach();
      },
      operation(kind, parent) {
        currentOwner.current ??= createOwner(true);
        const core = currentOwner.current.registration.operation(
          kind,
          parent ? coreTickets.current.get(parent) : undefined,
        );
        if (!core) return null;
        const token = Symbol(kind);
        operations.current.set(token, kind);
        // A continuation of already accepted work can begin after unmount.
        // Keep its obligation rather than treating the missing DOM as idle.
        currentOwner.current.obligations.add(token);
        changed();
        let finished = false;
        const ticket: EditorWorkTicket = Object.assign(
          () => {
            if (finished) return;
            finished = true;
            core();
            operations.current.delete(token);
            for (const owner of owners.current) {
              owner.obligations.delete(token);
              owner.registration.changed();
              releaseRetired(owner);
            }
          },
          { apply: core.apply },
        );
        coreTickets.current.set(ticket, core);
        return Object.freeze(ticket);
      },
    }),
    [changed, createOwner, releaseRetired],
  );
  useLayoutEffect(() => {
    const owner = createOwner(false);
    currentOwner.current = owner;
    return () => {
      owner.retired = true;
      if (owner.registration.closed()) owner.registration.external(() => {});
      owner.registration.changed();
      view.current = null;
      releaseRetired(owner);
    };
  }, [createOwner, releaseRetired, scope]);
  useLayoutEffect(() => {
    currentOwner.current?.registration.refresh();
  });
  return observer;
}
