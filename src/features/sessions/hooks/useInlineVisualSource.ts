import { invoke } from "@tauri-apps/api/core";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { remoteRequest } from "../../connections/public/connections";
import {
  inlineVisualSource,
  inlineVisualValue,
  type InlineVisual,
  type InlineVisualSource,
} from "../model/inlineVisual";

export type InlineVisualHostRoute = { machineId: string; environmentId: string; sessionId: string };
export const InlineVisualHost = createContext<InlineVisualHostRoute | undefined>(undefined);

// Stored visuals are immutable and the desktop verifies each id against its content, so a
// resolved id never needs refetching. Concurrent mounts of one id share a single native read.
const cache = new Map<string, InlineVisualSource>();
const pending = new Map<string, Promise<InlineVisualSource>>();
const CACHE_LIMIT = 24;

export type InlineVisualSourceState =
  | { state: "loading" }
  | { state: "ready"; source: InlineVisualSource }
  | { state: "error"; retry: () => void };

async function fetchStored(id: string): Promise<InlineVisualSource> {
  const source = inlineVisualSource(JSON.parse(await invoke<string>("inline_visual_read", { id })));
  if (!source) throw new Error("Invalid stored visual");
  return source;
}

function readStored(id: string): Promise<InlineVisualSource> {
  const cached = cache.get(id);
  if (cached) {
    // A hit refreshes recency: Map order is the eviction order.
    cache.delete(id);
    cache.set(id, cached);
    return Promise.resolve(cached);
  }
  const inFlight = pending.get(id);
  if (inFlight) return inFlight;
  // A failed read is settled without being cached, so a retry or remount reads again.
  const read = fetchStored(id)
    .then((source) => {
      cache.set(id, source);
      while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
      return source;
    })
    .finally(() => pending.delete(id));
  pending.set(id, read);
  return read;
}

/** Resolves a legacy embedded snapshot directly and a stored reference through its owner. */
export function useInlineVisualSource(value: InlineVisual): InlineVisualSourceState {
  const visual = inlineVisualValue(value);
  const id = visual?.version === 2 ? visual.id : undefined;
  const { machineId, environmentId, sessionId } = useContext(InlineVisualHost) ?? {};
  const key = id && (machineId ? JSON.stringify([machineId, environmentId, sessionId, id]) : id);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{
    key: string;
    attempt: number;
    source?: InlineVisualSource;
  }>();
  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  // Resolve the immutable source against this transcript's owner and discard stale replies.
  useEffect(() => {
    if (!id || !key) return;
    let live = true;
    const request = machineId
      ? remoteRequest<unknown>(
          machineId,
          "sessions.inlineVisual",
          { sessionId, id },
          attempt > 0,
          attempt > 0,
          environmentId,
        ).then(inlineVisualSource)
      : readStored(id);
    request.then(
      (source) => live && setLoaded({ key, attempt, source }),
      () => live && setLoaded({ key, attempt }),
    );
    return () => {
      live = false;
    };
  }, [id, key, attempt, machineId, environmentId, sessionId]);
  if (!visual) return { state: "error", retry };
  if (visual.version === 1) return { state: "ready", source: visual };
  const current = loaded?.key === key && loaded?.attempt === attempt ? loaded : undefined;
  const cachedSource = machineId ? undefined : cache.get(visual.id);
  const resolved = current ?? (cachedSource ? { source: cachedSource } : undefined);
  if (!resolved) return { state: "loading" };
  // Title and height come from the transcript reference, which the agent set at render time.
  return resolved.source
    ? {
        state: "ready",
        source: {
          ...resolved.source,
          title: visual.title,
          height: visual.height,
        },
      }
    : { state: "error", retry };
}
