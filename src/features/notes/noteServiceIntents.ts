import {
  copyNativeCaptureData,
  createNativeCaptureSnapshotEncoder,
  isNativeCaptureObject,
  stringifyNativeCaptureJson,
} from "../../shared/lib/native-capture-json";
import type {
  NativeInputRead,
  NativeInputRegistration,
} from "../../shared/lib/native-input-observer";
import { registerNoteInput } from "./notesInputClosure";
import { noteWorkOwner, type NoteInputWork } from "./notesInputOwners";

export const NOTE_SERVICE_INTENT_LIMITS = Object.freeze({
  records: 64,
  bytes: 8 * 1024 * 1024,
  errorBytes: 512,
});
export type NoteServiceCommand =
  | "notes_upsert"
  | "notes_delete"
  | "notes_link_session"
  | "notes_image_path"
  | "notes_save_image"
  | "notes_discard_recovery_assets";
const commands = new Set<NoteServiceCommand>([
  "notes_upsert",
  "notes_delete",
  "notes_link_session",
  "notes_image_path",
  "notes_save_image",
  "notes_discard_recovery_assets",
]);
const KEY = Symbol.for("bycoda.note-service-intents.v1");
// Covers status/UUID/error JSON overhead even when every error character needs
// escaping. The byte budget is conservative retained wire data, not an RSS cap.
const OVERHEAD = 4096;
const encoder = new TextEncoder();

export class NoteServiceIntentError extends Error {
  constructor(
    readonly code:
      | "capacity"
      | "invalid-request"
      | "work-unavailable"
      | "already-executed"
      | "registry-unavailable",
  ) {
    super(
      code === "capacity"
        ? "Notes request conservation is full. Original requests are retained."
        : `Notes request conservation unavailable: ${code}`,
    );
    this.name = "NoteServiceIntentError";
  }
}
type IntentData = Readonly<{
  id: number;
  callId: string;
  command: NoteServiceCommand;
  args: Record<string, unknown>;
  status: "pending" | "unverified";
  phase:
    | "native-pending"
    | "result-application-pending"
    | "native-outcome-unverified"
    | "result-application-unverified";
  error: string | null;
}>;
type RecordEntry = { data: IntentData; weight: number; pending: boolean };
type Keeper = {
  version: 1;
  nextId: number;
  bytes: number;
  records: Map<number, RecordEntry>;
  read: () => NativeInputRead;
  register?: typeof registerNoteInput;
  registration?: NativeInputRegistration;
};
const globals = globalThis as Record<PropertyKey, unknown>;
const existing = globals[KEY];
const keeper = (existing ?? {
  version: 1,
  nextId: 0,
  bytes: 0,
  records: new Map(),
}) as Keeper;
if (existing === undefined) globals[KEY] = keeper;

function available(): Keeper {
  if (
    keeper.version !== 1 ||
    !(keeper.records instanceof Map) ||
    !Number.isSafeInteger(keeper.nextId) ||
    keeper.nextId < 0 ||
    !Number.isSafeInteger(keeper.bytes) ||
    keeper.bytes < 0 ||
    keeper.bytes > NOTE_SERVICE_INTENT_LIMITS.bytes ||
    keeper.records.size > NOTE_SERVICE_INTENT_LIMITS.records
  )
    throw new NoteServiceIntentError("registry-unavailable");
  return keeper;
}
function snapshot(state: Keeper, rows = [...state.records.values()]): NativeInputRead {
  const pending = rows.some((row) => row.pending);
  return {
    snapshot: {
      version: 1,
      qualified: false,
      rosterComplete: false,
      origin: "local-native",
      surface: "service-intents",
      coverage: "unknown",
      observation: "observed",
      retainedBytes: state.bytes,
      records: rows.map((row) => row.data),
    },
    ...(pending ? { busy: "notes-service-intents-pending" } : {}),
    missingCoverage: [
      "notes-service-native-durability",
      ...(rows.some((row) => row.data.status === "unverified")
        ? ["notes-service-outcome-unverified"]
        : []),
    ],
  };
}
function notify(state: Keeper): boolean {
  try {
    state.registration!.changed();
    return true;
  } catch (error) {
    // Observation loss never refuses a save; the next change retries the notification.
    console.warn("[notes] service intent observation could not be notified", error);
    return false;
  }
}
keeper.read = () => snapshot(available());
// Keep original unknown records across HMR. Only replace the data registration
// when the actual facade implementation changed; that conservatively fences an
// old cut. This producer never issues a service or Native execution permit.
try {
  if (!keeper.registration || keeper.register !== registerNoteInput) {
    keeper.registration?.unregister();
    keeper.register = registerNoteInput;
    keeper.registration = registerNoteInput(() => keeper.read(), {
      canClose: () => true,
      close: () => {},
    });
  } else notify(keeper);
} catch (error) {
  console.warn("[notes] service intent observation is unavailable", error);
}

function diagnostic(error: unknown): string {
  let text = "Native request outcome could not be verified";
  try {
    if (typeof error === "string") text = error;
    else if (error && typeof error === "object") {
      const property = Object.getOwnPropertyDescriptor(error, "message");
      if (property && "value" in property && typeof property.value === "string")
        text = property.value;
    }
  } catch {
    /* Never invoke an error getter or replace the original outcome. */
  }
  let result = "",
    bytes = 0;
  for (const input of text) {
    const code = input.codePointAt(0)!;
    const character = code >= 0xd800 && code <= 0xdfff ? "\ufffd" : input;
    const count = encoder.encode(character).byteLength;
    if (bytes + count > NOTE_SERVICE_INTENT_LIMITS.errorBytes) break;
    result += character;
    bytes += count;
  }
  return result;
}
declare const intentBrand: unique symbol;
export type NoteServiceIntent = {
  readonly [intentBrand]: true;
  execute<T>(
    native: () => Promise<T>,
    bookkeeping?: (result: T) => void | Promise<void>,
  ): Promise<T>;
};

/** Drops the oldest unverified record; pending ones own a live Native call and stay. */
function evictOldestUnverified(state: Keeper): boolean {
  for (const [id, entry] of state.records) {
    if (entry.pending) continue;
    state.records.delete(id);
    state.bytes -= entry.weight;
    return true;
  }
  return false;
}

/** Best-effort stand-in when conservation cannot admit a call: run it unrecorded. */
function passthrough(reason: unknown): NoteServiceIntent {
  console.warn("[notes] service intent conservation unavailable; running unrecorded", reason);
  let executed = false;
  return Object.freeze({
    async execute<T>(
      native: () => Promise<T>,
      bookkeeping?: (result: T) => void | Promise<void>,
    ): Promise<T> {
      if (executed) throw new NoteServiceIntentError("already-executed");
      executed = true;
      const value = await native();
      try {
        if (bookkeeping) await bookkeeping(value);
      } catch (error) {
        // Native success remains success even if local bookkeeping failed.
        console.warn("[notes] result bookkeeping failed", error);
      }
      return value;
    },
  }) as NoteServiceIntent;
}

/**
 * Conserve one exact original call before its effect. No replay/clear API.
 * Admission is best-effort: when it cannot be granted the call still runs.
 */
export function beginNoteServiceIntent(
  command: NoteServiceCommand,
  exactArgs: Record<string, unknown>,
  original: NoteInputWork,
): NoteServiceIntent {
  try {
    return admitNoteServiceIntent(command, exactArgs, original);
  } catch (error) {
    return passthrough(error);
  }
}

function admitNoteServiceIntent(
  command: NoteServiceCommand,
  exactArgs: Record<string, unknown>,
  original: NoteInputWork,
): NoteServiceIntent {
  const owner = noteWorkOwner(original);
  if (!owner) throw new NoteServiceIntentError("work-unavailable");
  // The actual private owner validates the original active ticket. An accepted
  // child then owns the true Promise even if the original waiter is dropped.
  const work = owner.operation("note-service-intent", original);
  if (!work) throw new NoteServiceIntentError("work-unavailable");
  let row!: RecordEntry;
  let state!: Keeper;
  try {
    state = available();
    if (!state.registration) throw new NoteServiceIntentError("registry-unavailable");
    if (!commands.has(command) || !isNativeCaptureObject(exactArgs))
      throw new NoteServiceIntentError("invalid-request");
    if (state.nextId >= Number.MAX_SAFE_INTEGER) throw new NoteServiceIntentError("capacity");
    let args: Record<string, unknown>, requestBytes: number;
    try {
      args = copyNativeCaptureData(exactArgs);
      const encoded = createNativeCaptureSnapshotEncoder()({ command, args });
      requestBytes = encoder.encode(stringifyNativeCaptureJson(encoded)).byteLength;
    } catch {
      throw new NoteServiceIntentError("invalid-request");
    }
    const weight = requestBytes + OVERHEAD;
    row = {
      pending: true,
      weight,
      data: Object.freeze({
        id: state.nextId + 1,
        callId: crypto.randomUUID(),
        command,
        args,
        status: "pending",
        phase: "native-pending",
        error: null,
      }),
    };
    // Share the same bounded JSON/depth/node codec as the eventual Notes raw
    // producer. Evict the oldest unverified originals until this one fits; only
    // when nothing evictable remains is admission refused (the call still runs).
    const fits = () => {
      if (
        state.records.size >= NOTE_SERVICE_INTENT_LIMITS.records ||
        weight > NOTE_SERVICE_INTENT_LIMITS.bytes - state.bytes
      )
        return false;
      try {
        const rows = [...state.records.values(), row];
        const aggregate = createNativeCaptureSnapshotEncoder()(snapshot(state, rows).snapshot);
        const bytes = encoder.encode(stringifyNativeCaptureJson(aggregate)).byteLength;
        // Generated undefined-path metadata shares the aggregate budget too.
        // Reserve the bounded future diagnostic before invoking Native.
        return bytes <= NOTE_SERVICE_INTENT_LIMITS.bytes - rows.length * OVERHEAD;
      } catch {
        return false;
      }
    };
    while (!fits()) if (!evictOldestUnverified(state)) throw new NoteServiceIntentError("capacity");
    work.apply(() => {
      state.records.set(row.data.id, row);
      state.bytes += weight;
      state.nextId++;
      notify(state);
    });
  } catch (error) {
    if (row && state?.records.get(row.data.id) === row) {
      state.records.delete(row.data.id);
      state.bytes -= row.weight;
    }
    try {
      work();
    } catch (finishError) {
      console.warn("[notes] service intent work could not be finished", finishError);
    }
    throw error;
  }
  let executed = false;
  const mark = (
    phase: "native-outcome-unverified" | "result-application-unverified",
    error: unknown,
  ) => {
    row.pending = false;
    row.data = Object.freeze({
      ...row.data,
      status: "unverified",
      phase,
      error: diagnostic(error),
    });
    notify(state);
  };
  // Native definitely rejected: the caller owns the failure, so nothing is conserved.
  const drop = () => {
    const update = () => {
      row.pending = false;
      if (state.records.get(row.data.id) === row) {
        state.records.delete(row.data.id);
        state.bytes -= row.weight;
      }
      notify(state);
    };
    try {
      work.apply(update);
    } catch {
      update();
    }
  };
  // Only an error Native itself returned (a string or plain object from the command) proves the
  // effect did not happen. A thrown Error (transport, closure, unknown) leaves the outcome
  // unverified, so the original stays conserved instead of being retried blindly.
  const rejectedByNative = (error: unknown) =>
    typeof error === "string" ||
    (typeof error === "object" && error !== null && !(error instanceof Error));
  const settleRejected = (error: unknown) => {
    if (rejectedByNative(error)) {
      drop();
      return;
    }
    try {
      work.apply(() => mark("native-outcome-unverified", error));
    } catch {
      mark("native-outcome-unverified", error);
    }
  };
  // Native succeeded but local application is unverified: keep it evictable.
  const retain = (error: unknown) => {
    try {
      work.apply(() => mark("result-application-unverified", error));
    } catch {
      mark("result-application-unverified", error);
    }
  };
  const finish = () => {
    try {
      work();
    } catch (error) {
      console.warn("[notes] service intent work could not be finished", error);
      notify(state);
    }
  };
  return Object.freeze({
    execute<T>(
      native: () => Promise<T>,
      bookkeeping?: (result: T) => void | Promise<void>,
    ): Promise<T> {
      if (executed) return Promise.reject(new NoteServiceIntentError("already-executed"));
      executed = true;
      if (noteWorkOwner(work) !== owner) {
        // Ownership moved before Native ran: the original call must not run for
        // someone else. Nothing was sent, so releasing the record loses nothing.
        drop();
        finish();
        const rejected = Promise.reject<T>(new NoteServiceIntentError("work-unavailable"));
        void rejected.catch(() => {});
        return rejected;
      }
      if (state.records.get(row.data.id) !== row) {
        // Only the record was lost: same owner, so run unrecorded.
        drop();
        finish();
        return passthrough(new NoteServiceIntentError("registry-unavailable")).execute(
          native,
          bookkeeping,
        );
      }
      let actual: Promise<T>;
      try {
        // Call immediately, before execute returns. No deferred microtask can
        // turn a formerly open invocation into a fresh closed-window request.
        actual = work.apply(native);
      } catch (error) {
        settleRejected(error);
        finish();
        const rejected = Promise.reject<T>(error);
        void rejected.catch(() => {});
        return rejected;
      }
      const result = (async () => {
        let value: T;
        try {
          value = await actual;
        } catch (error) {
          settleRejected(error);
          throw error;
        }
        try {
          work.apply(() => {
            row.data = Object.freeze({
              ...row.data,
              phase: "result-application-pending",
            });
            notify(state);
          });
          // Only the synchronous callback runs in this scope. An await does not
          // transfer ambient execution authority to subsequent callbacks.
          if (bookkeeping) await work.apply(() => bookkeeping(value));
          work.apply(() => {
            available();
            if (state.records.get(row.data.id) !== row)
              throw new NoteServiceIntentError("registry-unavailable");
            notify(state);
            // Complete the actual child before retiring its request. A failure
            // here keeps the original charged row rather than losing evidence.
            work();
            state.records.delete(row.data.id);
            state.bytes -= row.weight;
          });
        } catch (error) {
          retain(error);
        }
        // Native success remains Native success, even if local application or
        // capture bookkeeping could not be verified. Never retry the effect.
        return value;
      })().finally(finish);
      // Observation loss does not cancel the original work or orphan rejection.
      void result.catch(() => {});
      return result;
    },
  }) as NoteServiceIntent;
}
