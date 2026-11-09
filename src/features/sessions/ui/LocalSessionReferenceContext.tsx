import { createContext, useContext, useMemo, type ReactNode } from "react";
import { buildLocalSessionLink, type LocalSessionReference } from "../model/localSessionReference";

export interface LocalSessionReferenceMetadata {
  title: string;
  project?: string;
  origin?: string;
  status?: string;
  archived?: boolean;
}

export interface LocalSessionReferenceNavigation {
  resolve: (reference: LocalSessionReference) => Promise<LocalSessionReferenceMetadata>;
  open: (reference: LocalSessionReference, options?: { beside?: boolean }) => Promise<void>;
}

const Context = createContext<LocalSessionReferenceNavigation | null>(null);

/** Mount within the authorized workspace. A changed authority replaces the cache. */
export function LocalSessionReferenceProvider({
  value,
  children,
}: {
  value: LocalSessionReferenceNavigation;
  children: ReactNode;
}) {
  const navigation = useMemo(() => {
    // Only retain in-flight metadata, not an authorization result. Reopening details
    // checks current visibility; duplicates opened together share the same read.
    const pending = new Map<string, Promise<LocalSessionReferenceMetadata>>();
    return {
      open: value.open,
      resolve(reference: LocalSessionReference) {
        const key = buildLocalSessionLink({ locator: reference.locator });
        const existing = pending.get(key);
        if (existing) return existing;
        const request = Promise.resolve().then(() => value.resolve(reference));
        pending.set(key, request);
        void request
          .finally(() => {
            if (pending.get(key) === request) pending.delete(key);
          })
          .catch(() => {});
        return request;
      },
    };
  }, [value]);
  return <Context.Provider value={navigation}>{children}</Context.Provider>;
}

export function useLocalSessionReferenceNavigation() {
  return useContext(Context);
}
