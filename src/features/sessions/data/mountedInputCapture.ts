import {
  beginEditorInputClosure,
  captureEditorInputs,
} from "../../files/data/mountedEditorClosure";
import { beginParentInputClosure, captureParentInputs } from "./parentInputClosure";
import type { NativeProducerInputs, NativeProducerLease } from "./nativeProducerCapture";

export type NativeProducerInputLease = NativeProducerInputs & {
  missingCoverage: readonly string[];
  current(): boolean;
  release(): void;
};
export type NativeProducerInputClosureOptions = {
  owner: object;
  timeoutMs: number;
  signal?: AbortSignal;
};
export type NativeProducerInputClosure = {
  capture(): Promise<NativeProducerInputLease>;
  current(): boolean;
  release(): void;
};

/** Acquire both actual registries; release late captures after a rejected peer. */
async function captureBoth(
  captureParent: () => Promise<NativeProducerLease>,
  captureEditor: () => Promise<NativeProducerLease>,
  missing: readonly string[],
  gateCurrent: () => boolean = () => true,
): Promise<NativeProducerInputLease> {
  const acquired: NativeProducerLease[] = [];
  let failed = false;
  const acquire = async (capture: () => Promise<NativeProducerLease>) => {
    const lease = await capture();
    if (failed) {
      lease.release();
      throw new Error("Producer capture already retired");
    }
    acquired.push(lease);
    return lease;
  };
  let leases: [NativeProducerLease, NativeProducerLease];
  try {
    leases = await Promise.all([acquire(captureParent), acquire(captureEditor)]);
  } catch (error) {
    failed = true;
    for (const lease of acquired.splice(0)) lease.release();
    throw error;
  }
  const [parent, editor] = leases;
  const missingCoverage = Object.freeze(
    [...new Set([...missing, ...parent.missingCoverage, ...editor.missingCoverage])].sort(),
  );
  let released = false;
  const current = () => !released && gateCurrent() && parent.current() && editor.current();
  const release = () => {
    if (released) return;
    released = true;
    for (const lease of acquired.splice(0)) lease.release();
  };
  if (!current()) {
    release();
    throw new Error("Producer capture changed during acquisition");
  }
  return { parent, editor, missingCoverage, current, release };
}

/** Passive compatibility/data capture; never closes admission. */
export function captureNativeProducerInputs(sessionId: string): Promise<NativeProducerInputLease> {
  return captureBoth(
    () => captureParentInputs(sessionId),
    () => captureEditorInputs(sessionId),
    ["parent-admission-closure", "editor-admission-closure"],
  );
}

/** Close actual registered producers before any drain; Native owns final release timing. */
export function beginNativeProducerInputClosure(
  sessionId: string,
  options: NativeProducerInputClosureOptions,
): NativeProducerInputClosure {
  const parent = beginParentInputClosure(sessionId, options);
  let editor: ReturnType<typeof beginEditorInputClosure>;
  try {
    editor = beginEditorInputClosure(sessionId, options);
  } catch (error) {
    parent.release();
    throw error;
  }
  let released = false;
  let captured: NativeProducerInputLease | undefined;
  let task: Promise<NativeProducerInputLease> | undefined;
  const current = () => !released && parent.current() && editor.current();
  return {
    current,
    capture() {
      if (released) return Promise.reject(new Error("Producer admission was released"));
      return (task ??= captureBoth(
        () => parent.capture(),
        () => editor.capture(),
        [],
        current,
      ).then((lease) => {
        if (released) {
          lease.release();
          throw new Error("Producer admission retired during capture");
        }
        captured = lease;
        return lease;
      }));
    },
    release() {
      if (released) return;
      released = true;
      captured?.release();
      try {
        editor.release();
      } finally {
        parent.release();
      }
    },
  };
}
