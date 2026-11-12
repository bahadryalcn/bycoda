import { useEffect, useState } from "react";
import {
  connectedWorkItemProviders,
  parseWorkItemQuery,
  workItemMentionCandidates,
  peekWorkItemMentionCandidates,
  mergeWorkItemMentionCandidates,
  type InboxItem,
  type InboxProvider,
} from "../../inbox/public/workItemMentions";
import { workItemMentionRows } from "../model/workItemMentionRows";

type Source = {
  cwd: string;
  provider?: InboxProvider;
  items: InboxItem[];
  connected: InboxProvider[];
};

/** Lazy reads cannot replace another project's suggestions or break file mentions. */
export function useComposerWorkItemMentions(input: {
  cwd: string;
  active: boolean;
  query: string;
}) {
  const { cwd, active, query } = input;
  const provider = parseWorkItemQuery(query)?.provider;
  const search = parseWorkItemQuery(query)?.rest ?? query;
  const [source, setSource] = useState<Source | null>(null);
  const [loading, setLoading] = useState(false);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Bind cached tracker reads to the open menu's project/provider lifetime; discard replies after cleanup.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    void connectedWorkItemProviders()
      .then(async (connected) => {
        if (cancelled) return;
        setSource((previous) => ({
          cwd,
          provider,
          connected,
          items: mergeWorkItemMentionCandidates(
            peekWorkItemMentionCandidates(cwd, provider),
            previous?.cwd === cwd && previous.provider === provider ? previous.items : [],
          ),
        }));
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setSource({ cwd, provider, connected: [], items: [] });
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [active, cwd, provider]);

  const current = source?.cwd === cwd && source.provider === provider ? source : null;
  const connected = current?.connected;

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Debounce provider search for the current menu/query; cleanup rejects stale replies and cancels unopened searches.
  useEffect(() => {
    if (
      !active ||
      !connected?.length ||
      (!provider && !search.trim()) ||
      (provider && !connected.includes(provider))
    )
      return;
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      void workItemMentionCandidates(cwd, provider, search, connected, controller.signal)
        .then((items) => {
          if (cancelled) return;
          setSource((previous) =>
            previous?.cwd === cwd && previous.provider === provider
              ? { ...previous, items: mergeWorkItemMentionCandidates(previous.items, items) }
              : previous,
          );
        })
        .catch(() => {
          // Cached rows and file mentions remain available while a provider is offline.
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 225);
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [active, cwd, provider, search, connected]);
  return {
    rows: active && current ? workItemMentionRows(current.items, query, current.connected) : [],
    loading: active && (loading || !current),
    scoped: Boolean(provider),
    available: Boolean(current?.connected.length),
  };
}
