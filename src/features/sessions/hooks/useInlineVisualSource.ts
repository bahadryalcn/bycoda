import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import {
  inlineVisualSource,
  inlineVisualValue,
  type InlineVisual,
  type InlineVisualSource,
} from "../model/inlineVisual";

// Stored visuals are immutable, so a resolved id never needs refetching.
const cache = new Map<string, InlineVisualSource>();
const CACHE_LIMIT = 24;

export type InlineVisualSourceState =
  | { state: "loading" }
  | { state: "ready"; source: InlineVisualSource }
  | { state: "error"; retry: () => void };

async function readStored(id: string): Promise<InlineVisualSource> {
  const cached = cache.get(id);
  if (cached) return cached;
  const source = inlineVisualSource(JSON.parse(await invoke<string>("inline_visual_read", { id })));
  if (!source) throw new Error("Invalid stored visual");
  cache.set(id, source);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return source;
}

/** Resolves a legacy embedded snapshot directly and a stored reference through the desktop. */
export function useInlineVisualSource(value: InlineVisual): InlineVisualSourceState {
  const visual = inlineVisualValue(value);
  const id = visual?.version === 2 ? visual.id : undefined;
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{
    id: string;
    source?: InlineVisualSource;
  }>();
  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  useEffect(() => {
    if (!id) return;
    let live = true;
    setLoaded(cache.has(id) ? { id, source: cache.get(id) } : undefined);
    readStored(id).then(
      (source) => live && setLoaded({ id, source }),
      () => live && setLoaded({ id }),
    );
    return () => {
      live = false;
    };
  }, [id, attempt]);
  if (!visual) return { state: "error", retry };
  if (visual.version === 1) return { state: "ready", source: visual };
  if (loaded?.id !== visual.id) return { state: "loading" };
  // Title and height come from the transcript reference, which the agent set at render time.
  return loaded.source
    ? {
        state: "ready",
        source: {
          ...loaded.source,
          title: visual.title,
          height: visual.height,
        },
      }
    : { state: "error", retry };
}
