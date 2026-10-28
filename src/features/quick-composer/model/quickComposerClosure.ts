import {
  beginComposerClosure,
  registerMountedComposer,
  ComposerClosureError,
  type ComposerPreparation,
  type MountedComposerLease,
} from "../../sessions/data/composerClosure";
import type { Attachment, HarnessId, RuntimeMode } from "../../sessions/model/session";
import type { QuickWorkspace } from "./quickWorkspace";

export interface QuickComposerDraft {
  prompt: string;
  attachments: Attachment[];
  cwd: string | null;
  choice: { harness: HarnessId; model: string };
  modelSettings: Record<string, string>;
  pickedRuntimeMode: RuntimeMode | null;
  workspaceChoice: QuickWorkspace;
}
export interface QuickComposerEffective {
  model: { harness: HarnessId; id: string } | null;
  settings: Record<string, string>;
  runtimeMode: RuntimeMode;
  workspace: QuickWorkspace;
  workspacePending: boolean;
  workspaceError?: string;
}
export interface QuickComposerCapture {
  readonly version: 1;
  readonly qualified: false;
  /** Renderer matching hints, never physical Window or Native authority. */
  readonly rendererWindowId: string;
  readonly intentId: string;
  readonly revision: number;
  readonly draft: Readonly<QuickComposerDraft>;
  readonly effective: Readonly<QuickComposerEffective> | null;
  readonly missingCoverage: readonly string[];
}
/** Future composition supplies its actual opaque Native challenge/receipt types.
 * Implementing this contract does not turn the renderer capture into proof.
 * No adapter is installed or invoked by this renderer increment.
 */
export interface QuickComposerNativeCaptureAdapter<NativeChallenge, NativeReceipt> {
  capture(challenge: NativeChallenge, snapshot: QuickComposerCapture): Promise<NativeReceipt>;
}
export interface QuickPreparation extends ComposerPreparation {
  /** Cache successful stages, including an empty selection; rejection remains retryable. */
  stage<T>(key: string, operation: () => Promise<T>): Promise<T>;
  /** Mutable external selection/capture: retain even unknown/rejected outcomes. */
  once<T>(key: string, operation: () => Promise<T>): Promise<T>;
}
type View = {
  implementation: number;
  alive: boolean;
  readPrompt?: () => string | null;
  composing?: () => boolean;
  gate?: (closed: boolean) => void;
};
type State = {
  version: 1;
  rendererWindowId: string;
  intentId: string;
  revision: number;
  tick: number;
  draft: QuickComposerDraft;
  effective: QuickComposerEffective | null;
  listeners: Set<() => void>;
  views: Set<View>;
  lease?: MountedComposerLease;
  registrar?: typeof registerMountedComposer;
  activeLease?: MountedComposerLease;
  active: number;
  launching: number;
  closed: boolean;
  unknown: boolean;
  queue: { tail: Promise<void>; pending: number; screenshot: boolean };
};
type RuntimeState = { implementation: number; window?: State };
type Mounted = Pick<
  ReturnType<typeof import("../../sessions/data/composerClosure").createMountedComposerRegistry>,
  "registerMountedComposer" | "beginComposerClosure"
>;
const missing = Object.freeze([
  "native-physical-window-challenge",
  "native-sessionless-full-snapshot-retention",
  "native-attachment-durability",
  "native-launch-intent-crash-reconciliation",
  "native-quick-git-popup-challenge-binding",
  "provider-output",
]);

function immutable<T>(value: T): T {
  let bytes = 0;
  let nodes = 0;
  const copy = (input: unknown, depth: number): unknown => {
    if (++nodes > 8192 || depth > 16) throw new ComposerClosureError("capacity");
    if (typeof input === "string") {
      bytes += input.length * 2;
      if (bytes > 64 * 1024 * 1024) throw new ComposerClosureError("capacity");
      return input;
    }
    if (input === undefined || input === null || typeof input === "boolean") return input;
    if (typeof input === "number" && Number.isFinite(input)) return input;
    if (typeof input !== "object") throw new ComposerClosureError("changed");
    return Object.freeze(
      Array.isArray(input)
        ? input.map((item) => copy(item, depth + 1))
        : Object.fromEntries(
            Object.entries(input).map(([key, item]) => [key, copy(item, depth + 1)]),
          ),
    );
  };
  return copy(value, 0) as T;
}

function implement(runtime: RuntimeState, mounted: Mounted) {
  const implementation = ++runtime.implementation;
  runtime.window?.lease?.changed();
  const notify = (state: State) => {
    state.tick++;
    for (const listener of state.listeners) listener();
  };
  const prompt = (state: State) => {
    const values = [...state.views]
      .filter((view) => view.alive)
      .flatMap((view) => {
        const value = view.readPrompt?.();
        return value == null ? [] : [value];
      });
    if (new Set(values).size > 1) throw new ComposerClosureError("changed");
    return values[0] ?? state.draft.prompt;
  };
  const ensureLease = (state: State) => {
    if (state.lease && state.registrar === mounted.registerMountedComposer) return state.lease;
    if (state.lease)
      void state.lease.retire().catch(() => {
        state.unknown = true;
      });
    state.registrar = mounted.registerMountedComposer;
    state.lease = mounted.registerMountedComposer({
      snapshot: () => ({ text: prompt(state), attachments: state.draft.attachments, mcpTags: [] }),
      composing: () => [...state.views].some((view) => view.alive && view.composing?.()),
      gate: (closed) => {
        state.closed = closed;
        for (const view of state.views) if (view.alive) view.gate?.(closed);
      },
    });
    return state.lease;
  };
  const capture = (state: State): QuickComposerCapture =>
    immutable({
      version: 1,
      qualified: false,
      rendererWindowId: state.rendererWindowId,
      intentId: state.intentId,
      revision: state.revision,
      draft: {
        ...state.draft,
        prompt: prompt(state),
        attachments: state.draft.attachments.map(
          ({ previewUrl: _url, loadPreview: _load, copyFromPath: _copy, ...file }) => file,
        ),
      },
      effective: state.effective,
      missingCoverage: missing,
    });
  const window = (initial: QuickComposerDraft): State =>
    (runtime.window ??= {
      version: 1,
      rendererWindowId: crypto.randomUUID(),
      intentId: crypto.randomUUID(),
      revision: 0,
      tick: 0,
      draft: initial,
      effective: null,
      listeners: new Set(),
      views: new Set(),
      active: 0,
      launching: 0,
      closed: false,
      unknown: false,
      queue: { tail: Promise.resolve(), pending: 0, screenshot: false },
    });
  const bind = (state: State) => {
    let view: View | undefined;
    const canMutate = () =>
      !!state.activeLease ||
      (!!view?.alive &&
        view.implementation === runtime.implementation &&
        ensureLease(state).canMutate());
    const mutate = <T>(operation: () => T): T => {
      if (!canMutate()) throw new ComposerClosureError(view?.alive ? "closed" : "retired");
      return (state.activeLease ?? ensureLease(state)).mutate(operation);
    };
    const update = (operation: (draft: QuickComposerDraft) => QuickComposerDraft) =>
      mutate(() => {
        const next = operation(state.draft);
        if (next === state.draft) return;
        if (!Number.isSafeInteger(state.revision + 1)) {
          state.unknown = true;
          throw new ComposerClosureError("capacity");
        }
        state.draft = next;
        state.revision++;
        notify(state);
      });
    return {
      draft: () => state.draft,
      /** Actual live DOM may lead retained state during IME/remount. Reads are
       * matching/capture only, never operation or Native authority. */
      currentPrompt: () => prompt(state),
      get composing() {
        return [...state.views].some((view) => view.alive && view.composing?.());
      },
      version: () => state.tick,
      subscribe(listener: () => void) {
        state.listeners.add(listener);
        return () => {
          state.listeners.delete(listener);
        };
      },
      canMutate,
      update,
      externalPrompt(text: string) {
        if (state.draft.prompt === text) return;
        state.draft = { ...state.draft, prompt: text };
        state.revision++;
        ensureLease(state).changed();
        notify(state);
      },
      changed() {
        state.revision++;
        ensureLease(state).changed();
      },
      /** External catalog/default changes are preserved and invalidate closure. */
      effective(value: QuickComposerEffective) {
        if (JSON.stringify(value) === JSON.stringify(state.effective)) return;
        state.effective = value;
        state.revision++;
        ensureLease(state).changed();
      },
      mount(adapter: Omit<View, "implementation" | "alive">) {
        if (state.views.size >= 32) {
          state.unknown = true;
          throw new ComposerClosureError("capacity");
        }
        const lease = ensureLease(state);
        view = { ...adapter, alive: true, implementation };
        state.views.add(view);
        lease.changed();
        view.gate?.(state.closed);
        const owned = view;
        return () => {
          // Read the real DOM while its owner is still present, even before a
          // controlled React change reached its render/effect.
          const text = owned.readPrompt?.();
          if (text != null && text !== state.draft.prompt) {
            state.draft = { ...state.draft, prompt: text };
            state.revision++;
          }
          owned.alive = false;
          state.views.delete(owned);
          lease.changed();
          // The retained window producer, data and accepted jobs outlive this
          // view. Detaching is never Native destruction or persistence proof.
        };
      },
      prepare<T>(
        operation: (accepted: QuickPreparation) => Promise<T>,
        kind?: "launch",
      ): Promise<T> {
        if (!canMutate()) return Promise.reject(new ComposerClosureError("closed"));
        const lease = ensureLease(state);
        const intentId = state.intentId;
        const completed = new Map<string, unknown>();
        const pending = new Map<string, Promise<unknown>>();
        const once = new Map<string, Promise<unknown>>();
        const oncePending = new Set<Promise<unknown>>();
        return lease.prepare(async (accepted) => {
          if (state.intentId !== intentId) throw new ComposerClosureError("changed");
          state.active++;
          if (kind === "launch") state.launching++;
          notify(state);
          try {
            return await operation({
              apply<TValue>(operation: () => TValue): TValue {
                if (state.intentId !== intentId) throw new ComposerClosureError("changed");
                return accepted.apply(() => {
                  const previous = state.activeLease;
                  state.activeLease = lease;
                  try {
                    return operation();
                  } finally {
                    state.activeLease = previous;
                  }
                });
              },
              fail: accepted.fail,
              stage<TValue>(key: string, operation: () => Promise<TValue>): Promise<TValue> {
                if (completed.has(key)) return Promise.resolve(completed.get(key) as TValue);
                const running = pending.get(key);
                if (running) return running as Promise<TValue>;
                if (completed.size + pending.size + once.size >= 64)
                  return Promise.reject(new ComposerClosureError("capacity"));
                const actual = operation();
                pending.set(key, actual);
                void actual.then(
                  (value) => {
                    pending.delete(key);
                    completed.set(key, value);
                  },
                  () => {
                    pending.delete(key);
                  },
                );
                return actual;
              },
              once<TValue>(key: string, operation: () => Promise<TValue>): Promise<TValue> {
                const known = once.get(key);
                if (known) return known as Promise<TValue>;
                if (completed.size + pending.size + once.size >= 64)
                  return Promise.reject(new ComposerClosureError("capacity"));
                let actual: Promise<TValue>;
                try {
                  actual = operation();
                } catch (error) {
                  actual = Promise.reject(error);
                }
                once.set(key, actual);
                oncePending.add(actual);
                void actual.then(
                  () => {
                    oncePending.delete(actual);
                  },
                  () => {
                    oncePending.delete(actual);
                  },
                );
                return actual;
              },
            });
          } finally {
            // Promise rejection is not cancellation of a sibling stage. Even
            // a caller using Promise.all owns every admitted stage to settlement.
            while (pending.size || oncePending.size)
              await Promise.allSettled([...pending.values(), ...oncePending]);
            state.active--;
            if (kind === "launch") state.launching--;
            notify(state);
          }
        });
      },
      /** Only the acknowledged ordinary handoff rotates the renderer intent. */
      nextIntent() {
        return mutate(() => {
          state.intentId = crypto.randomUUID();
          state.revision++;
        });
      },
      queue: state.queue,
      touch: () => notify(state),
      get pending() {
        return state.active > 0 || state.queue.pending > 0;
      },
      get launching() {
        return state.launching > 0;
      },
      get attachmentPending() {
        return state.queue.pending;
      },
      get admitted() {
        return !!state.activeLease;
      },
      unknown() {
        state.unknown = true;
        ensureLease(state).changed();
      },
      get retired() {
        return !view?.alive;
      },
      get intentId() {
        return state.intentId;
      },
      get rendererWindowId() {
        return state.rendererWindowId;
      },
    };
  };
  const begin = (options: { owner: object; timeoutMs?: number; signal?: AbortSignal }) => {
    const state = runtime.window;
    if (!state) throw new ComposerClosureError("changed");
    ensureLease(state);
    const actualPrompt = prompt(state);
    if (actualPrompt !== state.draft.prompt) {
      state.draft = { ...state.draft, prompt: actualPrompt };
      state.revision++;
      state.lease!.changed();
      notify(state);
    }
    const baseline = capture(state);
    const underlying = mounted.beginComposerClosure("profile", options);
    let receipt: QuickComposerCapture | undefined;
    let pending: Promise<QuickComposerCapture> | undefined;
    const assertCurrent = () => {
      underlying.assertCurrent();
      if (
        !receipt ||
        state.unknown ||
        state.active ||
        state.queue.pending ||
        JSON.stringify(capture(state)) !== JSON.stringify(receipt)
      )
        throw new ComposerClosureError("changed");
    };
    return {
      captureAndFlush(): Promise<QuickComposerCapture> {
        if (receipt) {
          try {
            assertCurrent();
          } catch (error) {
            return Promise.reject(error);
          }
        }
        if (pending) return pending;
        const actual = underlying.captureAndFlush().then(() => {
          if (state.unknown || state.active || state.queue.pending)
            throw new ComposerClosureError("changed");
          receipt = capture(state);
          // Effective options are included even though the base ComposerDraft
          // intentionally contains only prompt/files. Their revision participates.
          if (receipt.rendererWindowId !== baseline.rendererWindowId)
            throw new ComposerClosureError("changed");
          underlying.assertCurrent();
          return receipt;
        });
        pending = actual;
        void actual.catch(() => {
          if (pending === actual) pending = undefined;
        });
        return actual;
      },
      assertCurrent,
      retryFailed(owner: object) {
        pending = undefined;
        receipt = undefined;
        return underlying.retryFailed(owner);
      },
      reopen(owner: object) {
        underlying.reopen(owner);
      },
    };
  };
  return {
    window,
    bind,
    begin,
    observation: () => ({ qualified: false as const, active: runtime.window?.active ?? 0 }),
  };
}

export function createQuickComposerClosureRuntime(mounted: Mounted) {
  return implement({ implementation: 0 }, mounted);
}
const key = Symbol.for("bycoda.quick-composer-closure.v1");
const globals = globalThis as typeof globalThis & { [key]?: RuntimeState };
export const quickComposerClosure = implement((globals[key] ??= { implementation: 0 }), {
  registerMountedComposer,
  beginComposerClosure,
});
export type QuickComposerClosureRuntime = typeof quickComposerClosure;
export type QuickComposerOwner = ReturnType<QuickComposerClosureRuntime["bind"]>;
