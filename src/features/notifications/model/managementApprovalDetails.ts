/** Structured preview native attaches to an application operation approval; the text message stays the record. */
export type ManagementApprovalDetails = {
  action: string;
  project: { kind: "path" | "id"; value: string } | { kind: "application" };
  input: Record<string, unknown>;
  /** What approving does beyond the listed input, such as publishing commits. */
  notice?: string;
};

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function project(value: unknown): ManagementApprovalDetails["project"] | undefined {
  if (!isObject(value)) return undefined;
  if (value.kind === "application") return { kind: "application" };
  if (
    (value.kind === "path" || value.kind === "id") &&
    typeof value.value === "string" &&
    value.value
  )
    return { kind: value.kind, value: value.value };
  return undefined;
}

/**
 * Accepts only the exact shape native sends. Any mismatch drops the preview and the dialog
 * falls back to the plain message, so a malformed preview can never hide what is approved.
 */
export function parseManagementApprovalDetails(
  value: unknown,
): ManagementApprovalDetails | undefined {
  if (!isObject(value) || value.kind !== "management") return undefined;
  const scope = project(value.project);
  if (typeof value.action !== "string" || !value.action || !scope || !isObject(value.input))
    return undefined;
  if (value.notice !== undefined && (typeof value.notice !== "string" || !value.notice))
    return undefined;
  return {
    action: value.action,
    project: scope,
    input: value.input,
    ...(value.notice ? { notice: value.notice } : {}),
  };
}

/** Idempotency keys and revision guards protect the operation but say nothing to the owner. */
const GUARD = /^(requestId|operationId|expected[A-Z].*)$/;

export type ManagementField = { key: string; value: string; multiline: boolean };

/**
 * The owner-facing fields of an operation input in their original order, guards left out. A
 * nested object or list is shown as indented JSON so no reviewed value is summarised away.
 */
export function managementFields(input: Record<string, unknown>): ManagementField[] {
  return Object.entries(input)
    .filter(([key, value]) => !GUARD.test(key) && value !== undefined && value !== null)
    .map(([key, value]) => {
      const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
      return { key, value: text, multiline: text.includes("\n") || text.length > 120 };
    });
}

/** First line of a commit message and the rest after the blank separator line. */
export function commitMessageParts(message: string): { subject: string; body: string } {
  const [subject = "", ...rest] = message.split("\n");
  return { subject, body: rest.join("\n").trim() };
}
