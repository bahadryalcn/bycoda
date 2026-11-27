import type { LiveEvent, LiveViewer } from "./liveEvents";

const SEEN_SIZE = 600;
const TOP_GIFTERS = 5;
const GIFTERS_MAX = 1000;
const GIFTERS_KEEP = 500;

export interface LiveTotals {
  diamonds: number;
  gifts: number;
  comments: number;
  likes: number;
  follows: number;
  peakViewers: number;
}

/** Running numbers of one live session, folded from normalized events. */
export interface LiveSessionState {
  viewers: number;
  totals: LiveTotals;
  /** Diamonds per viewer for the whole session. */
  gifters: Record<string, { viewer: LiveViewer; diamonds: number }>;
  /** Recent event ids, so a reconnect that replays messages does not double-count. */
  seen: string[];
}

export function emptyLiveSession(): LiveSessionState {
  return {
    viewers: 0,
    totals: { diamonds: 0, gifts: 0, comments: 0, likes: 0, follows: 0, peakViewers: 0 },
    gifters: {},
    seen: [],
  };
}

/** Keeps the persisted gifter map bounded on long streams by dropping the smallest gifters. */
function capGifters(gifters: LiveSessionState["gifters"]): LiveSessionState["gifters"] {
  const entries = Object.entries(gifters);
  if (entries.length <= GIFTERS_MAX) return gifters;
  entries.sort((a, b) => b[1].diamonds - a[1].diamonds);
  return Object.fromEntries(entries.slice(0, GIFTERS_KEEP));
}

/** Returns the same state object when the event was already counted. */
export function reduceLiveSession(state: LiveSessionState, event: LiveEvent): LiveSessionState {
  if (state.seen.includes(event.id)) return state;
  const next: LiveSessionState = { ...state, seen: [...state.seen, event.id].slice(-SEEN_SIZE) };
  switch (event.kind) {
    case "comment":
      return { ...next, totals: { ...next.totals, comments: next.totals.comments + 1 } };
    case "like":
      return { ...next, totals: { ...next.totals, likes: next.totals.likes + event.count } };
    case "follow":
      return { ...next, totals: { ...next.totals, follows: next.totals.follows + 1 } };
    case "gift": {
      const total = Math.max(0, event.diamonds) * Math.max(1, event.count);
      const previous = Object.prototype.hasOwnProperty.call(next.gifters, event.viewer.id)
        ? next.gifters[event.viewer.id].diamonds
        : 0;
      return {
        ...next,
        totals: {
          ...next.totals,
          diamonds: next.totals.diamonds + total,
          gifts: next.totals.gifts + event.count,
        },
        gifters: capGifters({
          ...next.gifters,
          [event.viewer.id]: { viewer: event.viewer, diamonds: previous + total },
        }),
      };
    }
    case "viewers":
      return {
        ...next,
        viewers: event.count,
        totals: { ...next.totals, peakViewers: Math.max(next.totals.peakViewers, event.count) },
      };
    case "join":
    case "share":
    case "stream-end":
      return next;
  }
}

export interface LiveSessionSnapshot {
  viewers: number;
  totals: LiveTotals;
  topGifters: { id: string; name: string; diamonds: number; avatarUrl?: string }[];
}

export function liveSessionSnapshot(state: LiveSessionState): LiveSessionSnapshot {
  const topGifters = Object.values(state.gifters)
    .sort((a, b) => b.diamonds - a.diamonds)
    .slice(0, TOP_GIFTERS)
    .map(({ viewer, diamonds }) => ({
      id: viewer.id,
      name: viewer.name.trim() || "?",
      avatarUrl: viewer.avatarUrl,
      diamonds,
    }));
  return { viewers: state.viewers, totals: state.totals, topGifters };
}
