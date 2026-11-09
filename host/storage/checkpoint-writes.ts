import type { HostSession } from "../../src/features/connections/model/protocol";
import type { Block } from "../../src/features/sessions/model/session";

type Row = (string | number | null)[];
type Operation = { sql: string; rows: Row[] };

/** Construct writes in their publication order; the caller owns transaction and permit. */
export function checkpointWrites(
  value: HostSession,
  rows: { revision: number; event: unknown }[],
  revision: number,
  hasJournal: boolean,
  changes: { structural: boolean; changed: Map<string, Block> } | undefined,
  summaryJson: () => string,
  shellRunning: () => boolean,
): { operations: Operation[]; eventRows: Row[] } {
  const id = value.session.id;
  const incremental = changes && !changes.structural;
  const {
    blockRevisions: _revisions,
    session: { blocks, ...session },
    ...rest
  } = value;
  const blockRows: Row[] = [];
  for (const block of incremental ? changes.changed.values() : blocks) {
    const stamp = value.blockRevisions?.[block.id] ?? value.revision;
    if (stamp > revision) blockRows.push([id, block.id, stamp, JSON.stringify(block)]);
  }
  const journalOperation: Operation =
    incremental && hasJournal
      ? {
          sql: "UPDATE session_journal SET revision=?,metadata=? WHERE session_id=?",
          rows: [[value.revision, JSON.stringify({ ...rest, session }), id]],
        }
      : {
          sql: "INSERT INTO session_journal VALUES (?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET revision=excluded.revision,metadata=excluded.metadata,block_ids=excluded.block_ids",
          rows: [
            [
              id,
              value.revision,
              JSON.stringify({ ...rest, session }),
              JSON.stringify(blocks.map((block) => block.id)),
            ],
          ],
        };
  const eventRows: Row[] = rows.map((row) => [id, row.revision, JSON.stringify(row.event)]);
  const operations: Operation[] = [
    {
      sql: "INSERT INTO session_journal_blocks VALUES (?, ?, ?, ?) ON CONFLICT(session_id,block_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload",
      rows: blockRows,
    },
    journalOperation,
    {
      sql: "UPDATE session_state SET summary=?, revision=?, updated_at=?, status=?, has_desktop=?, desktop_updated_at=?, provider_session_id=?, harness=?, session_cwd=?, shell_running=? WHERE id=?",
      rows: [
        [
          summaryJson(),
          value.revision,
          value.updatedAt,
          value.status,
          value.desktop == null ? 0 : 1,
          value.desktop?.updatedAt ?? null,
          value.session.providerSessionId || null,
          value.session.harness ?? null,
          value.session.cwd ?? null,
          shellRunning() ? 1 : 0,
          id,
        ],
      ],
    },
    { sql: "INSERT INTO events VALUES (?, ?, ?)", rows: eventRows },
    {
      sql: "DELETE FROM events WHERE session_id=? AND revision<?",
      rows: [[id, value.revision - 2000]],
    },
  ];
  return { operations, eventRows };
}
