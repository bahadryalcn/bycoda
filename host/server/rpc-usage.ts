import { homedir } from "node:os";
import { join } from "node:path";
import { costParams } from "../usage/cost-report";
import { readUsageCost } from "../usage/cost-read";
import { fetchClaudeLimits, fetchCodexLimits } from "../usage/limits-fetch";
import { fetchOpencodeLimits } from "../usage/limits-opencode";
import { readUsageLimits } from "../usage/limits-report";
import { hostProviderAccounts, providerAccountDir } from "../providers/provider-accounts";
import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
import { resolveBinary } from "./support";

/** Host-wide provider quota and cost reads for the phone; read-only, no provider session is started. */
async function accountDir(provider: "claude" | "codex", id: string): Promise<string | null> {
  if (id !== "default") return providerAccountDir(provider, id);
  const env = provider === "claude" ? process.env.CLAUDE_CONFIG_DIR : process.env.CODEX_HOME;
  return env || join(homedir(), provider === "claude" ? ".claude" : ".codex");
}

export async function handleUsageRpc(
  dependencies: Pick<ServerBindings, "engine">,
  request: OwnerRpcRequest,
): Promise<void> {
  const environmentId = dependencies.engine.store.environmentId;
  switch (request.input.method) {
    case "usage.limits.read":
      request.result = await readUsageLimits({
        environmentId,
        accounts: async () => ({
          ...(await hostProviderAccounts()),
          opencode: [{ id: "default", label: "OpenCode Go", color: "#6b7280" }],
        }),
        fetchAccount: async (provider, id) => {
          if (provider === "opencode") return fetchOpencodeLimits();
          if (provider === "codex") return fetchCodexLimits(id, resolveBinary.codex);
          const dir = await accountDir("claude", id);
          return dir
            ? fetchClaudeLimits(id === "default" ? null : dir)
            : {
                status: "unavailable",
                error: "Claude account is not available on this computer",
              };
        },
      });
      break;
    case "usage.cost.read":
      request.result = await readUsageCost(
        {
          environmentId,
          roots: async () => {
            const catalog = await hostProviderAccounts();
            const dirs = async (provider: "claude" | "codex") =>
              (
                await Promise.all(
                  (catalog[provider] ?? []).map((account) => accountDir(provider, account.id)),
                )
              ).filter((dir): dir is string => !!dir);
            return {
              claude: (await dirs("claude")).map((dir) => join(dir, "projects")),
              // Codex moves sessions the user archives out of `sessions`.
              codex: (await dirs("codex")).flatMap((dir) => [
                join(dir, "sessions"),
                join(dir, "archived_sessions"),
              ]),
            };
          },
        },
        costParams(request.params),
      );
      break;
  }
}
