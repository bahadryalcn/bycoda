import {
  beginEditorInputClosure,
  captureEditorInputs,
} from "../../files/data/mountedEditorClosure";
import { beginParentInputClosure, captureParentInputs } from "./parentInputClosure";
import { beginNotesInputClosure, captureNotesInputs } from "../../notes/notesInputClosure";
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

/** Acquire every actual family; release late captures after a rejected peer. */
async function captureAll(
  captureParent: () => Promise<NativeProducerLease>,
  captureEditor: () => Promise<NativeProducerLease>,
  captureNotes: () => Promise<NativeProducerLease>,
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
  const releaseAcquired = () => {
    let failed = false;
    let failure: unknown;
    for (const lease of acquired.splice(0)) {
      try {
        lease.release();
      } catch (error) {
        if (!failed) failure = error;
        failed = true;
      }
    }
    if (failed) throw failure;
  };
  let leases: [NativeProducerLease, NativeProducerLease, NativeProducerLease];
  try {
    leases = await Promise.all([
      acquire(captureParent),
      acquire(captureEditor),
      acquire(captureNotes),
    ]);
  } catch (error) {
    failed = true;
    try {
      releaseAcquired();
    } catch {
      // Preserve the original capture failure after attempting every release.
    }
    throw error;
  }
  const [parent, editor, notes] = leases;
  const missingCoverage = Object.freeze(
    [
      ...new Set([
        ...missing,
        ...parent.missingCoverage,
        ...editor.missingCoverage,
        ...notes.missingCoverage,
      ]),
    ].sort(),
  );
  let released = false;
  const current = () =>
    !released && gateCurrent() && parent.current() && editor.current() && notes.current();
  const release = () => {
    if (released) return;
    released = true;
    releaseAcquired();
  };
  if (!current()) {
    release();
    throw new Error("Producer capture changed during acquisition");
  }
  return { parent, editor, notes, missingCoverage, current, release };
}

/** Passive compatibility/data capture; never closes admission. */
export function captureNativeProducerInputs(sessionId: string): Promise<NativeProducerInputLease> {
  return captureAll(
    () => captureParentInputs(sessionId),
    () => captureEditorInputs(sessionId),
    () => captureNotesInputs(sessionId),
    ["parent-admission-closure", "editor-admission-closure", "notes-admission-closure"],
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
  let notes: ReturnType<typeof beginNotesInputClosure>;
  try {
    notes = beginNotesInputClosure(sessionId, options);
  } catch (error) {
    try {
      editor.release();
    } finally {
      parent.release();
    }
    throw error;
  }
  let released = false;
  let captured: NativeProducerInputLease | undefined;
  let task: Promise<NativeProducerInputLease> | undefined;
  const current = () => !released && parent.current() && editor.current() && notes.current();
  return {
    current,
    capture() {
      if (released) return Promise.reject(new Error("Producer admission was released"));
      return (task ??= captureAll(
        () => parent.capture(),
        () => editor.capture(),
        () => notes.capture(),
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
      try {
        captured?.release();
      } finally {
        try {
          notes.release();
        } finally {
          try {
            editor.release();
          } finally {
            parent.release();
          }
        }
      }
    },
  };
}
