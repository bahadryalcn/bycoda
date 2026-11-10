import type { RankedFile } from "../../files";
import {
  CREW_HANDLE_PATTERN,
  type CrewDefinition,
  type SavedCrewAgent,
} from "../../crews/public/mentions";
import { isMarkdownBlockquotePosition } from "./quoteDraft";

/** Host capability for `crews.member.ask`; the constant lives here until crews exports one. */
export const HOST_CREW_MEMBER_ASK_CAPABILITY = "crews.member.ask.v1";

/** Reserved `ProjectFile.path` prefixes, like Notes' `note/`, so the file picker can carry these rows. */
export const CREW_MEMBER_MENTION_PREFIX = "crew-member/";
export const CREW_MENTION_PREFIX = "crew/";

const MAX_MEMBER_ROWS = 6;
const MAX_CREW_ROWS = 4;
/** One message delegates to at most this many targets. */
export const MAX_DELEGATIONS = 5;

/** Library members and saved crews of one project, as the Host listed them. */
export type CrewMentionSource = {
  machineId: string;
  projectId: string;
  agents: readonly SavedCrewAgent[];
  definitions: readonly CrewDefinition[];
  /** The Host can run a member in its own conversation (`crews.member.ask`). */
  memberAsk: boolean;
};

export type CrewMentionTarget =
  | { kind: "member"; id: string; token: string; name: string; agent: SavedCrewAgent }
  | { kind: "crew"; id: string; token: string; name: string; definition: CrewDefinition };

/** A picker row: a `ProjectFile`-shaped entry plus the crew data the picker draws. */
export type CrewMentionRow = RankedFile & { crew: CrewMentionTarget };

export function isCrewMentionPath(path: string): boolean {
  return path.startsWith(CREW_MEMBER_MENTION_PREFIX) || path.startsWith(CREW_MENTION_PREFIX);
}

export function crewMentionOf(file: RankedFile): CrewMentionTarget | undefined {
  return (file as Partial<CrewMentionRow>).crew;
}

/** A lowercase `@token` for a name, or undefined when it has no latin letters or digits. */
export function mentionSlug(name: string): string | undefined {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/g, "");
  return CREW_HANDLE_PATTERN.test(slug) ? slug : undefined;
}

/**
 * Every writable `@token` and what it means. A handle is the token when the member has one,
 * else the name's slug. Handles claim first, members before crews; a taken token is skipped,
 * so one token never means two things.
 */
export function crewMentionTargets(source: CrewMentionSource): CrewMentionTarget[] {
  const taken = new Set<string>();
  const targets: CrewMentionTarget[] = [];
  const claim = (target: CrewMentionTarget | undefined) => {
    if (!target || taken.has(target.token)) return;
    taken.add(target.token);
    targets.push(target);
  };
  const members = source.memberAsk ? source.agents : [];
  const member = (
    agent: SavedCrewAgent,
    token: string | undefined,
  ): CrewMentionTarget | undefined =>
    token ? { kind: "member", id: agent.id, token, name: agent.name, agent } : undefined;
  for (const agent of members) if (agent.handle) claim(member(agent, agent.handle));
  for (const agent of members) if (!agent.handle) claim(member(agent, mentionSlug(agent.name)));
  for (const definition of source.definitions) {
    const token = mentionSlug(definition.name);
    if (token && definition.agents.length)
      claim({ kind: "crew", id: definition.id, token, name: definition.name, definition });
  }
  return targets;
}

/** Lower is better; undefined means no match. A handle prefix beats a name match. */
function matchTier(target: CrewMentionTarget, needle: string): number | undefined {
  if (target.token.startsWith(needle)) return 0;
  const name = target.name.toLowerCase();
  if (name.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(needle))) return 1;
  if (name.includes(needle) || target.token.includes(needle)) return 2;
  return undefined;
}

function rowFor(target: CrewMentionTarget, needle: string): CrewMentionRow {
  const at = needle ? target.name.toLowerCase().indexOf(needle) : -1;
  return {
    name: target.name,
    path: `${target.kind === "member" ? CREW_MEMBER_MENTION_PREFIX : CREW_MENTION_PREFIX}${target.id}`,
    relative: target.token,
    score: 0,
    positions: at < 0 ? [] : Array.from({ length: needle.length }, (_, i) => at + i),
    crew: target,
  };
}

/** Members first, then crews, each ranked by handle prefix, then name. */
export function rankCrewMentions(source: CrewMentionSource, query: string): CrewMentionRow[] {
  const needle = query.trim().toLowerCase();
  const pick = (kind: CrewMentionTarget["kind"], limit: number) =>
    crewMentionTargets(source)
      .filter((target) => target.kind === kind)
      .flatMap((target) => {
        const tier = needle ? matchTier(target, needle) : 0;
        return tier === undefined ? [] : [{ target, tier }];
      })
      .sort((a, b) => a.tier - b.tier || a.target.name.localeCompare(b.target.name))
      .slice(0, limit)
      .map(({ target }) => rowFor(target, needle));
  return [...pick("member", MAX_MEMBER_ROWS), ...pick("crew", MAX_CREW_ROWS)];
}

const FENCED_CODE = /```[\s\S]*?(?:```|$)/g;
const INLINE_CODE = /`[^`\n]*`/g;
/** `@token` at a word start, ended by whitespace or end of text (after trailing punctuation). */
const MENTION = /(^|\s)@([A-Za-z0-9][A-Za-z0-9-]*)(?=[.,;:!?)\]}"']*(?:\s|$))/g;

/**
 * The members and crews a message names with a resolved `@token`, in order, once each.
 * Emails, code spans and quoted text never resolve; an unknown token stays plain text.
 */
export function findCrewMentions(
  text: string,
  targets: readonly CrewMentionTarget[],
): CrewMentionTarget[] {
  if (!text.includes("@") || !targets.length) return [];
  const byToken = new Map(targets.map((target) => [target.token, target]));
  const blank = (match: string) => " ".repeat(match.length);
  const scanned = text.replace(FENCED_CODE, blank).replace(INLINE_CODE, blank);
  const found = new Map<string, CrewMentionTarget>();
  for (const match of scanned.matchAll(MENTION)) {
    const start = match.index + (match[1] ?? "").length;
    if (isMarkdownBlockquotePosition(text, start)) continue;
    const target = byToken.get(match[2]!.toLowerCase());
    if (target) found.set(`${target.kind}:${target.id}`, target);
  }
  return [...found.values()].slice(0, MAX_DELEGATIONS);
}

/**
 * One identity per message send, so a retry of the same send repeats the same Host request.
 * A queued row or an app request keeps its own id; a plain send uses its position in the
 * conversation.
 */
export function delegationRequestKey(input: {
  sessionId: string;
  queuedMessageId?: string;
  appRequestId?: string;
  userTurns: number;
}): string {
  const identity = input.queuedMessageId ?? input.appRequestId ?? `turn-${input.userTurns}`;
  return `${input.sessionId}:${identity}`;
}

/** Stable Host request id for one target of one send. */
export function delegationRequestId(key: string, target: Pick<CrewMentionTarget, "kind" | "id">) {
  return `chat-mention:${key}:${target.kind}:${target.id}`;
}

/** The line appended for the conversation's agent after a delegation. */
export function delegationNote(
  target: Pick<CrewMentionTarget, "kind" | "token">,
  reference: string | undefined,
): string {
  const label = target.kind === "member" ? "task" : "run";
  const ref = reference ? ` (${label} ${reference})` : "";
  return `Delegated to @${target.token}${ref}; results will appear here.`;
}
