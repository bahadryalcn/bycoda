import type { SocialAccount } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { socialQueryScope } from "../../model/socialQuery";

export function snapchatAccountKey(client: SocialClient, account: SocialAccount) {
  return JSON.stringify([
    socialQueryScope(client)[1],
    account.id,
    account.platformId,
    account.accountType,
    account.connection,
    account.executorId,
  ]);
}
