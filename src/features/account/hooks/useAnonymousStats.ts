import { useEffect } from "react";
import { startAnonymousStats } from "../model/anonymousStats";
import { startAnonymousUsage } from "../model/anonymousUsage";
import { tauriAccountNative } from "../model/accountNative";

/** The optional daily statistics signal; inert unless the user said yes and the API is set. */
export function useAnonymousStats(): void {
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keeps the opt-in app-open timer mounted with the account platform.
  useEffect(() => startAnonymousStats({ native: tauriAccountNative, review: true }), []);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Owns the token-report timer and consent subscription until platform unmount.
  useEffect(() => startAnonymousUsage(tauriAccountNative, true), []);
}
