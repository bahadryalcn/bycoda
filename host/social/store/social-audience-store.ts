import type { HostStore } from "../../store";
import type { StoreRow } from "../../store-db";
import type {
  SocialAccount,
  SocialContact,
  SocialPlatform,
  SocialSegment,
} from "../../../src/features/social/model/social";
import type {
  AudienceFilter,
  CaptureRule,
  ContactHandle,
  Interaction,
  SocialList,
  SocialPerson,
} from "../../../src/features/social/model/audience";
import type {
  EmailAccount,
  Sequence,
  SequenceEnrollment,
  Suppression,
} from "../../../src/features/social/model/outreach";
import type { AiAction, AutonomyPolicy } from "../../../src/features/social/model/autonomy";
import type { InboxStatusRecord } from "../inbox/inbox-types";

/** Generic `social_records` kinds. Person and list have dedicated typed methods below. */
export type AudienceRecordKind =
  | "person"
  | "list"
  | "capture-rule"
  | "sequence"
  | "email-account"
  | "autonomy"
  | "inbox-status";

export type AudienceRecordValue = {
  person: SocialPerson;
  list: SocialList;
  "capture-rule": CaptureRule;
  sequence: Sequence;
  "email-account": EmailAccount;
  autonomy: AutonomyPolicy;
  "inbox-status": InboxStatusRecord;
};

export type Page<T> = { items: T[]; next?: string };

const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;
const MAX_BATCH = 1000;
const INTERACTION_PAGE = 100;

export const AUDIENCE_SCHEMA_KEY = "schema.audience";
export const AUDIENCE_SCHEMA_VERSION = "1";
export const SYSTEM_COMMENTERS_LIST_ID = "system-commenters";
export const SYSTEM_COMMENTERS_RULE_ID = "system-commenters-capture";

/** Idempotent DDL. social.ts also creates social_records and social_settings; repeating them is safe. */
const AUDIENCE_DDL = `
  CREATE TABLE IF NOT EXISTS social_records (kind TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(kind,id));
  CREATE TABLE IF NOT EXISTS social_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS social_person_handles (account_id TEXT NOT NULL, platform_id TEXT NOT NULL, person_id TEXT NOT NULL, PRIMARY KEY(account_id, platform_id));
  CREATE INDEX IF NOT EXISTS social_person_handles_person ON social_person_handles(person_id);
  CREATE TABLE IF NOT EXISTS social_list_members (list_id TEXT NOT NULL, person_id TEXT NOT NULL, added_at INTEGER NOT NULL, source TEXT NOT NULL, PRIMARY KEY(list_id, person_id));
  CREATE INDEX IF NOT EXISTS social_list_members_person ON social_list_members(person_id);
  CREATE TABLE IF NOT EXISTS social_interactions (id TEXT PRIMARY KEY, person_id TEXT NOT NULL, account_id TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL, value TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS social_interactions_person ON social_interactions(person_id, at);
  CREATE TABLE IF NOT EXISTS social_enrollments (id TEXT PRIMARY KEY, sequence_id TEXT NOT NULL, person_id TEXT NOT NULL, status TEXT NOT NULL, next_at INTEGER, value TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS social_enrollments_due ON social_enrollments(status, next_at);
  CREATE INDEX IF NOT EXISTS social_enrollments_sequence ON social_enrollments(sequence_id, id);
  CREATE TABLE IF NOT EXISTS social_suppressions (id TEXT PRIMARY KEY, person_id TEXT, platform TEXT, platform_id TEXT, email TEXT, channel TEXT NOT NULL, value TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS social_suppressions_person ON social_suppressions(person_id);
  CREATE INDEX IF NOT EXISTS social_suppressions_handle ON social_suppressions(platform, platform_id);
  CREATE INDEX IF NOT EXISTS social_suppressions_email ON social_suppressions(email);
  CREATE TABLE IF NOT EXISTS social_ai_actions (id TEXT PRIMARY KEY, at INTEGER NOT NULL, account_id TEXT NOT NULL, value TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS social_ai_actions_at ON social_ai_actions(at, id);
  CREATE TABLE IF NOT EXISTS social_autonomy_counters (account_id TEXT NOT NULL, action TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(account_id, action, day));
`;

function pageSize(limit: number | undefined, fallback = DEFAULT_PAGE): number {
  if (limit === undefined) return fallback;
  if (!Number.isFinite(limit)) throw new Error("Invalid page limit.");
  return Math.min(MAX_PAGE, Math.max(1, Math.floor(limit)));
}

function marks(count: number): string {
  return Array.from({ length: count }, () => "?").join(",");
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function parse<T>(row: StoreRow): T {
  return JSON.parse(String(row.value)) as T;
}

/**
 * Typed access to the audience tables. It owns no clock and no business rules: callers pass
 * timestamps and decide permissions. Every method is safe inside an outer store transaction.
 */
export class SocialAudienceStore {
  constructor(private readonly store: HostStore) {}

  async initialize(): Promise<void> {
    await this.store.ready;
    await this.store.db.scope(() => this.store.db.exec(AUDIENCE_DDL));
  }

  // Generic records (social_records).

  async getRecord<K extends AudienceRecordKind>(
    kind: K,
    id: string,
  ): Promise<AudienceRecordValue[K] | undefined> {
    const row = await this.store.db
      .prepare("SELECT value FROM social_records WHERE kind=? AND id=?")
      .get(kind, id);
    return row ? parse<AudienceRecordValue[K]>(row) : undefined;
  }

  async putRecord<K extends AudienceRecordKind>(
    kind: K,
    id: string,
    value: AudienceRecordValue[K],
  ): Promise<AudienceRecordValue[K]> {
    await this.store.db
      .prepare(
        "INSERT INTO social_records VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value",
      )
      .run(kind, id, JSON.stringify(value));
    return value;
  }

  async deleteRecord(kind: AudienceRecordKind, id: string): Promise<boolean> {
    const result = await this.store.db
      .prepare("DELETE FROM social_records WHERE kind=? AND id=?")
      .run(kind, id);
    return Number(result.changes) > 0;
  }

  /** Keyset page ordered by id. The cursor is the last id of the previous page. */
  async listRecords<K extends AudienceRecordKind>(
    kind: K,
    input: { cursor?: string; limit?: number } = {},
  ): Promise<Page<AudienceRecordValue[K]>> {
    const limit = pageSize(input.limit);
    const rows = await this.store.db
      .prepare("SELECT id, value FROM social_records WHERE kind=? AND id>? ORDER BY id LIMIT ?")
      .all(kind, input.cursor ?? "", limit + 1);
    return pageOf(rows, limit, (row) => parse<AudienceRecordValue[K]>(row));
  }

  // People and handles.

  async getPerson(id: string): Promise<SocialPerson | undefined> {
    return this.getRecord("person", id);
  }

  /** Replaces the person and its platform handles. A handle may belong to only one person. */
  async putPerson(person: SocialPerson): Promise<SocialPerson> {
    return this.store.transaction(async () => {
      for (const handle of person.handles) {
        const owner = await this.store.db
          .prepare(
            "SELECT person_id FROM social_person_handles WHERE account_id=? AND platform_id=?",
          )
          .get(handle.accountId, handle.platformId);
        if (owner && owner.person_id !== person.id)
          throw new Error("Platform handle already belongs to another person.");
      }
      await this.store.db
        .prepare("DELETE FROM social_person_handles WHERE person_id=?")
        .run(person.id);
      for (const handle of person.handles)
        await this.store.db
          .prepare(
            "INSERT INTO social_person_handles VALUES (?,?,?) ON CONFLICT(account_id,platform_id) DO UPDATE SET person_id=excluded.person_id",
          )
          .run(handle.accountId, handle.platformId, person.id);
      return this.putRecord("person", person.id, person);
    });
  }

  /** Removes the person, handles, list memberships, interactions and enrollments. Suppressions stay. */
  async deletePerson(id: string): Promise<boolean> {
    return this.store.transaction(async () => {
      if (!(await this.getPerson(id))) return false;
      for (const sql of [
        "DELETE FROM social_person_handles WHERE person_id=?",
        "DELETE FROM social_list_members WHERE person_id=?",
        "DELETE FROM social_interactions WHERE person_id=?",
        "DELETE FROM social_enrollments WHERE person_id=?",
      ])
        await this.store.db.prepare(sql).run(id);
      return this.deleteRecord("person", id);
    });
  }

  /** Runs `fn` in one database transaction; a throw rolls back every write made inside it. */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.store.transaction(fn);
  }

  async findPersonByHandle(
    accountId: string,
    platformId: string,
  ): Promise<SocialPerson | undefined> {
    const row = await this.store.db
      .prepare("SELECT person_id FROM social_person_handles WHERE account_id=? AND platform_id=?")
      .get(accountId, platformId);
    return row ? this.getPerson(String(row.person_id)) : undefined;
  }

  /** Adds a handle to an existing person. An identical handle is a no-op. */
  async linkHandle(personId: string, handle: ContactHandle, now: number): Promise<SocialPerson> {
    const person = await this.getPerson(personId);
    if (!person) throw new Error("Person not found.");
    if (
      person.handles.some(
        (item) => item.accountId === handle.accountId && item.platformId === handle.platformId,
      )
    )
      return person;
    return this.putPerson({ ...person, handles: [...person.handles, handle], updatedAt: now });
  }

  /**
   * Filtered keyset page of people, at most 200 rows. With `listId` only that list's members are
   * read; dynamic lists are evaluated by passing the list's own `filter` as well.
   */
  async listPeople(input: {
    filter?: AudienceFilter;
    listId?: string;
    cursor?: string;
    limit?: number;
  }): Promise<Page<SocialPerson>> {
    const limit = pageSize(input.limit);
    const clauses = ["r.kind='person'", "r.id>?"];
    const values: (string | number)[] = [input.cursor ?? ""];
    let from = "social_records r";
    if (input.listId) {
      from += " JOIN social_list_members m ON m.person_id=r.id";
      clauses.push("m.list_id=?");
      values.push(input.listId);
    }
    const filter = input.filter ?? {};
    if (filter.stages?.length) {
      clauses.push(`json_extract(r.value,'$.stage') IN (${marks(filter.stages.length)})`);
      values.push(...filter.stages);
    }
    if (filter.language) {
      clauses.push("json_extract(r.value,'$.language')=?");
      values.push(filter.language);
    }
    if (filter.minScore !== undefined) {
      clauses.push("json_extract(r.value,'$.score.value')>=?");
      values.push(filter.minScore);
    }
    if (filter.tags?.length) {
      // Every listed tag must be present, matching saved segment semantics.
      clauses.push(
        "NOT EXISTS (SELECT 1 FROM json_each(?) t WHERE NOT EXISTS (SELECT 1 FROM json_each(r.value,'$.tags') c WHERE c.value=t.value))",
      );
      values.push(JSON.stringify(filter.tags));
    }
    if (filter.platforms?.length) {
      clauses.push(
        `EXISTS (SELECT 1 FROM json_each(r.value,'$.handles') h WHERE json_extract(h.value,'$.platform') IN (${marks(filter.platforms.length)}))`,
      );
      values.push(...filter.platforms);
    }
    if (filter.sources?.length) {
      clauses.push(`json_extract(r.value,'$.source') IN (${marks(filter.sources.length)})`);
      values.push(...filter.sources);
    }
    if (filter.query?.trim()) {
      // shortcut: SQLite LOWER is ASCII-only, so non-ASCII names match case-sensitively; upgrade with a normalized search column.
      clauses.push("LOWER(json_extract(r.value,'$.name')) LIKE ? ESCAPE '\\'");
      values.push(`%${escapeLike(filter.query.trim().toLowerCase())}%`);
    }
    const rows = await this.store.db
      .prepare(
        `SELECT r.id, r.value FROM ${from} WHERE ${clauses.join(" AND ")} ORDER BY r.id LIMIT ?`,
      )
      .all(...values, limit + 1);
    return pageOf(rows, limit, (row) => parse<SocialPerson>(row), "id");
  }

  // Lists and membership.

  async getList(id: string): Promise<SocialList | undefined> {
    return this.getRecord("list", id);
  }

  async putList(list: SocialList): Promise<SocialList> {
    return this.putRecord("list", list.id, list);
  }

  /** Deletes the list and its memberships. People are not deleted. */
  async deleteList(id: string): Promise<boolean> {
    return this.store.transaction(async () => {
      await this.store.db.prepare("DELETE FROM social_list_members WHERE list_id=?").run(id);
      return this.deleteRecord("list", id);
    });
  }

  async listLists(): Promise<SocialList[]> {
    return (
      await this.store.db
        .prepare("SELECT value FROM social_records WHERE kind='list' ORDER BY rowid")
        .all()
    ).map((row) => parse<SocialList>(row));
  }

  async addMembers(
    listId: string,
    personIds: string[],
    input: { source: string; at: number },
  ): Promise<number> {
    if (personIds.length > MAX_BATCH) throw new Error("Too many list members in one call.");
    return this.store.transaction(async () => {
      let added = 0;
      for (const personId of personIds) {
        const result = await this.store.db
          .prepare(
            "INSERT INTO social_list_members VALUES (?,?,?,?) ON CONFLICT(list_id,person_id) DO NOTHING",
          )
          .run(listId, personId, input.at, input.source);
        added += Number(result.changes);
      }
      return added;
    });
  }

  async removeMembers(listId: string, personIds: string[]): Promise<number> {
    if (personIds.length > MAX_BATCH) throw new Error("Too many list members in one call.");
    return this.store.transaction(async () => {
      let removed = 0;
      for (const personId of personIds)
        removed += Number(
          (
            await this.store.db
              .prepare("DELETE FROM social_list_members WHERE list_id=? AND person_id=?")
              .run(listId, personId)
          ).changes,
        );
      return removed;
    });
  }

  async listMembers(
    listId: string,
    input: { cursor?: string; limit?: number } = {},
  ): Promise<{ personIds: string[]; next?: string }> {
    const limit = pageSize(input.limit);
    const rows = await this.store.db
      .prepare(
        "SELECT person_id FROM social_list_members WHERE list_id=? AND person_id>? ORDER BY person_id LIMIT ?",
      )
      .all(listId, input.cursor ?? "", limit + 1);
    const page = pageOf(rows, limit, (row) => String(row.person_id), "person_id");
    return { personIds: page.items, ...(page.next ? { next: page.next } : {}) };
  }

  // Interactions.

  /** Returns false when an interaction with the same id already exists. */
  async addInteraction(interaction: Interaction): Promise<boolean> {
    const result = await this.store.db
      .prepare("INSERT INTO social_interactions VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING")
      .run(
        interaction.id,
        interaction.personId,
        interaction.accountId,
        interaction.kind,
        interaction.at,
        JSON.stringify(interaction),
      );
    return Number(result.changes) > 0;
  }

  /** Newest first, at most 100 rows. */
  async listInteractions(personId: string, limit = INTERACTION_PAGE): Promise<Interaction[]> {
    const rows = await this.store.db
      .prepare(
        "SELECT value FROM social_interactions WHERE person_id=? ORDER BY at DESC, id DESC LIMIT ?",
      )
      .all(personId, Math.min(INTERACTION_PAGE, pageSize(limit)));
    return rows.map((row) => parse<Interaction>(row));
  }

  // Sequence enrollments.

  async putEnrollment(enrollment: SequenceEnrollment): Promise<SequenceEnrollment> {
    await this.store.db
      .prepare(
        `INSERT INTO social_enrollments VALUES (?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET sequence_id=excluded.sequence_id, person_id=excluded.person_id,
           status=excluded.status, next_at=excluded.next_at, value=excluded.value`,
      )
      .run(
        enrollment.id,
        enrollment.sequenceId,
        enrollment.personId,
        enrollment.status,
        enrollment.nextAt ?? null,
        JSON.stringify(enrollment),
      );
    return enrollment;
  }

  async getEnrollment(id: string): Promise<SequenceEnrollment | undefined> {
    const row = await this.store.db
      .prepare("SELECT value FROM social_enrollments WHERE id=?")
      .get(id);
    return row ? parse<SequenceEnrollment>(row) : undefined;
  }

  /** Active enrollments whose next step is due. Oldest due first, at most 200. */
  async dueEnrollments(now: number, limit = DEFAULT_PAGE): Promise<SequenceEnrollment[]> {
    const rows = await this.store.db
      .prepare(
        "SELECT value FROM social_enrollments WHERE status='active' AND next_at IS NOT NULL AND next_at<=? ORDER BY next_at, id LIMIT ?",
      )
      .all(now, pageSize(limit));
    return rows.map((row) => parse<SequenceEnrollment>(row));
  }

  async listEnrollments(input: {
    sequenceId: string;
    cursor?: string;
    limit?: number;
  }): Promise<Page<SequenceEnrollment>> {
    const limit = pageSize(input.limit);
    const rows = await this.store.db
      .prepare(
        "SELECT id, value FROM social_enrollments WHERE sequence_id=? AND id>? ORDER BY id LIMIT ?",
      )
      .all(input.sequenceId, input.cursor ?? "", limit + 1);
    return pageOf(rows, limit, (row) => parse<SequenceEnrollment>(row));
  }

  /** Every enrollment of one person, any sequence. Capped at 200 rows, oldest id first. */
  async listEnrollmentsForPerson(personId: string): Promise<SequenceEnrollment[]> {
    const rows = await this.store.db
      .prepare("SELECT value FROM social_enrollments WHERE person_id=? ORDER BY id LIMIT 200")
      .all(personId);
    return rows.map((row) => parse<SequenceEnrollment>(row));
  }

  // Suppressions.

  async putSuppression(suppression: Suppression): Promise<Suppression> {
    await this.store.db
      .prepare(
        `INSERT INTO social_suppressions VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET person_id=excluded.person_id, platform=excluded.platform,
           platform_id=excluded.platform_id, email=excluded.email, channel=excluded.channel, value=excluded.value`,
      )
      .run(
        suppression.id,
        suppression.personId ?? null,
        suppression.handle?.platform ?? null,
        suppression.handle?.platformId ?? null,
        suppression.email?.trim().toLowerCase() ?? null,
        suppression.channel,
        JSON.stringify(suppression),
      );
    return suppression;
  }

  async deleteSuppression(id: string): Promise<boolean> {
    const result = await this.store.db
      .prepare("DELETE FROM social_suppressions WHERE id=?")
      .run(id);
    return Number(result.changes) > 0;
  }

  /**
   * Indexed lookup. Returns every suppression matching any given key: person, platform handle
   * (platform and platformId together) or email. At least one key is required so that a send
   * check can never scan the whole table.
   */
  async findSuppressions(query: {
    personId?: string;
    platform?: SocialPlatform;
    platformId?: string;
    email?: string;
  }): Promise<Suppression[]> {
    const clauses: string[] = [];
    const values: string[] = [];
    if (query.personId !== undefined) {
      clauses.push("person_id=?");
      values.push(query.personId);
    }
    if (query.platform !== undefined || query.platformId !== undefined) {
      if (query.platform === undefined || query.platformId === undefined)
        throw new Error("Handle lookup needs both platform and platformId.");
      clauses.push("platform=? AND platform_id=?");
      values.push(query.platform, query.platformId);
    }
    if (query.email !== undefined) {
      clauses.push("email=?");
      values.push(query.email.trim().toLowerCase());
    }
    if (!clauses.length) throw new Error("Suppression lookup needs a person, handle or email.");
    const rows = await this.store.db
      .prepare(`SELECT value FROM social_suppressions WHERE ${clauses.join(" OR ")}`)
      .all(...values);
    return rows.map((row) => parse<Suppression>(row));
  }

  async listSuppressions(
    input: { cursor?: string; limit?: number } = {},
  ): Promise<Page<Suppression>> {
    const limit = pageSize(input.limit);
    const rows = await this.store.db
      .prepare("SELECT id, value FROM social_suppressions WHERE id>? ORDER BY id LIMIT ?")
      .all(input.cursor ?? "", limit + 1);
    return pageOf(rows, limit, (row) => parse<Suppression>(row));
  }

  // AI action log.

  async putAiAction(action: AiAction): Promise<AiAction> {
    await this.store.db
      .prepare(
        `INSERT INTO social_ai_actions VALUES (?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET at=excluded.at, account_id=excluded.account_id, value=excluded.value`,
      )
      .run(action.id, action.at, action.accountId ?? "", JSON.stringify(action));
    return action;
  }

  /** Newest first. The cursor is "<at>:<id>" of the last row of the previous page. */
  async listAiActions(
    input: {
      cursor?: string;
      accountId?: string;
      limit?: number;
    } = {},
  ): Promise<Page<AiAction>> {
    const limit = pageSize(input.limit);
    const clauses: string[] = [];
    const values: (string | number)[] = [];
    if (input.accountId !== undefined) {
      clauses.push("account_id=?");
      values.push(input.accountId);
    }
    if (input.cursor !== undefined) {
      const separator = input.cursor.indexOf(":");
      const at = Number(input.cursor.slice(0, separator));
      if (separator < 1 || !Number.isFinite(at)) throw new Error("Invalid AI action cursor.");
      const id = input.cursor.slice(separator + 1);
      clauses.push("(at<? OR (at=? AND id<?))");
      values.push(at, at, id);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await this.store.db
      .prepare(
        `SELECT id, at, value FROM social_ai_actions ${where} ORDER BY at DESC, id DESC LIMIT ?`,
      )
      .all(...values, limit + 1);
    return pageOf(
      rows,
      limit,
      (row) => parse<AiAction>(row),
      undefined,
      (row) => `${row.at}:${row.id}`,
    );
  }

  // Autonomy counters.

  async getCounter(accountId: string, action: string, day: string): Promise<number> {
    const row = await this.store.db
      .prepare(
        "SELECT count FROM social_autonomy_counters WHERE account_id=? AND action=? AND day=?",
      )
      .get(accountId, action, day);
    return row ? Number(row.count) : 0;
  }

  async incrementCounter(accountId: string, action: string, day: string, by = 1): Promise<number> {
    if (!Number.isSafeInteger(by) || by < 1) throw new Error("Counter increment must be positive.");
    return this.store.transaction(async () => {
      await this.store.db
        .prepare(
          `INSERT INTO social_autonomy_counters VALUES (?,?,?,?)
           ON CONFLICT(account_id,action,day) DO UPDATE SET count=count+excluded.count`,
        )
        .run(accountId, action, day, by);
      return this.getCounter(accountId, action, day);
    });
  }

  // Settings and legacy reads.

  async getSetting(key: string): Promise<string | undefined> {
    const row = await this.store.db
      .prepare("SELECT value FROM social_settings WHERE key=?")
      .get(key);
    return row ? String(row.value) : undefined;
  }

  async putSetting(key: string, value: string): Promise<void> {
    await this.store.db
      .prepare(
        "INSERT INTO social_settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, value);
  }

  /** Every legacy `social_records` value of one kind, in insertion order. Migration only. */
  async legacyRecords<T>(kind: string): Promise<T[]> {
    return (
      await this.store.db
        .prepare("SELECT value FROM social_records WHERE kind=? ORDER BY rowid")
        .all(kind)
    ).map((row) => parse<T>(row));
  }
}

/** Builds a page from up to limit+1 rows; the extra row only proves another page exists. */
function pageOf<T>(
  rows: StoreRow[],
  limit: number,
  read: (row: StoreRow) => T,
  keyColumn = "id",
  keyOf?: (row: StoreRow) => string,
): Page<T> {
  const visible = rows.slice(0, limit);
  const items = visible.map(read);
  if (rows.length <= limit) return { items };
  const last = visible[visible.length - 1];
  return { items, next: keyOf ? keyOf(last) : String(last[keyColumn]) };
}

export type LegacyAudienceRecords = {
  accounts: SocialAccount[];
  contacts: SocialContact[];
  segments: SocialSegment[];
};

export type AudienceMigrationResult = {
  migrated: boolean;
  people: number;
  lists: number;
  suppressions: number;
};

/**
 * One-time conversion of legacy contacts, opt-outs and segments. Old records are never deleted,
 * and a second run is a no-op once `schema.audience` is set. Everything commits in one transaction.
 */
export async function migrateAudience(
  store: SocialAudienceStore,
  records?: LegacyAudienceRecords,
  now = Date.now(),
): Promise<AudienceMigrationResult> {
  const done: AudienceMigrationResult = { migrated: false, people: 0, lists: 0, suppressions: 0 };
  if ((await store.getSetting(AUDIENCE_SCHEMA_KEY)) === AUDIENCE_SCHEMA_VERSION) return done;
  const source = records ?? {
    accounts: await store.legacyRecords<SocialAccount>("account"),
    contacts: await store.legacyRecords<SocialContact>("contact"),
    segments: await store.legacyRecords<SocialSegment>("segment"),
  };
  const platforms = new Map(source.accounts.map((account) => [account.id, account.platform]));
  return store.transaction(async () => {
    const result: AudienceMigrationResult = { ...done, migrated: true };
    for (const contact of source.contacts) {
      const platform = platforms.get(contact.accountId);
      const handle: ContactHandle | undefined = platform
        ? {
            accountId: contact.accountId,
            platform,
            platformId: contact.platformId,
            contactId: contact.id,
            ...(contact.profileUrl ? { profileUrl: contact.profileUrl } : {}),
          }
        : undefined;
      // A contact whose platform handle already exists was converted before; skip it.
      if (handle && (await store.findPersonByHandle(handle.accountId, handle.platformId))) continue;
      const personId = `person-${contact.id}`;
      const person: SocialPerson = {
        id: personId,
        name: contact.name,
        handles: handle ? [handle] : [],
        emails: [],
        tags: [...contact.tags],
        notes: "",
        stage: contact.optedOut ? "opted_out" : "new",
        source: "migration",
        ...(contact.language ? { language: contact.language } : {}),
        projectIds: [...contact.projectIds],
        consent: contact.consent?.allowed ? { basis: "explicit" } : { basis: "none" },
        createdAt: now,
        updatedAt: now,
      };
      await store.putPerson(person);
      result.people++;
      if (contact.optedOut) {
        await store.putSuppression({
          id: `suppression-${contact.id}`,
          personId,
          ...(handle
            ? { handle: { platform: handle.platform, platformId: handle.platformId } }
            : {}),
          channel: "all",
          reason: "opt_out",
          source: "migration",
          at: now,
        });
        result.suppressions++;
      }
    }
    for (const segment of source.segments) {
      if (await store.getList(segment.id)) continue;
      await store.putList({
        id: segment.id,
        name: segment.name,
        kind: "dynamic",
        filter: {
          tags: [...segment.tags],
          ...(segment.language ? { language: segment.language } : {}),
        },
        projectIds: [...segment.projectIds],
        createdAt: now,
      });
      result.lists++;
    }
    if (!(await store.getList(SYSTEM_COMMENTERS_LIST_ID)))
      await store.putList({
        id: SYSTEM_COMMENTERS_LIST_ID,
        name: "Commenters",
        kind: "static",
        projectIds: [],
        system: "commenters",
        createdAt: now,
      });
    if (!(await store.getRecord("capture-rule", SYSTEM_COMMENTERS_RULE_ID)))
      await store.putRecord("capture-rule", SYSTEM_COMMENTERS_RULE_ID, {
        id: SYSTEM_COMMENTERS_RULE_ID,
        name: "Commenters",
        enabled: false,
        source: { kind: "own_post_comments", accountId: "" },
        filter: {},
        targetListId: SYSTEM_COMMENTERS_LIST_ID,
        system: "commenters",
        createdAt: now,
      });
    await store.putSetting(AUDIENCE_SCHEMA_KEY, AUDIENCE_SCHEMA_VERSION);
    return result;
  });
}

/** Reads one `social_records` row of any kind, without a principal check. Callers authorize. */
export async function readSocialRecord<T>(
  store: HostStore,
  kind: string,
  id: string,
): Promise<T | undefined> {
  const row = await store.db
    .prepare("SELECT value FROM social_records WHERE kind=? AND id=?")
    .get(kind, id);
  return row ? (JSON.parse(String(row.value)) as T) : undefined;
}
