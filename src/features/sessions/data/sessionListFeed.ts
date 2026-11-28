import { invoke } from "@tauri-apps/api/core";
import { hasHostSessionOwnerFence } from "../../connections/public/sessionExecutionBinding";
import { normalizeSummary, type SessionSummary } from "./sessionStore";

/** One settled record of the Host lifecycle list; the native store does not know settle state. */
export type SettledMark = { id: string; settledAt: number | null };

export type SessionListQuery = {
  /** Pinned rows and the rest are separate queries (index order). */
  pinned: boolean;
  /** Activity at or after this time (ms); absent means all time. */
  since?: number;
  /** Exact stored cwd values; the native side runs one indexed query per cwd. */
  cwds?: string[];
  settled?: SettledMark[];
  /** `exclude` drops settled rows; `only` returns the Settled shelf rows. */
  settledMode?: "exclude" | "only";
  /** ASCII case-insensitive title substring. */
  title?: string;
  /** true lists archived rows only; absent or false lists unarchived rows only. */
  archived?: boolean;
  /** Default 100, clamped to 1..2000 by the native side. */
  limit?: number;
};

export type SessionListCursor = { activityAt: number; id: string };

export const SESSION_LIST_MAX_LIMIT = 2000;

/** One keyset page. Owner-fenced rows are hidden, so a page can hold fewer rows than asked. */
export async function listSessionPage(
  query: SessionListQuery,
  cursor: SessionListCursor | null,
): Promise<{ rows: SessionSummary[]; nextCursor: SessionListCursor | null; revision: number }> {
  const page = await invoke<{
    rows: SessionSummary[];
    nextCursor: SessionListCursor | null;
    revision: number;
  }>("session_list_page", { query, cursor });
  return {
    rows: page.rows.filter((row) => !hasHostSessionOwnerFence(row.id)).map(normalizeSummary),
    nextCursor: page.nextCursor,
    revision: page.revision,
  };
}

/** Matching rows grouped by stored cwd, ignoring `cwds` and `limit`. */
export function countSessions(query: SessionListQuery): Promise<{
  groups: { cwd: string; count: number; latestActivityAt: number }[];
  total: number;
  revision: number;
}> {
  return invoke("session_list_counts", { query });
}

/** Monotonic counter that moves when a list-visible session field changes. */
export function sessionListFeedRevision(): Promise<number> {
  return invoke<number>("session_list_feed_revision");
}
