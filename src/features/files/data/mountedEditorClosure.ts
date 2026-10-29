import {
  createNativeInputClosureRegistry,
  type NativeInputClosure,
  type NativeInputLease,
} from "../../../shared/lib/native-input-closure-registry";
import type {
  NativeInputRead,
  NativeInputRegistration,
  NativeInputWork,
} from "../../../shared/lib/native-input-observer";

export type MountedEditorRead = NativeInputRead;
export type MountedEditorInputLease = NativeInputLease<"file-editor">;
export type MountedEditorRegistration = NativeInputRegistration;
export type EditorWorkTicket = NativeInputWork;
export type EditorInputClosure = NativeInputClosure<"file-editor">;

export class MountedEditorClosureError extends Error {
  constructor(
    readonly code: "busy" | "capacity" | "invalid-snapshot" | "invalid-scope",
    message: string = code,
  ) {
    super(message);
    this.name = "MountedEditorClosureError";
  }
}

const options = {
  kind: "file-editor" as const,
  coveragePrefix: "editor",
  subject: "Editor",
  noun: "editor",
  Error: MountedEditorClosureError,
};
function expose(core: ReturnType<typeof createNativeInputClosureRegistry<"file-editor">>) {
  return {
    register: core.register,
    captureEditorInputs: core.captureInputs,
    beginEditorInputClosure: core.beginInputClosure.bind(core),
  };
}
export function createMountedEditorClosure() {
  return expose(createNativeInputClosureRegistry(options));
}
const mounted = expose(
  createNativeInputClosureRegistry({
    ...options,
    globalKey: "bycoda.mounted-file-editor-closure.v1",
  }),
);
export const registerMountedEditor = mounted.register;
export const captureEditorInputs = mounted.captureEditorInputs;
export const beginEditorInputClosure = mounted.beginEditorInputClosure;
