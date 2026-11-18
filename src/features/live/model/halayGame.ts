import type { LiveEvent, LiveViewer } from "./liveEvents";

/** Visual or audio moments the overlay plays once. */
export type HalayEffect = "confetti" | "drum" | "fireworks" | "money-rain" | "handkerchief";

/** What a gift does. `join` adds the sender, `front` moves them forward, `leader` makes them halaybaşı. */
export type HalayAction = "join" | "front" | "leader" | "tempo" | HalayEffect;

export const HALAY_ACTIONS: readonly HalayAction[] = [
  "join",
  "front",
  "leader",
  "tempo",
  "confetti",
  "drum",
  "fireworks",
  "money-rain",
  "handkerchief",
];

export interface HalayGiftRule {
  /** Matches when the gift's total diamonds (value x count) reach this. */
  minDiamonds: number;
  /** When set, matches this gift name (case-insensitive) regardless of value; checked first. */
  giftName?: string;
  actions: HalayAction[];
}

export interface HalayConfig {
  /** A comment containing one of these words (case-insensitive) joins the circle. */
  joinKeywords: string[];
  joinOnAnyComment: boolean;
  joinOnLike: boolean;
  joinOnFollow: boolean;
  capacity: number;
  /** How long a `leader` gift keeps its sender at the head of the line. */
  leaderHoldSeconds: number;
  /** How long a `front` gift keeps its sender near the head of the line. */
  frontHoldSeconds: number;
  giftRules: HalayGiftRule[];
  /** Handles (without @) that are never shown. */
  blocked: string[];
  /** Show only the first letters of viewer names, for privacy. */
  shortNames: boolean;
}

export const DEFAULT_HALAY_CONFIG: HalayConfig = {
  joinKeywords: ["halay"],
  joinOnAnyComment: false,
  joinOnLike: true,
  joinOnFollow: true,
  capacity: 120,
  leaderHoldSeconds: 90,
  frontHoldSeconds: 60,
  giftRules: [
    { minDiamonds: 1, actions: ["join", "front", "confetti"] },
    { minDiamonds: 5, actions: ["join", "front", "drum", "handkerchief"] },
    { minDiamonds: 30, actions: ["join", "front", "tempo", "fireworks"] },
    { minDiamonds: 99, actions: ["join", "leader", "tempo", "money-rain"] },
    { minDiamonds: 299, actions: ["join", "leader", "tempo", "fireworks", "money-rain"] },
  ],
  blocked: [],
  shortNames: false,
};

export const MIN_TEMPO = 1;
export const MAX_TEMPO = 3;
const LIKE_TEMPO = 0.004;
const GIFT_TEMPO = 0.35;
const TEMPO_DECAY_PER_SECOND = 0.03;
const FEED_SIZE = 12;
const SEEN_SIZE = 600;

export interface HalayDancer {
  viewer: LiveViewer;
  joinedAt: number;
  lastActiveAt: number;
  diamonds: number;
  frontUntil?: number;
}

export interface HalayFeedItem {
  id: string;
  at: number;
  text: string;
}

export interface HalayTotals {
  diamonds: number;
  gifts: number;
  comments: number;
  likes: number;
  joins: number;
  follows: number;
  peakViewers: number;
}

export interface HalayState {
  dancers: HalayDancer[];
  leader?: { id: string; until?: number };
  tempo: number;
  updatedAt: number;
  viewers: number;
  totals: HalayTotals;
  /** Diamonds per viewer for the whole session, including viewers who left the circle. */
  gifters: Record<string, { viewer: LiveViewer; diamonds: number }>;
  feed: HalayFeedItem[];
  seen: string[];
}

export interface HalayCue {
  effect: HalayEffect | "joined" | "leader" | "gift";
  viewerId?: string;
  label?: string;
}

export function emptyHalayState(now: number): HalayState {
  return {
    dancers: [],
    tempo: MIN_TEMPO,
    updatedAt: now,
    viewers: 0,
    totals: { diamonds: 0, gifts: 0, comments: 0, likes: 0, joins: 0, follows: 0, peakViewers: 0 },
    gifters: {},
    feed: [],
    seen: [],
  };
}

/** Lets tempo fall back toward normal and expires leader and front holds. */
export function tickHalay(state: HalayState, now: number): HalayState {
  const seconds = Math.max(0, (now - state.updatedAt) / 1000);
  const tempo = Math.max(MIN_TEMPO, state.tempo - seconds * TEMPO_DECAY_PER_SECOND);
  const leader = state.leader?.until !== undefined && state.leader.until <= now ? undefined : state.leader;
  return { ...state, tempo, leader, updatedAt: now };
}

/** Picks the rule a gift triggers: a name match first, then the highest value threshold reached. */
export function matchGiftRule(rules: HalayGiftRule[], giftName: string, totalDiamonds: number): HalayGiftRule | undefined {
  const byName = rules.find((rule) => rule.giftName && rule.giftName.toLowerCase() === giftName.toLowerCase());
  if (byName) return byName;
  return rules
    .filter((rule) => !rule.giftName && totalDiamonds >= rule.minDiamonds)
    .sort((a, b) => b.minDiamonds - a.minDiamonds)[0];
}

function isBlocked(config: HalayConfig, viewer: LiveViewer): boolean {
  const handle = viewer.handle.toLowerCase();
  return config.blocked.some((blocked) => blocked.replace(/^@/, "").toLowerCase() === handle);
}

function wantsToJoin(config: HalayConfig, text: string): boolean {
  if (config.joinOnAnyComment) return true;
  const lower = text.toLocaleLowerCase("tr");
  return config.joinKeywords.some((word) => word.trim() && lower.includes(word.trim().toLocaleLowerCase("tr")));
}

function pushFeed(feed: HalayFeedItem[], item: HalayFeedItem): HalayFeedItem[] {
  return [...feed, item].slice(-FEED_SIZE);
}

/** Adds or refreshes a dancer; when the circle is full the least valuable, longest-idle dancer leaves. */
function upsertDancer(dancers: HalayDancer[], viewer: LiveViewer, now: number, capacity: number): { dancers: HalayDancer[]; joined: boolean } {
  const index = dancers.findIndex((dancer) => dancer.viewer.id === viewer.id);
  if (index >= 0) {
    const next = [...dancers];
    next[index] = { ...next[index], viewer: { ...next[index].viewer, ...viewer }, lastActiveAt: now };
    return { dancers: next, joined: false };
  }
  let next = [...dancers, { viewer, joinedAt: now, lastActiveAt: now, diamonds: 0 }];
  if (capacity > 0 && next.length > capacity) {
    const evict = next
      .slice(0, -1)
      .filter((dancer) => !(dancer.frontUntil && dancer.frontUntil > now))
      .sort((a, b) => a.diamonds - b.diamonds || a.lastActiveAt - b.lastActiveAt)[0];
    next = next.filter((dancer) => dancer !== (evict ?? next[0]));
  }
  return { dancers: next, joined: true };
}

function touchDancer(dancers: HalayDancer[], viewerId: string, now: number): HalayDancer[] {
  return dancers.map((dancer) => (dancer.viewer.id === viewerId ? { ...dancer, lastActiveAt: now } : dancer));
}

/**
 * Applies one live event to the halay. Pure: returns the next state and the cues the overlay should
 * play. Repeated event ids are ignored so a reconnect that replays messages does not double-count.
 */
export function reduceHalay(state: HalayState, event: LiveEvent, config: HalayConfig, now: number): { state: HalayState; cues: HalayCue[] } {
  if (state.seen.includes(event.id)) return { state, cues: [] };
  let next: HalayState = { ...tickHalay(state, now), seen: [...state.seen, event.id].slice(-SEEN_SIZE) };
  const cues: HalayCue[] = [];
  if ("viewer" in event && isBlocked(config, event.viewer)) return { state: next, cues };

  const join = (viewer: LiveViewer) => {
    const result = upsertDancer(next.dancers, viewer, now, config.capacity);
    next = { ...next, dancers: result.dancers };
    if (result.joined) {
      next = { ...next, totals: { ...next.totals, joins: next.totals.joins + 1 } };
      cues.push({ effect: "joined", viewerId: viewer.id });
    }
  };

  switch (event.kind) {
    case "comment": {
      next = { ...next, totals: { ...next.totals, comments: next.totals.comments + 1 } };
      if (wantsToJoin(config, event.text)) join(event.viewer);
      else next = { ...next, dancers: touchDancer(next.dancers, event.viewer.id, now) };
      break;
    }
    case "like": {
      next = {
        ...next,
        tempo: Math.min(MAX_TEMPO, next.tempo + event.count * LIKE_TEMPO),
        totals: { ...next.totals, likes: next.totals.likes + event.count },
      };
      if (config.joinOnLike) join(event.viewer);
      break;
    }
    case "follow": {
      next = { ...next, totals: { ...next.totals, follows: next.totals.follows + 1 } };
      if (config.joinOnFollow) join(event.viewer);
      break;
    }
    case "gift": {
      const total = Math.max(0, event.diamonds) * Math.max(1, event.count);
      const previous = next.gifters[event.viewer.id]?.diamonds ?? 0;
      next = {
        ...next,
        totals: { ...next.totals, diamonds: next.totals.diamonds + total, gifts: next.totals.gifts + event.count },
        gifters: { ...next.gifters, [event.viewer.id]: { viewer: event.viewer, diamonds: previous + total } },
        feed: pushFeed(next.feed, { id: event.id, at: now, text: `${event.viewer.name}: ${event.count}x ${event.giftName}` }),
      };
      cues.push({ effect: "gift", viewerId: event.viewer.id, label: `${event.count}x ${event.giftName}` });
      const rule = matchGiftRule(config.giftRules, event.giftName, total);
      for (const action of rule?.actions ?? []) {
        if (action === "join") join(event.viewer);
        else if (action === "front") {
          join(event.viewer);
          next = {
            ...next,
            dancers: next.dancers.map((dancer) =>
              dancer.viewer.id === event.viewer.id ? { ...dancer, frontUntil: now + config.frontHoldSeconds * 1000 } : dancer,
            ),
          };
        } else if (action === "leader") {
          join(event.viewer);
          next = { ...next, leader: { id: event.viewer.id, until: now + config.leaderHoldSeconds * 1000 } };
          cues.push({ effect: "leader", viewerId: event.viewer.id });
        } else if (action === "tempo") next = { ...next, tempo: Math.min(MAX_TEMPO, next.tempo + GIFT_TEMPO) };
        else cues.push({ effect: action, viewerId: event.viewer.id });
      }
      next = {
        ...next,
        dancers: next.dancers.map((dancer) => (dancer.viewer.id === event.viewer.id ? { ...dancer, diamonds: dancer.diamonds + total } : dancer)),
      };
      break;
    }
    case "viewers":
      next = { ...next, viewers: event.count, totals: { ...next.totals, peakViewers: Math.max(next.totals.peakViewers, event.count) } };
      break;
    case "join":
    case "share":
    case "stream-end":
      break;
  }
  return { state: next, cues };
}

export interface HalaySnapshotDancer {
  id: string;
  handle: string;
  name: string;
  avatarUrl?: string;
  role: "leader" | "front" | "dancer";
  diamonds: number;
}

export interface HalaySnapshot {
  dancers: HalaySnapshotDancer[];
  tempo: number;
  viewers: number;
  totals: HalayTotals;
  topGifters: { id: string; name: string; avatarUrl?: string; diamonds: number }[];
  feed: HalayFeedItem[];
}

function displayName(name: string, short: boolean): string {
  const clean = name.trim() || "?";
  return short ? `${Array.from(clean).slice(0, 3).join("")}…` : clean;
}

/**
 * Orders the line for drawing: halaybaşı first (an active `leader` gift, otherwise the biggest gifter
 * in the circle), then viewers holding a `front` gift, then everyone else by arrival.
 */
export function halaySnapshot(state: HalayState, config: HalayConfig, now: number): HalaySnapshot {
  const ticked = tickHalay(state, now);
  const topInCircle = [...ticked.dancers].filter((dancer) => dancer.diamonds > 0).sort((a, b) => b.diamonds - a.diamonds)[0];
  const leaderId = ticked.leader?.id ?? topInCircle?.viewer.id;
  const role = (dancer: HalayDancer): HalaySnapshotDancer["role"] =>
    dancer.viewer.id === leaderId ? "leader" : dancer.frontUntil && dancer.frontUntil > now ? "front" : "dancer";
  const rank = { leader: 0, front: 1, dancer: 2 } as const;
  const dancers = ticked.dancers
    .map((dancer) => ({ dancer, role: role(dancer) }))
    .sort((a, b) => rank[a.role] - rank[b.role] || a.dancer.joinedAt - b.dancer.joinedAt)
    .map(({ dancer, role }) => ({
      id: dancer.viewer.id,
      handle: dancer.viewer.handle,
      name: displayName(dancer.viewer.name, config.shortNames),
      avatarUrl: dancer.viewer.avatarUrl,
      role,
      diamonds: dancer.diamonds,
    }));
  const topGifters = Object.values(ticked.gifters)
    .sort((a, b) => b.diamonds - a.diamonds)
    .slice(0, 5)
    .map(({ viewer, diamonds }) => ({ id: viewer.id, name: displayName(viewer.name, config.shortNames), avatarUrl: viewer.avatarUrl, diamonds }));
  return { dancers, tempo: ticked.tempo, viewers: ticked.viewers, totals: ticked.totals, topGifters, feed: ticked.feed };
}
