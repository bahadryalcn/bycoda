import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { InboxItem } from "./githubTasks";
export type CodeHostScope = { id: string; path: string; name: string };
export type CodeHostScopes = { instance: string; projects: CodeHostScope[] };
type Provider = "gitlab" | "azuredevops";
export function normalizeCodeHostInstance(instance: string): string {
  const value = instance.trim();
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname.replace(/\/$/, "")}${url.search}${url.hash}`;
  } catch {
    return value.replace(/\/$/, "");
  }
}
const key = (provider: Provider, instance: string) =>
  `bycoda.inboxHiddenScopes.v1:${JSON.stringify([provider, normalizeCodeHostInstance(instance)])}`;
function parseHiddenScopes(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch (error) {
    console.warn("Reading hidden inbox scopes failed", error);
    return [];
  }
}
export function readHiddenScopes(provider: Provider, instance: string): string[] {
  try {
    return parseHiddenScopes(localStorage.getItem(key(provider, instance)));
  } catch (error) {
    console.warn("Reading hidden inbox scopes failed", error);
    return [];
  }
}
const NO_HIDDEN: string[] = [];
const hiddenSnapshots = new Map<string, { raw: string | null; ids: string[] }>();
/** Stable-by-content view of the stored list, so an unchanged value never re-renders. */
function hiddenScopesSnapshot(provider: Provider, instance: string): string[] {
  const storageKey = key(provider, instance);
  let raw: string | null;
  try {
    raw = localStorage.getItem(storageKey);
  } catch (error) {
    console.warn("Reading hidden inbox scopes failed", error);
    return hiddenSnapshots.get(storageKey)?.ids ?? NO_HIDDEN;
  }
  const cached = hiddenSnapshots.get(storageKey);
  if (cached && cached.raw === raw) return cached.ids;
  const ids = parseHiddenScopes(raw);
  hiddenSnapshots.set(storageKey, { raw, ids });
  return ids;
}
function subscribeHiddenScopes(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener("bycoda:inbox-scopes-change", notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener("bycoda:inbox-scopes-change", notify);
  };
}
export function saveHiddenScopes(provider: Provider, instance: string, ids: string[]): void {
  localStorage.setItem(key(provider, instance), JSON.stringify([...new Set(ids)]));
  window.dispatchEvent(new Event("bycoda:inbox-scopes-change"));
}
export function filterCodeHostScopes(
  items: InboxItem[],
  provider: Provider | null,
  scopes: CodeHostScopes | null,
  hidden: string[],
): InboxItem[] {
  if (!provider || !scopes || !hidden.length) return items;
  const paths = new Set(
    scopes.projects.filter((p) => hidden.includes(p.id)).map((p) => p.path.toLowerCase()),
  );
  return items.filter(
    (item) =>
      item.provider !== provider ||
      !paths.has(
        (provider === "azuredevops" && item.kind === "pr"
          ? item.repo.split("/")[0]
          : item.repo
        ).toLowerCase(),
      ),
  );
}
export function useCodeHostScopes(source: string, revision: number) {
  const provider: Provider | null = source === "gitlab" || source === "azuredevops" ? source : null;
  // The result belongs to the request that produced it; a new provider, revision
  // or account change reads as "loading" without a reset effect.
  const [result, setResult] = useState<{
    id: string;
    scopes: CodeHostScopes | null;
    error: string | null;
  } | null>(null);
  const [tick, setTick] = useState(0);
  const requestId = `${provider}:${revision}:${tick}`;
  const current = provider && result?.id === requestId ? result : null;
  const scopes = current?.scopes ?? null;
  const error = current?.error ?? null;
  useEffect(() => {
    const changed = () => setTick((v) => v + 1);
    window.addEventListener("bycoda:gitlab-change", changed);
    window.addEventListener("bycoda:azuredevops-change", changed);
    return () => {
      window.removeEventListener("bycoda:gitlab-change", changed);
      window.removeEventListener("bycoda:azuredevops-change", changed);
    };
  }, []);
  useEffect(() => {
    if (!provider) return;
    let live = true;
    const id = `${provider}:${revision}:${tick}`;
    void invoke<CodeHostScopes>(
      provider === "gitlab" ? "gitlab_list_projects" : "azure_devops_list_projects",
    )
      .then((next) => {
        if (live) setResult({ id, scopes: next, error: null });
      })
      .catch((reason) => {
        if (live)
          setResult({
            id,
            scopes: null,
            error: reason instanceof Error ? reason.message : String(reason),
          });
      });
    return () => {
      live = false;
    };
  }, [provider, revision, tick]);
  const getHidden = () =>
    provider && scopes ? hiddenScopesSnapshot(provider, scopes.instance) : NO_HIDDEN;
  const hidden = useSyncExternalStore(subscribeHiddenScopes, getHidden, getHidden);
  const save = (ids: string[]) => {
    if (!provider || !scopes) return;
    const report = (message: string | null) =>
      setResult((previous) =>
        previous && previous.id === requestId ? { ...previous, error: message } : previous,
      );
    try {
      saveHiddenScopes(provider, scopes.instance, ids);
      report(null);
    } catch (reason) {
      report(reason instanceof Error ? reason.message : String(reason));
    }
  };
  return { provider, scopes, hidden, error, save };
}
