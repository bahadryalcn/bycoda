import { homedir } from "node:os";
import { join } from "node:path";
import { fetchClaudeLimits, fetchCodexLimits } from "../usage/limits-fetch";
import { fetchOpencodeLimits } from "../usage/limits-opencode";
import type { LimitsDeps } from "../usage/limits-report";
import { hostProviderAccounts, providerAccountDir } from "../providers/provider-accounts";
import { resolveBinary } from "./support";

export async function providerAccountConfigDir(
  provider: "claude" | "codex",
  id: string,
): Promise<string | null> {
  if (id !== "default") return providerAccountDir(provider, id);
  const env = provider === "claude" ? process.env.CLAUDE_CONFIG_DIR : process.env.CODEX_HOME;
  return env || join(homedir(), provider === "claude" ? ".claude" : ".codex");
}

/** Provider quota dependencies shared by the phone `usage.limits.read` RPC and the Assistant model pool. */
export function hostUsageLimitsDeps(environmentId: string): LimitsDeps {
  return {
    environmentId,
    accounts: async () => ({
      ...(await hostProviderAccounts()),
      opencode: [{ id: "default", label: "OpenCode Go", color: "#6b7280" }],
    }),
    fetchAccount: async (provider, id) => {
      if (provider === "opencode") return fetchOpencodeLimits();
      if (provider === "codex") return fetchCodexLimits(id, resolveBinary.codex);
      const dir = await providerAccountConfigDir("claude", id);
      return dir
        ? fetchClaudeLimits(id === "default" ? null : dir)
        : { status: "unavailable", error: "Claude account is not available on this computer" };
    },
  };
}
