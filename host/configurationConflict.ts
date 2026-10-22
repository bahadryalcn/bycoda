import { isDeepStrictEqual } from "node:util";

/** Compare only editable fields; scheduler/runtime metadata is not an edit. */
export function assertExpectedConfiguration<T>(
  raw: unknown,
  previous: unknown,
  parse: (value: unknown) => T,
): void {
  const expected = (raw as { expectedConfiguration?: unknown }).expectedConfiguration;
  if (expected === undefined) return;
  if (!previous || !isDeepStrictEqual(parse(expected), parse(previous))) {
    throw new Error(
      "Configuration changed in another client. Reopen it before saving; your changes have not been saved.",
    );
  }
}
