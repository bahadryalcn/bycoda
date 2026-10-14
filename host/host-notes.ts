import { DatabaseSync } from "node:sqlite";
import { desktopDatabasePaths } from "./desktopSessions";
import type { HostSessionSummary } from "../src/features/connections/model/protocol";
import type { HostTask } from "../src/features/tasks/model/hostTasks";
import type { HostGoal } from "../src/features/tasks/model/hostGoals";
import type { HostAutomation } from "../src/features/automations/model/hostAutomations";
import type { SocialThread } from "../src/features/social/model/social";

export type HostNote = {
  id: string;
  slug: string;
  title: string;
  body: string;
  tags: string[];
  sourceSessionId?: string;
  sourceCwd?: string;
  slugPending: boolean;
  createdAt: number;
  updatedAt: number;
};
type Row = Record<string, unknown>;
const noteFromRow = (row: Row): HostNote => ({
  id: String(row.id),
  slug: String(row.slug),
  title: String(row.title),
  body: String(row.body),
  tags: (() => {
    try {
      const v: unknown = JSON.parse(String(row.tags_json));
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  })(),
  ...(row.source_session_id ? { sourceSessionId: String(row.source_session_id) } : {}),
  ...(row.source_cwd ? { sourceCwd: String(row.source_cwd) } : {}),
  slugPending: row.slug_pending === 1,
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at),
});
function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value))
    throw new Error("Invalid note ID");
  return value;
}
const words = (title: string) =>
  title
    .replace(/[A-Z]/g, (character) => character.toLowerCase())
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const placeholder = (title: string) => /^untitled(?:-\d+)?$/.test(words(title));
const cut = (text: string, length: number) => Array.from(text).slice(0, length).join("");

/** Uses the desktop's existing note table. No separate notebook or DB migration. */
export class HostNotes {
  constructor(
    private readonly paths = desktopDatabasePaths,
    private readonly now = Date.now,
  ) {}
  // Distinguishes a new host instance from an older instance with the same write count.
  private version = Date.now();
  get revision() {
    return this.version;
  }

  private databases<T>(run: (db: DatabaseSync, path: string) => T, write = false): T[] {
    const paths = this.paths();
    if (!paths.length)
      throw new Error("Notes require an existing bycoda desktop database on this computer.");
    const results: T[] = [];
    for (const path of paths) {
      const db = new DatabaseSync(path, { readOnly: !write });
      try {
        db.exec("PRAGMA busy_timeout=2000");
        if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='notes'").get())
          continue;
        results.push(run(db, path));
      } finally {
        db.close();
      }
    }
    if (!results.length)
      throw new Error(
        "This computer's desktop database does not support notes. Update bycoda desktop.",
      );
    return results;
  }

  list(sourceCwd?: string) {
    const results = this.databases((db) => ({
      total: Number(
        (sourceCwd
          ? db.prepare("SELECT count(*) AS total FROM notes WHERE source_cwd=?").get(sourceCwd)
          : db.prepare("SELECT count(*) AS total FROM notes").get()
        )?.total ?? 0,
      ),
      notes: (sourceCwd
        ? db
            .prepare(
              "SELECT id,slug,title,substr(body,1,500) AS body,tags_json,source_session_id,source_cwd,slug_pending,created_at,updated_at FROM notes WHERE source_cwd=? ORDER BY updated_at DESC,id ASC LIMIT 500",
            )
            .all(sourceCwd)
        : db
            .prepare(
              "SELECT id,slug,title,substr(body,1,500) AS body,tags_json,source_session_id,source_cwd,slug_pending,created_at,updated_at FROM notes ORDER BY updated_at DESC,id ASC LIMIT 500",
            )
            .all()
      ).map(noteFromRow),
    }));
    const notes = results.flatMap((result) => result.notes);
    const seen = new Set<string>();
    for (const note of notes) {
      if (seen.has(note.id))
        throw new Error(
          "A note ID exists in multiple desktop databases; open the intended desktop profile.",
        );
      seen.add(note.id);
    }
    const filtered = notes
      .filter((note) => !sourceCwd || note.sourceCwd === sourceCwd)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return {
      notes: filtered
        .slice(0, 500)
        .map((note) => ({ ...note, body: cut(note.body, 500), preview: true as const })),
      total: results.reduce((sum, result) => sum + result.total, 0),
    };
  }

  get(raw: unknown, sourceCwd?: string): HostNote | null {
    const id = identifier(raw);
    const matches = this.databases((db) =>
      db.prepare("SELECT * FROM notes WHERE id=?").get(id),
    ).flatMap((row) => (row ? [row] : []));
    if (matches.length > 1) throw new Error("Ambiguous note ID across desktop profiles.");
    const note = matches[0] ? noteFromRow(matches[0]) : null;
    if (note && sourceCwd !== undefined && note.sourceCwd !== sourceCwd)
      throw new Error("Note belongs to another project.");
    return note;
  }

  private mutate<T>(
    id: string,
    expected: unknown,
    run: (db: DatabaseSync, existing: HostNote | null) => T,
    create = false,
    sourceCwd?: string,
  ): T {
    const locations = this.databases((db, path) => ({
      path,
      row: db.prepare("SELECT * FROM notes WHERE id=?").get(id),
    }));
    const matches = locations.filter((entry) => entry.row);
    if (matches.length > 1) throw new Error("Ambiguous note ID across desktop profiles.");
    const location = matches[0] ?? (create ? locations[0] : undefined);
    if (!location) throw new Error("Note no longer exists.");
    const db = new DatabaseSync(location.path);
    try {
      db.exec("PRAGMA busy_timeout=2000; BEGIN IMMEDIATE");
      const row = db.prepare("SELECT * FROM notes WHERE id=?").get(id);
      const note = row ? noteFromRow(row) : null;
      if (note && sourceCwd !== undefined && note.sourceCwd !== sourceCwd)
        throw new Error("Note belongs to another project.");
      if (note && expected !== note.updatedAt)
        throw new Error("This note changed on the computer. Refresh it before saving.");
      if (!note && expected !== 0)
        throw new Error("This note was deleted on the computer. Refresh your notes.");
      const result = run(db, note);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* transaction may not have started */
      }
      throw error;
    } finally {
      db.close();
    }
  }

  save(raw: unknown, expectedUpdatedAt: unknown, scopedCwd?: string): HostNote {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid note");
    const v = raw as Record<string, unknown>;
    const id = identifier(v.id);
    if (
      typeof v.title !== "string" ||
      typeof v.body !== "string" ||
      Buffer.byteLength(v.body, "utf8") > 1_000_000 ||
      !Array.isArray(v.tags) ||
      v.tags.some((tag) => typeof tag !== "string")
    )
      throw new Error("Invalid note content");
    if (v.sourceSessionId !== undefined && v.sourceSessionId !== "") identifier(v.sourceSessionId);
    if (
      v.sourceCwd !== undefined &&
      (typeof v.sourceCwd !== "string" || v.sourceCwd.length > 16_384 || v.sourceCwd.includes("\0"))
    )
      throw new Error("Invalid note project");
    const title = cut(v.title.trim(), 200).trim() || "Untitled";
    const body = v.body.replace(/\r\n?/g, "\n");
    const tags = [
      ...new Set(
        (v.tags as string[])
          .map((tag) =>
            cut(tag.trim().replace(/^#+/, "").replace(/\s+/g, "-").toLowerCase(), 48).replace(
              /-+$/,
              "",
            ),
          )
          .filter(Boolean),
      ),
    ].slice(0, 20);
    let effectiveChange = false;
    const result = this.mutate(
      id,
      expectedUpdatedAt,
      (db, existing) => {
        const now = this.now();
        let slug = existing?.slug;
        const pending = existing
          ? existing.slugPending && !(v.finalizeSlug === true && !placeholder(title))
          : placeholder(title);
        if (!slug || (existing?.slugPending && !pending)) {
          const base = words(title).slice(0, 48).replace(/-$/, "") || "note";
          slug = base;
          for (let index = 1; db.prepare("SELECT 1 FROM notes WHERE slug=?").get(slug); index++)
            slug = index < 1000 ? `${base}-${index + 1}` : `${base}-${now}-${index}`;
        }
        const changed =
          !existing ||
          title !== existing.title ||
          body !== existing.body ||
          JSON.stringify(tags) !== JSON.stringify(existing.tags);
        const sourceCwd =
          typeof v.sourceCwd === "string" && v.sourceCwd.trim()
            ? v.sourceCwd.trim()
            : existing?.sourceCwd;
        const sourceSessionId = existing
          ? existing.sourceSessionId
          : typeof v.sourceSessionId === "string" && v.sourceSessionId.trim()
            ? v.sourceSessionId.trim()
            : undefined;
        const note: HostNote = {
          id,
          slug,
          title,
          body,
          tags,
          ...(sourceCwd ? { sourceCwd } : {}),
          ...(sourceSessionId ? { sourceSessionId } : {}),
          slugPending: pending,
          createdAt: existing?.createdAt ?? now,
          updatedAt: changed ? Math.max(now, (existing?.updatedAt ?? 0) + 1) : existing!.updatedAt,
        };
        effectiveChange =
          changed ||
          existing?.slug !== slug ||
          existing?.slugPending !== pending ||
          existing?.sourceCwd !== sourceCwd;
        db.prepare(
          "INSERT INTO notes(id,slug,title,body,tags_json,source_session_id,source_cwd,slug_pending,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,title=excluded.title,body=excluded.body,tags_json=excluded.tags_json,source_cwd=excluded.source_cwd,slug_pending=excluded.slug_pending,updated_at=excluded.updated_at",
        ).run(
          id,
          slug,
          title,
          body,
          JSON.stringify(tags),
          sourceSessionId ?? null,
          sourceCwd ?? null,
          pending ? 1 : 0,
          note.createdAt,
          note.updatedAt,
        );
        return note;
      },
      true,
      scopedCwd,
    );
    if (effectiveChange) this.version++;
    return result;
  }

  delete(raw: unknown, expectedUpdatedAt: unknown, scopedCwd?: string) {
    const id = identifier(raw);
    const result = this.mutate(
      id,
      expectedUpdatedAt,
      (db) => {
        db.prepare("DELETE FROM notes WHERE id=?").run(id);
        return { deleted: true };
      },
      false,
      scopedCwd,
    );
    this.version++;
    return result;
  }
}

export type HostInboxItem = {
  id: string;
  kind: "session" | "task" | "goal" | "automation" | "social";
  resourceId: string;
  projectId?: string;
  title: string;
  detail: string;
  updatedAt: number;
  sessionId?: string;
  status?: string;
};
/** Attention queue from host-owned work. External issue-provider inboxes remain desktop-owned. */
export function hostInbox(
  data: {
    sessions: HostSessionSummary[];
    tasks: HostTask[];
    goals: HostGoal[];
    automations: HostAutomation[];
    threads: SocialThread[];
  },
  projectId?: string,
) {
  const items: HostInboxItem[] = [];
  for (const session of data.sessions)
    if (session.needsInput || session.status === "interrupted")
      items.push({
        id: `session:${session.id}`,
        kind: "session",
        resourceId: session.id,
        sessionId: session.id,
        projectId: session.projectId,
        title: session.title,
        detail: session.needsInput ? "Approval or answer needed" : "Session interrupted",
        updatedAt: session.updatedAt,
        status: session.status,
      });
  for (const task of data.tasks)
    if (task.status === "blocked" || task.status === "review")
      items.push({
        id: `task:${task.id}`,
        kind: "task",
        resourceId: task.id,
        projectId: task.projectId,
        sessionId: task.sessionId,
        title: task.title,
        detail:
          task.error ??
          task.mergeError ??
          (task.status === "review" ? "Review ready" : "Task blocked"),
        updatedAt: task.updatedAt,
        status: task.status,
      });
  for (const goal of data.goals)
    if (goal.status === "awaiting-approval" || goal.status === "blocked")
      items.push({
        id: `goal:${goal.id}`,
        kind: "goal",
        resourceId: goal.id,
        projectId: goal.leadProjectId,
        sessionId: goal.plannerSessionId,
        title: goal.title,
        detail: goal.error ?? goal.planError ?? "Plan approval needed",
        updatedAt: goal.updatedAt,
        status: goal.status,
      });
  for (const automation of data.automations)
    if (automation.needsInput || automation.lastRunStatus === "failed")
      items.push({
        id: `automation:${automation.id}`,
        kind: "automation",
        resourceId: automation.id,
        projectId: automation.projectId,
        sessionId: automation.lastSessionId,
        title: automation.name,
        detail: automation.lastRunError ?? "Automation needs input",
        updatedAt: automation.updatedAt,
        status: automation.lastRunStatus,
      });
  for (const thread of data.threads)
    items.push({
      id: `social:${thread.id}`,
      kind: "social",
      resourceId: thread.id,
      projectId: thread.projectId,
      title: thread.kind === "message" ? "Social message" : "Social comment",
      detail:
        thread.reviewReason ??
        thread.events.filter((event) => event.direction === "inbound").at(-1)?.text ??
        "",
      updatedAt: thread.lastInboundAt,
      status: thread.kind,
    });
  return {
    items: items
      .filter((item) => !projectId || item.projectId === projectId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 300),
    scope: "host-attention" as const,
    externalProviderInboxAvailable: false,
  };
}
