import { resolveOnPath } from "../mcp/hub/launch";

/** Agent instruction block from the bykit contract (SPEC.md); keep it short, it costs tokens per session. */
export const BYKIT_HINT = [
  "Use `bykit` for file work instead of writing Python/Node/shell scripts:",
  "`bykit find` to search, `bykit read` to read, `bykit edit` (JSON on stdin) for any",
  "multi-place edit or new file, `bykit replace` for repository-wide replacements,",
  "`bykit diff` for git changes, `bykit json` for JSON/locale data, `bykit run -- <cmd>`",
  "for builds and tests (prints only failures). Do not format or fix line endings by hand.",
].join("\n");

const LOOKUP_DEADLINE_MS = 1_500;
const CACHE_MS = 60_000;

type Lookup = (command: string) => Promise<string | undefined>;
let cached: { at: number; found: boolean } | undefined;

/**
 * Whether a `bykit` executable resolves on PATH. The lookup has a deadline (a slow or
 * hung PATH entry counts as absent) and the answer is reused for a minute.
 */
export async function bykitAvailable(
  lookup: Lookup = (command) => resolveOnPath(command),
  now: () => number = Date.now,
): Promise<boolean> {
  if (cached && now() - cached.at < CACHE_MS) return cached.found;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), LOOKUP_DEADLINE_MS);
  });
  const found = await Promise.race([lookup("bykit").catch(() => undefined), deadline]).finally(() =>
    clearTimeout(timer),
  );
  cached = { at: now(), found: !!found };
  return cached.found;
}

/** The instruction block when bykit is installed, otherwise an empty string. */
export async function bykitHint(lookup?: Lookup, now?: () => number): Promise<string> {
  return (await bykitAvailable(lookup, now)) ? BYKIT_HINT : "";
}

export function resetBykitCache() {
  cached = undefined;
}
