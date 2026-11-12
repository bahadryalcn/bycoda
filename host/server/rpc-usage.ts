import { join } from "node:path";
import { costParams } from "../usage/cost-report";
import { readUsageCost } from "../usage/cost-read";
import { readUsageLimits } from "../usage/limits-report";
import {
  applyProviderAccountStyles,
  readProviderAccountStyles,
} from "../providers/provider-account-styles";
import { hostProviderAccounts } from "../providers/provider-accounts";
import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
import { hostUsageLimitsDeps, providerAccountConfigDir as accountDir } from "./usage-limits-deps";

/** Host-wide provider quota and cost reads for the phone; read-only, no provider session is started. */
export async function handleUsageRpc(
  dependencies: Pick<ServerBindings, "engine">,
  request: OwnerRpcRequest,
): Promise<void> {
  const environmentId = dependencies.engine.store.environmentId;
  switch (request.input.method) {
    case "usage.limits.read":
      const limits = hostUsageLimitsDeps(environmentId);
      request.result = await readUsageLimits({
        ...limits,
        accounts: async () =>
          applyProviderAccountStyles(
            await limits.accounts(),
            await readProviderAccountStyles(dependencies.engine.store),
          ),
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
