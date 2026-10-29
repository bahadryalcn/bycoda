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
  observationUnavailable: boolean;
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
  observationUnavailable: false,
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
function snapshot(
  state: Keeper,
  rows = [...state.records.values()],
): NativeInputRead {
  const pending = rows.some((row) => row.pending);
  return {
    snapshot: {
      version: 1,
      qualified: false,
      rosterComplete: false,
      origin: "local-native",
      surface: "service-intents",
      coverage: "unknown",
      observation: state.observationUnavailable ? "unavailable" : "observed",
      retainedBytes: state.bytes,
      records: rows.map((row) => row.data),
    },
    ...(pending ? { busy: "notes-service-intents-pending" } : {}),
    missingCoverage: [
      "notes-service-native-durability",
      ...(rows.some((row) => row.data.status === "unverified")
        ? ["notes-service-outcome-unverified"]
        : []),
      ...(state.observationUnavailable
        ? ["notes-service-intent-observation-unavailable"]
        : []),
    ],
  };
}
function notify(state: Keeper): boolean {
  try {
    state.registration!.changed();
    return true;
  } catch {
    state.observationUnavailable = true;
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
} catch {
  keeper.observationUnavailable = true;
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

/** Conserve one exact original call before its effect. No replay/clear API. */
export function beginNoteServiceIntent(
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
    if (state.observationUnavailable || !state.registration)
      throw new NoteServiceIntentError("registry-unavailable");
    if (!commands.has(command) || !isNativeCaptureObject(exactArgs))
      throw new NoteServiceIntentError("invalid-request");
    if (
      state.nextId >= Number.MAX_SAFE_INTEGER ||
      state.records.size >= NOTE_SERVICE_INTENT_LIMITS.records
    )
      throw new NoteServiceIntentError("capacity");
    let args: Record<string, unknown>, requestBytes: number;
    try {
      args = copyNativeCaptureData(exactArgs);
      const encoded = createNativeCaptureSnapshotEncoder()({ command, args });
      requestBytes = encoder.encode(
        stringifyNativeCaptureJson(encoded),
      ).byteLength;
    } catch {
      throw new NoteServiceIntentError("invalid-request");
    }
    const weight = requestBytes + OVERHEAD;
    if (weight > NOTE_SERVICE_INTENT_LIMITS.bytes - state.bytes)
      throw new NoteServiceIntentError("capacity");
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
    // producer. A request too large for its own aggregate is refused pre-effect.
    try {
      const rows = [...state.records.values(), row];
      const aggregate = createNativeCaptureSnapshotEncoder()(
        snapshot(state, rows).snapshot,
      );
      const bytes = encoder.encode(
        stringifyNativeCaptureJson(aggregate),
      ).byteLength;
      // Generated undefined-path metadata shares the aggregate budget too.
      // Reserve the bounded future diagnostic before invoking Native.
      if (bytes > NOTE_SERVICE_INTENT_LIMITS.bytes - rows.length * OVERHEAD)
        throw new NoteServiceIntentError("capacity");
    } catch {
      throw new NoteServiceIntentError("capacity");
    }
    work.apply(() => {
      state.records.set(row.data.id, row);
      state.bytes += weight;
      state.nextId++;
      if (!notify(state))
        throw new NoteServiceIntentError("registry-unavailable");
    });
  } catch (error) {
    if (row && state?.records.get(row.data.id) === row) {
      row.pending = false;
      row.data = Object.freeze({
        ...row.data,
        status: "unverified",
        phase: "native-outcome-unverified",
        error: diagnostic(error),
      });
    }
    try {
      work();
    } catch {
      if (state) state.observationUnavailable = true;
    }
    throw error;
  }
  let executed = false;
  const retain = (
    phase: "native-outcome-unverified" | "result-application-unverified",
    error: unknown,
  ) => {
    const update = () => {
      row.pending = false;
      row.data = Object.freeze({
        ...row.data,
        status: "unverified",
        phase,
        error: diagnostic(error),
      });
      notify(state);
    };
    try {
      work.apply(update);
    } catch {
      state.observationUnavailable = true;
      update();
    }
  };
  const finish = () => {
    try {
      work();
    } catch {
      state.observationUnavailable = true;
      notify(state);
    }
  };
  return Object.freeze({
    execute<T>(
      native: () => Promise<T>,
      bookkeeping?: (result: T) => void | Promise<void>,
    ): Promise<T> {
      if (executed)
        return Promise.reject(new NoteServiceIntentError("already-executed"));
      executed = true;
      let actual: Promise<T>;
      try {
        if (
          noteWorkOwner(work) !== owner ||
          state.records.get(row.data.id) !== row
        )
          throw new NoteServiceIntentError("work-unavailable");
        // Call immediately, before execute returns. No deferred microtask can
        // turn a formerly open invocation into a fresh closed-window request.
        actual = work.apply(native);
      } catch (error) {
        retain("native-outcome-unverified", error);
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
          retain("native-outcome-unverified", error);
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
            if (
              state.observationUnavailable ||
              state.records.get(row.data.id) !== row ||
              !notify(state)
            )
              throw new NoteServiceIntentError("registry-unavailable");
            // Complete the actual child before retiring its request. A failure
            // here keeps the original charged row rather than losing evidence.
            work();
            state.records.delete(row.data.id);
            state.bytes -= row.weight;
          });
        } catch (error) {
          retain("result-application-unverified", error);
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
