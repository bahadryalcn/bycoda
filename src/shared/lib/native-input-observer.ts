import { copyNativeCaptureData } from "./native-capture-json";

/** Private producer observation only; no persistence or operation authority DTO. */
export type NativeInputRead = Readonly<{
  snapshot: Record<string, unknown>;
  busy?: string;
  missingCoverage?: readonly string[];
}>;

export type NativeInputControls = {
  canClose(): boolean;
  close(closed: boolean): void;
};

/** Finish only after actual work settles; apply grants synchronous lineage only. */
export type NativeInputWork = (() => void) & { apply<T>(callback: () => T): T };

export interface NativeInputRegistration {
  changed(): void;
  refresh(): void;
  unregister(): void;
  closed(): boolean;
  allowed(): boolean;
  external<T>(callback: () => T): T;
  operation(kind: string, parent?: NativeInputWork): NativeInputWork | null;
}

export interface NativeInputObserver {
  attach(read: () => NativeInputRead, controls: NativeInputControls): NativeInputRegistration;
}

const publicationBrand = Symbol("native-input-publication");
export type NativeInputPublication = Readonly<{ [publicationBrand]: true }>;
type PublicationIssuer = {
  target: object;
  value: unknown;
  /** Issuer checks its real work, owner, source/view/port and external generation. */
  current(): boolean;
  apply<T>(callback: () => T): T;
  committed(): void;
};
const publications = new WeakMap<
  NativeInputPublication,
  { issuer: PublicationIssuer; consumed: boolean }
>();

/** Only the actual admitted producer issues this alongside its React state. */
export function issueNativeInputPublication(issuer: PublicationIssuer): NativeInputPublication {
  const proof = Object.freeze({ [publicationBrand]: true as const });
  publications.set(proof, { issuer: { ...issuer }, consumed: false });
  return proof;
}

/** Exact one-time publication ACK; an unmarked/stale render acquires no permit. */
export function consumeNativeInputPublication(
  proof: NativeInputPublication | undefined,
  target: object,
  value: unknown,
  project?: () => void,
): boolean {
  const record = proof && publications.get(proof);
  if (
    !record ||
    record.consumed ||
    record.issuer.target !== target ||
    !Object.is(record.issuer.value, value)
  )
    return false;
  try {
    if (!record.issuer.current()) return false;
    record.consumed = true;
    let applied = false;
    record.issuer.apply(() => {
      if (!record.issuer.current()) return;
      const result: unknown = project?.();
      if (
        result &&
        (typeof result === "object" || typeof result === "function") &&
        "then" in result
      )
        throw new Error("Native input publication requires a synchronous projection");
      applied = true;
    });
    if (!applied) return false;
    record.issuer.committed();
    return true;
  } catch {
    // Do not repeat a projection with an unknown outcome or fabricate its ACK.
    return false;
  }
}

const controlOwners = new WeakMap<NativeInputObserver, number>();
let nextControlOwner = 0;
/** React-only identity: a different logical observer never reuses private refs. */
export function nativeInputControlKey(observer?: NativeInputObserver): string {
  if (!observer) return "ordinary-input";
  let key = controlOwners.get(observer);
  if (key === undefined) {
    key = ++nextControlOwner;
    controlOwners.set(observer, key);
  }
  return `observed-input-${key}`;
}

/** A view may detach while its original callback is still actually running. */
export function createNativeInputControlPort(
  observer: NativeInputObserver,
  read: () => NativeInputRead,
  controls: NativeInputControls,
) {
  let live = true;
  let frozen: NativeInputRead | undefined;
  let failure: unknown;
  let failed = false;
  const works = new Set<NativeInputWork>();
  let unregistered = false;
  const current = (): NativeInputRead => {
    if (failed) throw failure;
    const value = live ? read() : frozen!;
    return works.size ? { ...value, busy: value.busy ?? "shared-input-work" } : value;
  };
  const registration = observer.attach(current, {
    canClose: () => live && controls.canClose(),
    close: (closed) => {
      if (live) controls.close(closed);
    },
  });
  const unregister = () => {
    if (!live && !works.size && !unregistered && !failed) {
      try {
        registration.unregister();
        unregistered = true;
      } catch (error) {
        failed = true;
        failure = error;
        // A bookkeeping failure cannot crash an ordinary view retirement or
        // turn the already accepted callback into a fabricated write retry.
        try {
          registration.external(() => {});
        } catch {
          /* original failure stays held */
        }
      }
    }
  };
  return {
    get live() {
      return live;
    },
    retiredRead: () => (live || failed ? undefined : frozen),
    allowed: () => live && registration.allowed(),
    closed: () => registration.closed(),
    changed: () => registration.changed(),
    refresh: () => registration.refresh(),
    external<T>(apply: () => T): T {
      return registration.external(apply);
    },
    operation(kind: string) {
      if (!live) return null;
      const work = registration.operation(kind);
      if (work) works.add(work);
      return work;
    },
    finish(work: NativeInputWork) {
      if (!works.delete(work)) return;
      // Retired readers expose their final data before the actual work settles.
      try {
        unregister();
      } finally {
        work();
      }
    },
    retiredOutcome(patch: Record<string, unknown>) {
      if (live || !frozen || failed) return;
      try {
        frozen = copyNativeCaptureData({ ...frozen, snapshot: { ...frozen.snapshot, ...patch } });
      } catch (error) {
        failed = true;
        failure = error;
      }
      registration.changed();
    },
    retire() {
      if (!live) return;
      try {
        frozen = copyNativeCaptureData(read());
      } catch (error) {
        failed = true;
        failure = error;
      }
      live = false;
      unregister();
    },
  };
}
