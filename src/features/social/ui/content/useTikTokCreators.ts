import { useQueries } from "@tanstack/react-query";
import type { SocialClient } from "../../model/socialClient";
import { socialQueryScope } from "../../model/socialQuery";
import type { SocialAccount, TikTokCreatorInfo } from "../../model/social";

/** TikTok creator options (privacy choices, interaction limits) for the selected TikTok accounts. */
export function useTikTokCreators(
  client: SocialClient,
  accounts: SocialAccount[],
  active: boolean,
): Partial<Record<string, TikTokCreatorInfo>> {
  const tiktok = accounts.filter((account) => account.platform === "tiktok");
  const results = useQueries({
    queries: tiktok.map((account) => ({
      queryKey: [...socialQueryScope(client), "content", "tiktok", account.id],
      queryFn: () => client.tiktokCreator(account.id),
      enabled: active,
      staleTime: 60_000,
    })),
  });
  const creators: Partial<Record<string, TikTokCreatorInfo>> = {};
  tiktok.forEach((account, index) => {
    const data = results[index]?.data;
    if (data) creators[account.id] = data;
  });
  return creators;
}
