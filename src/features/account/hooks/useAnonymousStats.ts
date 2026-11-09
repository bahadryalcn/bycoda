import { useEffect } from "react";
import { startAnonymousStats } from "../model/anonymousStats";
import { tauriAccountNative } from "../model/accountNative";

/** The optional daily statistics signal; inert unless the user said yes and the API is set. */
export function useAnonymousStats(): void {
  useEffect(() => startAnonymousStats({ native: tauriAccountNative }), []);
}
