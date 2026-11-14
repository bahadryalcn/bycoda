import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { readStateFile, writeFileAtomic } from "../../storage/atomic-write";

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const PolicySchema = z.object({
  version: z.literal(1),
  mode: z.enum(["onDemand", "always"]),
  /** Hub names that stay wired into every session even in on-demand mode. */
  direct: z.array(z.string().regex(NAME)).max(200),
});

export type McpLoadingPolicy = z.infer<typeof PolicySchema>;
/** `corrupt` is set when the file exists but is invalid; writes are refused until repaired. */
export type McpLoadingPolicyState = McpLoadingPolicy & { corrupt?: true };

const DEFAULT_POLICY: McpLoadingPolicy = { version: 1, mode: "onDemand", direct: [] };

const policyFile = (dataDir: string) => join(dataDir, "mcp-hub", "loading.json");

const parsePolicy = (text: string): McpLoadingPolicy => {
  const policy = PolicySchema.parse(JSON.parse(text));
  return { ...policy, direct: [...new Set(policy.direct)] };
};

/** Missing means the on-demand default; invalid or unreadable also loads on demand but is flagged. */
export async function readLoadingPolicy(dataDir: string): Promise<McpLoadingPolicyState> {
  try {
    const result = await readStateFile(policyFile(dataDir), parsePolicy, { quarantine: false });
    if (result.status === "ok") return result.value;
    if (result.status === "missing") return { ...DEFAULT_POLICY, direct: [] };
  } catch {
    // Unreadable is treated like corrupt: never widen loading on a read error.
  }
  return { ...DEFAULT_POLICY, direct: [], corrupt: true };
}

/**
 * Persists the policy atomically. Refuses while the stored file is corrupt unless
 * `repair` is set (an explicit owner action), and when `expectedVersion` differs from
 * the stored schema version.
 */
export async function writeLoadingPolicy(
  dataDir: string,
  policy: McpLoadingPolicy,
  expectedVersion?: number,
  options: { repair?: boolean } = {},
): Promise<McpLoadingPolicy> {
  const next = parsePolicy(JSON.stringify(policy));
  const current = await readLoadingPolicy(dataDir);
  if (current.corrupt && !options.repair)
    throw new Error("The MCP loading policy file is corrupt; repair it before saving.");
  if (expectedVersion !== undefined && expectedVersion !== current.version)
    throw new Error("The MCP loading policy changed; reload and try again.");
  await mkdir(join(dataDir, "mcp-hub"), { recursive: true });
  await writeFileAtomic(policyFile(dataDir), JSON.stringify(next, null, 2));
  return next;
}
