import { useSyncExternalStore } from "react";
import type { ProviderAccountProvider } from "./providerAccounts";

const CHANGE_EVENT = "bycoda:usage-display-account-change";
const unsaved = new Map<ProviderAccountProvider, string>();
const keyFor = (provider: ProviderAccountProvider) => `bycoda.usageDisplayAccount.v1.${provider}`;

function load(provider: ProviderAccountProvider): string | null {
  if (unsaved.has(provider)) return unsaved.get(provider)!;
  try {
    return localStorage.getItem(keyFor(provider));
  } catch {
    return null;
  }
}

/** A display preference only; never changes provider defaults or session pins. */
export function saveUsageDisplayAccount(
  provider: ProviderAccountProvider,
  accountId: string,
): void {
  try {
    localStorage.setItem(keyFor(provider), accountId);
    unsaved.delete(provider);
  } catch {
    unsaved.set(provider, accountId);
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useUsageDisplayAccount(provider: ProviderAccountProvider): string | null {
  return useSyncExternalStore(
    subscribe,
    () => load(provider),
    () => null,
  );
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && !event.key.startsWith("bycoda.usageDisplayAccount.v1.")) return;
    unsaved.clear();
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
