import {
  hostProviderAccounts,
  providerAccountDir,
  type HostProviderAccountCatalog,
} from "../../providers/provider-accounts";
import type { AccountDirs } from "./inventory-sources";

/** Non-default provider profiles on this Host. Sessions launched under a profile set
 * CLAUDE_CONFIG_DIR or CODEX_HOME to it, so its servers are part of the inventory too. */
export async function discoverAccountDirs(): Promise<AccountDirs> {
  const catalog: HostProviderAccountCatalog = await hostProviderAccounts().catch(() => ({}));
  const dirs: AccountDirs = { claude: [], codex: [] };
  for (const provider of ["claude", "codex"] as const) {
    for (const account of catalog[provider] ?? []) {
      if (account.id === "default") continue;
      const dir = await providerAccountDir(provider, account.id).catch(() => null);
      if (dir) dirs[provider].push(dir);
    }
  }
  return dirs;
}
