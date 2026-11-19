import { t } from "../../../shared/i18n";
import { elapsedSince, monotonicNow } from "../../../shared/lib/time/timestamps";
import type { SocialSnapshot, SocialWorkspaceQuery } from "./social";
import type { SocialClient } from "./socialClient";
import { sectionFromFullSnapshot } from "./socialTodaySections";

const UNSUPPORTED_WORKSPACE_READ = "Unsupported social operation";
const SECTION_LIMIT = 50;
/** A Host may be upgraded while the app runs, so "unsupported" is forgotten and probed again. */
const UNSUPPORTED_MEMORY_MS = 10 * 60_000;
/** Section reads of one refresh start together; only a request this young is joined. */
const JOIN_WINDOW_MS = 1_000;

type Section = NonNullable<SocialWorkspaceQuery["section"]>;

// Both maps are keyed by client, which is retained with its Host, so they never cross Hosts.
const unsupportedSince = new WeakMap<SocialClient, number>();
const fullSnapshot = new WeakMap<
  SocialClient,
  { startedAt: number; read: Promise<SocialSnapshot> }
>();

const knownUnsupported = (client: SocialClient) => {
  const since = unsupportedSince.get(client);
  if (since === undefined) return false;
  if (elapsedSince(since) < UNSUPPORTED_MEMORY_MS) return true;
  unsupportedSince.delete(client);
  return false;
};

/** One full-snapshot request is shared by the sections that ask for it in the same refresh. */
function sharedFullSnapshot(client: SocialClient): Promise<SocialSnapshot> {
  const current = fullSnapshot.get(client);
  if (current && elapsedSince(current.startedAt) < JOIN_WINDOW_MS) return current.read;
  const entry = {
    startedAt: monotonicNow(),
    read: client.snapshot().finally(() => {
      if (fullSnapshot.get(client) === entry) fullSnapshot.delete(client);
    }),
  };
  fullSnapshot.set(client, entry);
  return entry.read;
}

async function readFromFullSnapshot(client: SocialClient, section: Section, projectId: string) {
  const full = await sharedFullSnapshot(client);
  return sectionFromFullSnapshot(full, section, projectId, SECTION_LIMIT);
}

/**
 * Reads one Today section. A Host with section-scoped reads answers a narrow query. A Host
 * without them is remembered per client, and its sections then share one full-snapshot request
 * and select their own rows from it, instead of each downloading the whole workspace.
 */
export async function readTodaySection(
  client: SocialClient,
  section: Section,
  projectId: string,
): Promise<SocialSnapshot> {
  if (knownUnsupported(client)) return readFromFullSnapshot(client, section, projectId);
  try {
    const response = await client.sectionSnapshot({
      section,
      limit: SECTION_LIMIT,
      ...(projectId ? { projectId } : {}),
    });
    if (!response.snapshot) throw new Error(t("The Social Media refresh response is incomplete."));
    return response.snapshot;
  } catch (cause) {
    // shortcut: sections that start together each send one cheap probe before the first
    // memory is set; upgrade to a single shared probe if that cost shows up.
    if (!String(cause).includes(UNSUPPORTED_WORKSPACE_READ)) throw cause;
    unsupportedSince.set(client, monotonicNow());
    return readFromFullSnapshot(client, section, projectId);
  }
}
