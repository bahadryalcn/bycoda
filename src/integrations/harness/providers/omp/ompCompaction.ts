import { inspectHarnessBinary } from "../../core/child";

/** Configuration failures must never fall back from a resumed conversation to a new one. */
export class OmpCompactionError extends Error {}

/** Earlier omp releases persist this RPC toggle into the user's global profile. */
export function supportsOmpSessionCompaction(version: string | undefined): boolean {
  const parts = version?.match(/(?:^|\s|v)(\d+)\.(\d+)\.(\d+)(?![\w.-])/);
  if (!parts) return false;
  const [major, minor, patch] = parts.slice(1).map(Number);
  return major > 18 || (major === 18 && (minor > 2 || (minor === 2 && patch >= 1)));
}

export async function ompSessionCompactionAvailable(): Promise<boolean> {
  try {
    return supportsOmpSessionCompaction((await inspectHarnessBinary("omp")).version);
  } catch {
    return false;
  }
}
