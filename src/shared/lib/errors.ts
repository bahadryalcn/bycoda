/** Preserve native and JavaScript error messages for user-facing failures. */
export function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  return error instanceof Error ? error.message : String(error);
}
