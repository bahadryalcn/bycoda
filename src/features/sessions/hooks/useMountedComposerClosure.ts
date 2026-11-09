import { useCallback, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import {
  registerMountedComposer,
  type ComposerPreparation,
  type MountedComposerLease,
} from "../data/composerClosure";
import type { ComposerDraft } from "../model/draftPersistence";

export function useMountedComposerClosure(options: {
  sessionId?: string;
  input: RefObject<HTMLTextAreaElement | null>;
  snapshot(): ComposerDraft;
  reopened?(): void;
}) {
  const latest = useRef(options);
  const leaseRef = useRef<MountedComposerLease | null>(null);
  const composing = useRef(false);
  useLayoutEffect(() => {
    latest.current = options;
  });
  useLayoutEffect(() => {
    const input = options.input.current;
    const originalReadOnly = input?.readOnly ?? false;
    let gated = false;
    let lease: MountedComposerLease;
    try {
      lease = registerMountedComposer({
        sessionId: options.sessionId,
        snapshot: () => latest.current.snapshot(),
        composing: () => composing.current,
        gate: (closed) => {
          const wasGated = gated;
          gated = closed;
          // Changing readOnly mid-composition can commit an IME. Preserve the
          // user's composition; the closure remains unavailable instead.
          if (input && !composing.current) input.readOnly = closed || originalReadOnly;
          if (wasGated && !closed) latest.current.reopened?.();
        },
      });
    } catch {
      // Capacity taints the registry. Ordinary editing still works; an explicit
      // closure cannot certify an omitted mount.
      return;
    }
    leaseRef.current = lease;
    const beforeInput = (event: Event) => {
      if (!composing.current && !lease.canMutate()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const changed = () => lease.changed();
    const start = () => {
      composing.current = true;
    };
    const end = () => {
      composing.current = false;
      lease.changed();
      if (input) input.readOnly = gated || originalReadOnly;
    };
    input?.addEventListener("beforeinput", beforeInput, true);
    input?.addEventListener("paste", beforeInput, true);
    input?.addEventListener("drop", beforeInput, true);
    input?.addEventListener("input", changed);
    input?.addEventListener("compositionstart", start);
    input?.addEventListener("compositionend", end);
    return () => {
      input?.removeEventListener("beforeinput", beforeInput, true);
      input?.removeEventListener("paste", beforeInput, true);
      input?.removeEventListener("drop", beforeInput, true);
      input?.removeEventListener("input", changed);
      input?.removeEventListener("compositionstart", start);
      input?.removeEventListener("compositionend", end);
      if (input) input.readOnly = originalReadOnly;
      void lease.retire().catch(() => {});
      // Keep this exact retired lease reachable by accepted callbacks until a
      // replacement mount binds. It rejects any new admission.
    };
  }, [options.input, options.sessionId, registerMountedComposer]);

  const canMutate = useCallback(() => leaseRef.current?.canMutate() ?? true, []);
  const prepare = useCallback(<T>(operation: (accepted: ComposerPreparation) => Promise<T>) => {
    const lease = leaseRef.current;
    if (lease) return lease.prepare(operation);
    return operation({ apply: (mutation) => mutation(), fail: () => {} });
  }, []);
  return useMemo(
    () => ({
      canMutate,
      admitAction: () => leaseRef.current?.admitAction() ?? null,
      prepare,
      changed: () => leaseRef.current?.changed(),
      publishCache: (operation: () => void) =>
        leaseRef.current?.publishCache(operation) ?? (operation(), true),
      retire: () => leaseRef.current?.retire() ?? Promise.resolve(),
      retryFailed: () => leaseRef.current?.retryFailed() ?? Promise.resolve(),
      get pending() {
        return leaseRef.current?.pending ?? false;
      },
      get retired() {
        return leaseRef.current?.retired ?? false;
      },
    }),
    [canMutate, prepare],
  );
}
