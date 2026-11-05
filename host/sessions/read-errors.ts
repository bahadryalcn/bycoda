const messages = {
  overloaded: "Conversation reads are busy. Retrying shortly.",
  "source-changed": "Session read owner changed; retry",
  "snapshot-budget": "This conversation exceeds the safe read size limit.",
  unavailable: "Conversation data is temporarily unavailable. Retrying shortly.",
} as const;

export type SessionReadErrorKind = keyof typeof messages;

export function isSessionReadErrorKind(value: unknown): value is SessionReadErrorKind {
  return typeof value === "string" && Object.hasOwn(messages, value);
}

/** Safe query failures; private helper/storage diagnostics remain in the cause. */
export class SessionReadError extends Error {
  constructor(
    readonly kind: SessionReadErrorKind,
    options?: ErrorOptions,
  ) {
    super(messages[kind], options);
    this.name = "SessionReadError";
  }
}
