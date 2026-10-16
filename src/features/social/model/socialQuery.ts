import type { SocialClient } from "./socialClient";

// Client instances are retained with their host workspace. Never share account IDs across hosts.
const scopes = new WeakMap<SocialClient, number>();
let nextScope = 0;
export function socialQueryScope(client: SocialClient) {
  let scope = scopes.get(client);
  if (scope === undefined) {
    scope = ++nextScope;
    scopes.set(client, scope);
  }
  return ["social", scope] as const;
}
