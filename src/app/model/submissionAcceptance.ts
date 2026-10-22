import type { ProjectLocationSync } from "../../features/projects/model/projectLocation";
import { ProjectNotFoundError } from "../../features/projects/model/projectLocationError";

/** Resolves when the user turn is accepted, not when the agent finishes. */
export type SubmissionAcceptance = boolean | Promise<boolean>;

export async function submitAfterProjectSync(options: {
  cwd: string;
  sync: Promise<ProjectLocationSync | null>;
  applyLocationChange: (from: string, to: string) => Promise<void>;
  submit: () => SubmissionAcceptance;
  onError: (error: unknown) => void;
  /** Stop or a replacement submission invalidates preparation ownership. */
  isCurrent?: () => boolean;
  /** Recover content once, for both preparation failure and rejected dispatch. */
  onRejected?: () => void;
}): Promise<boolean> {
  let accepted = false;
  try {
    const location = await options.sync;
    if (options.isCurrent?.() === false) return false;
    if (!location) {
      throw new ProjectNotFoundError(options.cwd);
    }
    if (location.moved) {
      await options.applyLocationChange(options.cwd, location.path);
    }
    if (options.isCurrent?.() === false) return false;
    accepted = await options.submit();
    return accepted;
  } catch (error: unknown) {
    if (options.isCurrent?.() === false) return false;
    options.onError(error);
    // Preserve permanent failures for callers that decide whether to retry.
    if (error instanceof ProjectNotFoundError) throw error;
    return false;
  } finally {
    if (!accepted) options.onRejected?.();
  }
}
