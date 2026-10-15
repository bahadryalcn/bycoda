import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
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
export function readHiddenScopes(provider: Provider, instance: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key(provider, instance)) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch (error) {
    console.warn("Reading hidden inbox scopes failed", error);
    return [];
  }
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
  const [scopes, setScopes] = useState<CodeHostScopes | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
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
    let current = true;
    setScopes(null);
    setHidden([]);
    setError(null);
    if (provider)
      void invoke<CodeHostScopes>(
        provider === "gitlab" ? "gitlab_list_projects" : "azure_devops_list_projects",
      )
        .then((next) => {
          if (current) {
            setScopes(next);
            setHidden(readHiddenScopes(provider, next.instance));
          }
        })
        .catch((reason) => {
          if (current) setError(reason instanceof Error ? reason.message : String(reason));
        });
    return () => {
      current = false;
    };
  }, [provider, revision, tick]);
  useEffect(() => {
    if (!provider || !scopes) return;
    const sync = () => setHidden(readHiddenScopes(provider, scopes.instance));
    window.addEventListener("storage", sync);
    window.addEventListener("bycoda:inbox-scopes-change", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("bycoda:inbox-scopes-change", sync);
    };
  }, [provider, scopes]);
  const save = (ids: string[]) => {
    if (!provider || !scopes) return;
    try {
      saveHiddenScopes(provider, scopes.instance, ids);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  return { provider, scopes, hidden, error, save };
}
