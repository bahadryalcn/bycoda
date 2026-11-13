import type { HostStore } from "../store";

export type AutomationTransitionEvent = {
  id: string;
  kind: "task.finished" | "task.blocked" | "session.waiting" | "automation.failed";
  projectId?: string;
};

/** SQL triggers commit the event with its source transition, including journal checkpoints. */
export class AutomationEventOutbox {
  private readonly installed = new Set<string>();
  constructor(private readonly store: HostStore) {}

  async prepare(): Promise<void> {
    await this.store.ready;
    await this.store.db.exec(`CREATE TABLE IF NOT EXISTS automation_event_outbox (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL, project_id TEXT
    )`);
    const sources = [
      {
        table: "tasks",
        trigger: "automation_task_transition",
        when: "json_extract(OLD.value,'$.status') IS NOT json_extract(NEW.value,'$.status') AND json_extract(NEW.value,'$.status') IN ('done','blocked')",
        kind: "CASE json_extract(NEW.value,'$.status') WHEN 'done' THEN 'task.finished' ELSE 'task.blocked' END",
        project: "json_extract(NEW.value,'$.projectId')",
      },
      {
        table: "session_state",
        trigger: "automation_session_waiting_transition",
        when: "coalesce(json_extract(OLD.summary,'$.needsInput'),0)<>1 AND json_extract(NEW.summary,'$.needsInput')=1",
        kind: "'session.waiting'",
        project: "NEW.project_id",
      },
      {
        table: "automation_runs",
        trigger: "automation_failed_transition",
        // Event-triggered failures remain visible but cannot recursively spawn failure automations.
        when: "json_extract(OLD.value,'$.status') IS NOT 'failed' AND json_extract(NEW.value,'$.status')='failed' AND json_extract(NEW.value,'$.trigger') IS NOT 'event'",
        kind: "'automation.failed'",
        project:
          "(SELECT json_extract(value,'$.projectId') FROM automations WHERE id=NEW.automation_id)",
      },
    ];
    for (const source of sources) {
      if (this.installed.has(source.table)) continue;
      const exists = await this.store.db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
        .get(source.table);
      if (!exists) continue;
      await this.store.db
        .exec(`CREATE TRIGGER IF NOT EXISTS ${source.trigger} AFTER UPDATE ON ${source.table}
        WHEN ${source.when} BEGIN
          INSERT INTO automation_event_outbox(id,kind,project_id)
          VALUES ('transition:' || lower(hex(randomblob(16))),${source.kind},${source.project});
        END`);
      // Cache only once DDL commits; rollback must not leave a false installed flag.
      this.store.afterCommit(() => {
        this.installed.add(source.table);
      });
    }
  }

  async drain(consume: (event: AutomationTransitionEvent) => Promise<void>): Promise<void> {
    await this.prepare();
    await this.store.transaction(async () => {
      const events = await this.store.db
        .prepare(
          "SELECT sequence,id,kind,project_id FROM automation_event_outbox ORDER BY sequence LIMIT 100",
        )
        .all();
      for (const event of events) {
        await consume({
          id: String(event.id),
          kind: event.kind as AutomationTransitionEvent["kind"],
          ...(typeof event.project_id === "string" ? { projectId: event.project_id } : {}),
        });
        await this.store.db
          .prepare("DELETE FROM automation_event_outbox WHERE sequence=? AND id=?")
          .run(event.sequence, event.id);
      }
    }, "critical");
  }
}
