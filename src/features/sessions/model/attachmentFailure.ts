/** Why an attachment selection or capture was refused. Callers branch on `failure`, never on message text. */
export type AttachmentFailure = "selection-too-large" | "image-too-large" | "provider-changed";

/** A typed attachment refusal. `message` is English diagnostic text; user-facing copy is chosen from `failure`. */
export class AttachmentFailureError extends Error {
  readonly failure: AttachmentFailure;

  constructor(failure: AttachmentFailure, message: string) {
    super(message);
    this.name = "AttachmentFailureError";
    this.failure = failure;
  }
}

/** Whether a native selection exceeds the retained-capacity bounds (path count and total path bytes). */
export function selectionExceedsCapacity(paths: readonly string[]): boolean {
  return (
    paths.length > 4096 || paths.reduce((bytes, path) => bytes + path.length * 2, 0) > 1024 * 1024
  );
}
