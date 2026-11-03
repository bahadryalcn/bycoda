import { registerNoteInput } from "./notesInputClosure";
import type {
  NativeInputControls,
  NativeInputObserver,
  NativeInputRead,
  NativeInputRegistration,
  NativeInputWork,
  NativeInputPublication,
} from "../../shared/lib/native-input-observer";
import {
  issueNativeInputPublication,
  consumeNativeInputPublication,
} from "../../shared/lib/native-input-observer";
import { copyNativeCaptureData, isNativeCaptureObject } from "../../shared/lib/native-capture-json";

export type NoteInputWork = NativeInputWork;
type Port = {
  key: string;
  generation: number;
  read: () => NativeInputRead;
  controls: NativeInputControls;
  acknowledgedDraft?: { raw: unknown; value: unknown };
  retainedBytes: number;
  blocked: boolean;
};
export const NOTE_PRIVATE_INPUT_LIMITS = Object.freeze({ records: 64, bytes: 64 * 1024 * 1024 });
type RetainedInput = Record<string, unknown> & {
  key: string;
  generation: number;
  mounted: false;
  unapplied: boolean;
};
export type NotePrivateRecovery = Readonly<{
  id: string;
  noteId: string;
  title: string;
  field: string;
  text: string | null;
}>;
const privateEncoder = new TextEncoder();
export function canRetainNoteInputText(observer: NativeInputObserver | undefined, text: string) {
  const actual = observer && observerOwners.get(observer);
  return actual ? actual.owner.canRetainText(actual.key, text) : true;
}
const normalizeViewText = (text: string) => text.replace(/\r\n?/g, "\n");
function privateText(snapshot: Record<string, unknown>): string | null {
  if (snapshot.source === "tag-input" || snapshot.source === "inline-edit") {
    if (typeof snapshot.draft === "string") return snapshot.draft;
  }
  if (typeof snapshot.text === "string") return snapshot.text;
  if (typeof snapshot.value === "string") return snapshot.value;
  return null;
}
function unappliedInput(
  key: string,
  snapshot: Record<string, unknown>,
  state: Record<string, unknown>,
  port?: Port,
) {
  if (snapshot.unavailable || snapshot.retainedInputStatus === "unreadable") return true;
  if (snapshot.composing || snapshot.settling || snapshot.compositionStarted) return true;
  if (snapshot.source === "tag-input")
    return (
      (typeof snapshot.draft === "string" && snapshot.draft !== "") ||
      (Array.isArray(snapshot.acceptedChanges) && snapshot.acceptedChanges.length > 0)
    );
  if (snapshot.source === "inline-edit") {
    if (snapshot.pendingInput || snapshot.failed !== null || snapshot.error !== null) {
      if (
        snapshot.pendingInput ||
        typeof snapshot.failed === "string" ||
        typeof snapshot.error === "string"
      )
        return true;
    }
    const raw = snapshot.draft;
    if (
      snapshot.phase === "saved" &&
      snapshot.committed === snapshot.value &&
      snapshot.shown === snapshot.value &&
      !snapshot.pendingInput
    )
      if (port) port.acknowledgedDraft = { raw, value: snapshot.value };
    if (raw === snapshot.committed) return false;
    return (
      !!snapshot.editing ||
      !port?.acknowledgedDraft ||
      port.acknowledgedDraft.raw !== raw ||
      port.acknowledgedDraft.value !== snapshot.committed
    );
  }
  const canonical = state.canonical as Record<string, unknown> | undefined;
  if (snapshot.inputKind === "native-text") {
    const expected =
      key === "title" ? canonical?.title : key === "body" ? canonical?.body : undefined;
    if (typeof snapshot.text !== "string" || typeof expected !== "string") return true;
    return key === "body"
      ? normalizeViewText(snapshot.text) !== normalizeViewText(expected)
      : snapshot.text !== expected;
  }
  if (snapshot.inputKind === "codemirror") {
    const expected =
      key === "source" && typeof canonical?.body === "string"
        ? canonical.body
        : snapshot.canonicalValue;
    return (
      typeof snapshot.text !== "string" ||
      typeof expected !== "string" ||
      normalizeViewText(snapshot.text) !== normalizeViewText(expected)
    );
  }
  if (snapshot.inputKind === "preview-range")
    return (
      typeof snapshot.value === "string" &&
      typeof canonical?.body === "string" &&
      snapshot.value !== canonical.body
    );
  return typeof snapshot.text === "string" || typeof snapshot.draft === "string";
}
type WorkScope = {
  owner: NoteInputOwner;
  actual: NativeInputWork;
  work: NativeInputWork;
  portGeneration: number;
  externalRevision: number;
  sourceRevision: number;
  requestedDone: boolean;
  finished: boolean;
  holds: number;
  complete(): void;
};
type NotePublicationReceipt = {
  owner: NoteInputOwner;
  sourceRevision: number;
  targets: Map<object, () => void>;
  current(): boolean;
  apply<T>(callback: () => T): T;
};
type PublishedNoteValue = {
  receipt: NotePublicationReceipt;
  snapshot: unknown;
  proofs: Map<object, NativeInputPublication>;
  controls: Map<object, { value: unknown; proof: NativeInputPublication }>;
};
type OwnersKeeper = {
  version: 1;
  owners: Set<NoteInputOwner>;
  listeners: Set<() => void>;
  nextOwner: number;
  tickets: WeakMap<NativeInputWork, WorkScope>;
  publications: WeakMap<object, PublishedNoteValue>;
  observerOwners: WeakMap<NativeInputObserver, { owner: NoteInputOwner; key: string }>;
  applying?: WorkScope;
  rechecking: boolean;
};
const ownersKey = Symbol.for("bycoda.notes-input-owners.v1");
const ownersGlobals = globalThis as Record<PropertyKey, unknown>;
const keeper = (ownersGlobals[ownersKey] ??= {
  version: 1,
  owners: new Set(),
  listeners: new Set(),
  nextOwner: 0,
  tickets: new WeakMap(),
  publications: new WeakMap(),
  observerOwners: new WeakMap(),
  rechecking: false,
}) as OwnersKeeper;
if (
  keeper.version !== 1 ||
  !(keeper.owners instanceof Set) ||
  !(keeper.listeners instanceof Set) ||
  !(keeper.tickets instanceof WeakMap) ||
  !(keeper.publications instanceof WeakMap) ||
  !(keeper.observerOwners instanceof WeakMap) ||
  !Number.isSafeInteger(keeper.nextOwner) ||
  keeper.nextOwner < 0
)
  throw new Error("Notes input ownership keeper is unavailable");
const allOwners = keeper.owners;
const privateListeners = keeper.listeners;
const tickets = keeper.tickets;
const notePublications = keeper.publications;
const observerOwners = keeper.observerOwners;
function notifyPrivateInputs() {
  if (!keeper.rechecking) {
    keeper.rechecking = true;
    try {
      for (const owner of allOwners) owner.recheckPrivateCapacity();
    } finally {
      keeper.rechecking = false;
    }
  }
  for (const listener of privateListeners) listener();
}
export function subscribeNotePrivateRecoveries(listener: () => void) {
  privateListeners.add(listener);
  return () => {
    privateListeners.delete(listener);
  };
}
export function getNotePrivateRecoveries(): readonly NotePrivateRecovery[] {
  return [...allOwners].flatMap((owner) => owner.privateRecoveries());
}
export function notePrivateInputCapacityUnavailable() {
  return [...allOwners].some((owner) => owner.privateCapacityUnavailable());
}
function applyInNoteOwner<T>(scope: WorkScope, callback: () => T): T {
  const previous = keeper.applying;
  keeper.applying = scope;
  try {
    return callback();
  } finally {
    keeper.applying = previous;
  }
}

/** One logical draft survives its views; service operations use a distinct real activity owner. */
export class NoteInputOwner {
  private readonly ownerId: number;
  private readonly ports = new Map<number, Port>();
  private readonly retained = new Map<string, RetainedInput>();
  private readonly retainedCoverage = new Map<string, readonly string[]>();
  private readonly retainedWeights = new Map<string, number>();
  private readonly observers = new Map<string, NativeInputObserver>();
  private readonly works = new Set<NativeInputWork>();
  private readonly settledWaiters = new Set<() => void>();
  private readonly listeners = new Set<() => void>();
  private nextPort = 0;
  private portGeneration = 0;
  private externalRevision = 0;
  private sourceRevision = 0;
  private readonly canonicalTargets = new Set<object>();
  private readonly pendingPublications = new Set<() => void>();
  private readonly canonicalPending = new Map<object, (() => void)[]>();
  private retiring = false;
  private acceptedCount = 0;
  private settledCount = 0;
  private readonly registration: NativeInputRegistration;
  private budgetError = false;
  privateCapacityUnavailable() {
    return this.budgetError;
  }
  recheckPrivateCapacity() {
    for (const port of this.ports.values()) {
      if (!port.blocked) continue;
      let text = "";
      try {
        text = privateText(port.read().snapshot) ?? "";
      } catch {
        /* failed read remains held */
      }
      this.reserveInput(port, text);
    }
  }
  constructor(private read: () => Record<string, unknown>) {
    if (keeper.nextOwner >= Number.MAX_SAFE_INTEGER)
      throw new Error("Notes input owner IDs are exhausted");
    this.ownerId = ++keeper.nextOwner;
    this.registration = registerNoteInput(
      () => {
        const inputs: Record<string, unknown>[] = [...this.retained.values()];
        let busy: string | undefined = this.works.size ? "notes-accepted-work" : undefined;
        const missingCoverage = new Set([...this.retainedCoverage.values()].flat());
        for (const port of this.ports.values()) {
          const value = port.read();
          if (value.busy) busy = "notes-input-busy";
          for (const reason of value.missingCoverage ?? []) missingCoverage.add(reason);
          inputs.push({
            key: port.key,
            generation: port.generation,
            mounted: true,
            ...value.snapshot,
          });
        }
        return {
          snapshot: {
            version: 1,
            qualified: false,
            origin: "local-native",
            ...this.read(),
            inputs,
            privateInputRecovery: {
              count: this.privateRecoveries().length,
              disposition: "retained-unverified",
            },
            privateInputCapacity: this.budgetError ? "unavailable" : "available",
            activity: {
              acceptedCount: this.acceptedCount,
              settledCount: this.settledCount,
              pending: this.works.size,
              retiring: this.retiring,
            },
          },
          ...(busy ? { busy } : {}),
          missingCoverage: [...missingCoverage],
        };
      },
      {
        canClose: () => [...this.ports.values()].every((port) => port.controls.canClose()),
        close: (closed) => {
          for (const port of this.ports.values())
            port.controls.close(closed || this.retiring || port.blocked);
          for (const listener of this.listeners) listener();
        },
      },
    );
    allOwners.add(this);
  }
  setRead(read: () => Record<string, unknown>) {
    this.read = read;
  }
  changed = () => this.registration.changed();
  refresh = () => this.registration.refresh();
  closed = () => this.registration.closed();
  allowed = () =>
    (!this.retiring || (keeper.applying?.owner === this && !keeper.applying.requestedDone)) &&
    this.registration.allowed();
  external<T>(apply: () => T): T {
    this.externalRevision++;
    for (const cancel of Array.from(this.pendingPublications)) cancel();
    this.canonicalPending.clear();
    return this.registration.external(apply);
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  operation(kind: string, parent?: NativeInputWork): NativeInputWork | null {
    const inherited = parent
      ? tickets.get(parent)
      : keeper.applying?.owner === this
        ? keeper.applying
        : undefined;
    if (this.retiring && !inherited) return null;
    if (!inherited) {
      for (const port of this.ports.values()) {
        if (
          port.blocked ||
          [...this.ports.values()].filter((entry) => entry.key === port.key).length !== 1 ||
          !this.reserveInput(port, privateText(port.read().snapshot) ?? "")
        )
          return null;
      }
    }
    if (this.acceptedCount >= Number.MAX_SAFE_INTEGER) return null;
    if (parent && (inherited?.owner !== this || inherited.requestedDone || !this.works.has(parent)))
      return null;
    if (inherited?.requestedDone) return null;
    const actual = this.registration.operation(kind, inherited?.actual);
    if (!actual) return null;
    this.acceptedCount++;
    let scope!: WorkScope;
    const work: NativeInputWork = Object.assign(
      () => {
        scope.requestedDone = true;
        scope.complete();
      },
      {
        apply: <T>(callback: () => T): T => actual.apply(() => applyInNoteOwner(scope, callback)),
      },
    );
    scope = {
      owner: this,
      actual,
      work,
      portGeneration: inherited?.portGeneration ?? this.portGeneration,
      externalRevision: inherited?.externalRevision ?? this.externalRevision,
      sourceRevision: inherited?.sourceRevision ?? ++this.sourceRevision,
      requestedDone: false,
      finished: false,
      holds: 0,
      complete: () => {
        if (!scope.requestedDone || scope.holds || scope.finished) return;
        scope.finished = true;
        actual();
        this.works.delete(work);
        this.settledCount++;
        if (!this.works.size) {
          for (const resolve of this.settledWaiters) resolve();
          this.settledWaiters.clear();
        }
        this.finishRetirement();
      },
    };
    tickets.set(work, scope);
    this.works.add(work);
    return work;
  }
  hasPendingWork() {
    return this.works.size > 0;
  }
  hasUnappliedPrivateInputs() {
    if ([...this.retained.values()].some((input) => input.unapplied)) return true;
    for (const port of this.ports.values()) {
      try {
        if (unappliedInput(port.key, port.read().snapshot, this.read(), port)) return true;
      } catch {
        return true;
      }
    }
    return false;
  }
  isRetiring() {
    return this.retiring;
  }
  private hasUnappliedDomainState() {
    try {
      const state = this.read();
      if (state.error || state.project || (state.edits && Object.keys(state.edits).length))
        return true;
      const base = state.base as Record<string, unknown> | undefined;
      const canonical = state.canonical as Record<string, unknown> | undefined;
      return (
        !!base &&
        !!canonical &&
        ["title", "body", "tags", "sourceCwd"].some(
          (key) => !samePublicationValue(base[key], canonical[key]),
        )
      );
    } catch {
      return true;
    }
  }
  private budgetUsage() {
    const live = new Set(
      [...this.ports.values()]
        .filter((port) => port.retainedBytes > 0)
        .map((port) => port.generation),
    );
    return {
      records:
        [...this.retained.values()].filter((entry) => !live.has(entry.generation)).length +
        [...this.ports.values()].filter((port) => port.retainedBytes > 0).length,
      bytes:
        [...this.retainedWeights].reduce(
          (sum, [key, bytes]) => sum + (live.has(this.retained.get(key)!.generation) ? 0 : bytes),
          0,
        ) + [...this.ports.values()].reduce((sum, port) => sum + port.retainedBytes, 0),
    };
  }
  private preservePort(port: Port) {
    const retainedKey = `${port.key}:${port.generation}`;
    if (this.retained.get(retainedKey)?.unapplied) return;
    let snapshot: Record<string, unknown>;
    let unapplied = true;
    let coverage: readonly string[] = [];
    try {
      const value = port.read();
      unapplied = unappliedInput(port.key, value.snapshot, this.read(), port);
      if (!unapplied) return;
      snapshot = copyNativeCaptureData(value.snapshot);
      coverage = copyNativeCaptureData(value.missingCoverage ?? []);
    } catch {
      snapshot = { unavailable: true, retainedInputStatus: "unreadable" };
      coverage = ["notes-retired-input-unreadable"];
    }
    const retained: RetainedInput = {
      ...snapshot,
      key: port.key,
      generation: port.generation,
      mounted: false,
      unapplied,
    };
    const bytes = privateEncoder.encode(JSON.stringify(retained)).byteLength;
    if (bytes > port.retainedBytes)
      throw new Error("Private input exceeded its original admission budget");
    this.retained.set(retainedKey, retained);
    this.retainedWeights.set(retainedKey, bytes);
    this.retainedCoverage.set(retainedKey, coverage);
  }
  canRetainText(key: string, text: string) {
    if (!this.allowed()) return false;
    const matching = [...this.ports.values()].filter((entry) => entry.key === key);
    if (matching.length !== 1) {
      this.budgetError = true;
      notifyPrivateInputs();
      return false;
    }
    const port = matching[0];
    return this.reserveInput(port, text);
  }
  private reserveInput(port: Port, text: string) {
    let snapshot: Record<string, unknown>;
    try {
      snapshot = port.read().snapshot;
    } catch {
      snapshot = {};
    }
    const small =
      snapshot.source === "tag-input" || snapshot.source === "inline-edit" || port.key === "title";
    const textBytes = privateEncoder.encode(text).byteLength;
    const requested =
      (snapshot.source === "tag-input" ? 1280 * 1024 : 8192) + textBytes * (small ? 8 : 3);
    const usage = [...allOwners].map((owner) => owner.budgetUsage());
    const bytes = usage.reduce((sum, entry) => sum + entry.bytes, 0) - port.retainedBytes;
    const records =
      usage.reduce((sum, entry) => sum + entry.records, 0) - (port.retainedBytes ? 1 : 0);
    if (
      textBytes > (small ? 1024 * 1024 : 8 * 1024 * 1024) ||
      bytes + requested > NOTE_PRIVATE_INPUT_LIMITS.bytes ||
      records >= NOTE_PRIVATE_INPUT_LIMITS.records
    ) {
      this.budgetError = true;
      notifyPrivateInputs();
      return false;
    }
    const wasBlocked = port.blocked;
    port.retainedBytes = Math.max(port.retainedBytes, requested);
    port.blocked = false;
    if (wasBlocked && port.controls.canClose()) port.controls.close(this.closed() || this.retiring);
    if (this.budgetError) {
      this.budgetError = false;
      notifyPrivateInputs();
    }
    return true;
  }
  privateRecoveries(): NotePrivateRecovery[] {
    let state: Record<string, unknown>;
    try {
      state = this.read();
    } catch {
      return [];
    }
    if (typeof state.noteId !== "string") return [];
    const canonical = state.canonical as Record<string, unknown> | undefined;
    const result = [...this.retained.values()]
      .filter((input) => input.unapplied)
      .flatMap((input) => {
        const base = {
          id: `${this.ownerId}:${input.generation}`,
          noteId: state.noteId as string,
          title: typeof canonical?.title === "string" ? canonical.title : (state.noteId as string),
          field: input.key,
        };
        const result: NotePrivateRecovery[] = [];
        const raw = privateText(input);
        if (
          input.source !== "tag-input" ||
          raw !== "" ||
          !Array.isArray(input.acceptedChanges) ||
          !input.acceptedChanges.length
        )
          result.push({ ...base, text: raw });
        if (input.source === "tag-input" && Array.isArray(input.acceptedChanges))
          input.acceptedChanges.forEach((change, index) => {
            if (change && typeof change === "object" && typeof change.raw === "string")
              result.push({ ...base, id: `${base.id}:${index}`, text: change.raw });
          });
        return result;
      });
    if (Array.isArray(state.unadmittedInputs))
      for (const field of state.unadmittedInputs) {
        if (typeof field === "string" && typeof canonical?.[field] === "string")
          result.push({
            id: `${this.ownerId}:unadmitted:${field}`,
            noteId: state.noteId,
            title: typeof canonical.title === "string" ? canonical.title : state.noteId,
            field,
            text: canonical[field],
          });
      }
    return result;
  }
  whenSettled(): Promise<void> {
    if (!this.works.size) return Promise.resolve();
    return new Promise((resolve) => this.settledWaiters.add(resolve));
  }
  private currentScope(scope: WorkScope) {
    return (
      scope.owner === this &&
      !scope.finished &&
      !this.retiring &&
      scope.portGeneration === this.portGeneration &&
      scope.externalRevision === this.externalRevision
    );
  }
  private retain(scope: WorkScope) {
    scope.holds++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.pendingPublications.delete(release);
      scope.holds--;
      scope.complete();
    };
    this.pendingPublications.add(release);
    return release;
  }
  attachCanonical(target: object) {
    this.external(() => {
      this.portGeneration++;
      this.canonicalTargets.add(target);
    });
    return () => {
      this.external(() => {
        this.portGeneration++;
        this.canonicalTargets.delete(target);
        this.canonicalPending.delete(target);
      });
      this.finishRetirement();
    };
  }
  publishControl(
    key: string,
    value: unknown,
    parent?: NativeInputWork,
  ): NativeInputPublication | undefined {
    const scope = parent ? tickets.get(parent) : keeper.applying;
    if (
      !scope ||
      scope.owner !== this ||
      scope.requestedDone ||
      !this.currentScope(scope) ||
      ![...this.ports.values()].some((port) => port.key === key)
    )
      return;
    const release = this.retain(scope);
    return issueNativeInputPublication({
      target: this.observer(key),
      value,
      current: () => this.currentScope(scope),
      apply: (callback) => scope.work.apply(callback),
      committed: release,
    });
  }
  publishResult(scope: WorkScope, value: object): NotePublicationReceipt | undefined {
    if (!this.currentScope(scope) || scope.requestedDone || !this.canonicalTargets.size) return;
    const row = value as Record<string, unknown>;
    const state = this.read();
    if (typeof row.id !== "string" || row.id !== state.noteId) return;
    const base = state.base as Record<string, unknown> | undefined;
    if (
      typeof row.updatedAt === "number" &&
      typeof base?.updatedAt === "number" &&
      row.updatedAt < base.updatedAt
    )
      return;
    const targets = new Map<object, () => void>();
    for (const target of this.canonicalTargets) {
      const release = this.retain(scope);
      const predecessors = this.canonicalPending.get(target) ?? [];
      const chain = [...predecessors, release];
      this.canonicalPending.set(target, chain);
      targets.set(target, () => {
        // The exact later state publication may supersede earlier queued
        // publications to this same live target. This is no value mask.
        chain.forEach((finish) => finish());
        if (this.canonicalPending.get(target) === chain) this.canonicalPending.delete(target);
      });
    }
    return {
      owner: this,
      sourceRevision: scope.sourceRevision,
      targets,
      current: () => this.currentScope(scope),
      apply: (callback) => scope.work.apply(callback),
    };
  }
  commitCanonical(target: object, value: unknown) {
    if (!value || typeof value !== "object") return false;
    const publication = notePublications.get(value);
    if (
      !publication ||
      publication.receipt.owner !== this ||
      !samePublicationValue(value, publication.snapshot)
    )
      return false;
    const proof = publication.proofs.get(target);
    return !!proof && consumeNativeInputPublication(proof, target, value);
  }
  resultControlPublication(value: unknown, key: string, projected: unknown) {
    if (!value || typeof value !== "object") return;
    const publication = notePublications.get(value);
    if (
      !publication ||
      publication.receipt.owner !== this ||
      !publication.receipt.current() ||
      !samePublicationValue(value, publication.snapshot)
    )
      return;
    const target = this.observer(key);
    const cached = publication.controls.get(target);
    if (cached && Object.is(cached.value, projected)) return cached.proof;
    const proof = issueNativeInputPublication({
      target,
      value: projected,
      current: () =>
        publication.receipt.current() && samePublicationValue(value, publication.snapshot),
      apply: publication.receipt.apply,
      committed: () => {},
    });
    publication.controls.set(target, { value: projected, proof });
    return proof;
  }
  observer(key: string): NativeInputObserver {
    let observer = this.observers.get(key);
    if (!observer) {
      observer = {
        attach: (read, controls) => {
          const generation = ++this.nextPort;
          const port: Port = { key, generation, read, controls, retainedBytes: 0, blocked: false };
          this.external(() => {
            this.portGeneration++;
            for (const [oldKey, input] of this.retained) {
              if (input.key === key && !input.unapplied) {
                this.retained.delete(oldKey);
                this.retainedCoverage.delete(oldKey);
                this.retainedWeights.delete(oldKey);
              }
            }
            this.ports.set(generation, port);
            let initialText = "";
            try {
              initialText = privateText(read().snapshot) ?? "";
            } catch {
              /* failed read stays held */
            }
            port.blocked = !this.reserveInput(port, initialText);
            if ((this.closed() || port.blocked) && controls.canClose()) controls.close(true);
          });
          const observed = () => {
            try {
              const snapshot = read().snapshot;
              unappliedInput(key, snapshot, this.read(), port);
              this.reserveInput(port, privateText(snapshot) ?? "");
            } catch {
              /* A failed real read stays unknown. */
            }
          };
          let retired = false;
          return {
            changed: () => {
              observed();
              this.changed();
            },
            refresh: () => {
              observed();
              this.refresh();
            },
            closed: this.closed,
            allowed: () =>
              !retired &&
              !port.blocked &&
              [...this.ports.values()].filter((entry) => entry.key === key).length === 1 &&
              this.allowed(),
            external: (callback) => this.external(callback),
            operation: (kind, parent) => {
              if (retired && !parent) return null;
              if (
                !parent &&
                [...this.ports.values()].filter((entry) => entry.key === key).length !== 1
              ) {
                this.budgetError = true;
                notifyPrivateInputs();
                return null;
              }
              if (!parent && !this.reserveInput(port, privateText(read().snapshot) ?? ""))
                return null;
              return this.operation(kind, parent);
            },
            unregister: () => {
              if (retired) return;
              retired = true;
              this.external(() => {
                // Freeze the original once while its real reader is still live.
                this.preservePort(port);
                this.portGeneration++;
                this.ports.delete(generation);
              });
              notifyPrivateInputs();
              this.finishRetirement();
            },
          };
        },
      };
      this.observers.set(key, observer);
      observerOwners.set(observer, { owner: this, key });
    }
    return observer;
  }
  retire() {
    if (this.retiring) return;
    this.external(() => {
      this.retiring = true;
      for (const port of this.ports.values()) {
        this.preservePort(port);
        if (port.controls.canClose()) port.controls.close(true);
      }
    });
    this.finishRetirement();
  }
  private finishRetirement() {
    if (
      !this.retiring ||
      this.works.size ||
      this.ports.size ||
      this.canonicalTargets.size ||
      this.hasUnappliedDomainState() ||
      [...this.retained.values()].some((input) => input.unapplied)
    )
      return;
    this.registration.unregister();
    allOwners.delete(this);
    notifyPrivateInputs();
  }
}

// The known service lane belongs to the roster before any request. A refused
// first request during closure must not mount a new producer and invalidate it.
const activity = new NoteInputOwner(() => ({
  surface: "activity",
  role: "native-notes-service",
}));
export function noteActivityOwner() {
  return activity;
}
export function beginNoteWork(kind: string, parent?: NativeInputWork) {
  const owner =
    (parent ? tickets.get(parent)?.owner : undefined) ??
    keeper.applying?.owner ??
    noteActivityOwner();
  if (parent && !tickets.has(parent)) return null;
  return owner.operation(kind, parent);
}
export function requireNoteWork(kind: string, parent?: NativeInputWork) {
  const work = beginNoteWork(kind, parent);
  if (!work)
    throw noteInputWorkError(
      parent ? tickets.get(parent)?.owner : (keeper.applying?.owner ?? noteActivityOwner()),
    );
  return work;
}
export function noteInputWorkError(owner: NoteInputOwner = noteActivityOwner()) {
  return new Error(
    owner.closed()
      ? "Preparing checkpoint…"
      : "Notes input is busy or unavailable. Your draft is preserved.",
  );
}
export function noteWorkOwner(work: NativeInputWork) {
  const scope = tickets.get(work);
  return scope && !scope.finished && !scope.requestedDone ? scope.owner : undefined;
}
export function notesInputAllowed() {
  return noteActivityOwner().allowed();
}

function samePublicationValue(value: unknown, snapshot: unknown): boolean {
  if (Object.is(value, snapshot)) return true;
  if (
    !value ||
    !snapshot ||
    typeof value !== "object" ||
    typeof snapshot !== "object" ||
    Array.isArray(value) !== Array.isArray(snapshot)
  )
    return false;
  try {
    if (!Array.isArray(value) && !isNativeCaptureObject(value)) return false;
    const left = Reflect.ownKeys(value),
      right = Reflect.ownKeys(snapshot);
    return (
      left.length === right.length &&
      left.every((key) => {
        if (typeof key !== "string") return false;
        const actual = Object.getOwnPropertyDescriptor(value, key);
        const captured = Object.getOwnPropertyDescriptor(snapshot, key);
        return (
          !!actual &&
          !!captured &&
          "value" in actual &&
          "value" in captured &&
          actual.enumerable === captured.enumerable &&
          samePublicationValue(actual.value, captured.value)
        );
      })
    );
  } catch {
    return false;
  }
}
function bindNotePublication(value: object, receipt: NotePublicationReceipt) {
  if (!receipt.current()) return;
  const snapshot = copyNativeCaptureData(value);
  const proofs = new Map<object, NativeInputPublication>();
  for (const target of receipt.targets.keys()) {
    proofs.set(
      target,
      issueNativeInputPublication({
        target,
        value,
        current: () => receipt.current() && samePublicationValue(value, snapshot),
        apply: receipt.apply,
        committed: () => {
          const commit = receipt.targets.get(target);
          receipt.targets.delete(target);
          commit?.();
        },
      }),
    );
  }
  notePublications.set(value, { receipt, snapshot, proofs, controls: new Map() });
}
/** Only an actual successful writer calls this, before its real work finishes. */
export function publishNoteInputResult<T extends object>(work: NativeInputWork, value: T): T {
  const scope = tickets.get(work);
  if (!scope || scope.requestedDone || scope.finished) return value;
  // The service-intent observer preserves actual Native success if publication
  // bookkeeping fails, while retaining its original request as unverified.
  let receipt: NotePublicationReceipt | undefined;
  try {
    receipt = scope.owner.publishResult(scope, value);
    if (receipt) bindNotePublication(value, receipt);
  } catch (error) {
    for (const cancel of receipt?.targets.values() ?? []) cancel();
    throw error;
  }
  return value;
}
/** Explicit actual DTO transformations preserve provenance; equal objects never acquire it. */
export function deriveNoteInputResult<T extends object>(value: T, ...sources: object[]): T {
  const entries = sources.map((source) => ({ source, publication: notePublications.get(source) }));
  const receipt = entries[0]?.publication?.receipt;
  if (
    !receipt ||
    !entries.every(
      ({ source, publication }) =>
        publication?.receipt === receipt && samePublicationValue(source, publication.snapshot),
    )
  )
    return value;
  try {
    bindNotePublication(value, receipt);
  } catch {
    /* Unverified projection remains ordinary data. */
  }
  return value;
}

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    for (const owner of allOwners) owner.retire();
  });
