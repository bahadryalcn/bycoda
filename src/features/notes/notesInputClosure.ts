import {
  createNativeInputClosureRegistry,
  type NativeInputClosure,
  type NativeInputErrorCode,
  type NativeInputLease,
} from "../../shared/lib/native-input-closure-registry";
import type {
  NativeInputRead,
  NativeInputRegistration,
  NativeInputWork,
} from "../../shared/lib/native-input-observer";

export type NotesInputRead = NativeInputRead;
export type NotesInputRegistration = NativeInputRegistration;
export type NotesInputWork = NativeInputWork;
export type NotesInputLease = NativeInputLease<"note-editor">;
export type NotesInputClosure = NativeInputClosure<"note-editor">;

export class NotesInputClosureError extends Error {
  constructor(
    readonly code: NativeInputErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = "NotesInputClosureError";
  }
}

const options = {
  kind: "note-editor" as const,
  coveragePrefix: "notes",
  subject: "Notes",
  noun: "notes",
  Error: NotesInputClosureError,
};
function expose(core: ReturnType<typeof createNativeInputClosureRegistry<"note-editor">>) {
  return {
    register: core.register,
    registerNoteInput: core.register,
    captureNotesInputs: core.captureInputs,
    beginNotesInputClosure: core.beginInputClosure.bind(core),
  };
}

export function createNotesInputClosure() {
  return expose(createNativeInputClosureRegistry(options));
}
const mounted = expose(
  createNativeInputClosureRegistry({
    ...options,
    globalKey: "bycoda.mounted-notes-input-closure.v1",
  }),
);
export const registerNoteInput = mounted.registerNoteInput;
export const captureNotesInputs = mounted.captureNotesInputs;
export const beginNotesInputClosure = mounted.beginNotesInputClosure;
