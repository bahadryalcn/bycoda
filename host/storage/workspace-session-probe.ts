import { workspacePathKey } from "../workspaces/workspace-paths";
import type { HostSession } from "../../src/features/connections/model/protocol";
import type { StoreDatabase } from "../store-db";

// SQLite lower() only folds ASCII. Non-ASCII and non-canonical spellings go
// through the conservative branch; the caller still checks inWorkspace().
const pathValue = "json_extract(summary, '$.worktreeCwd')";
const normalized = `lower(replace(CAST(${pathValue} AS TEXT), char(92), '/'))`;
const nonNull = `json_valid(summary) AND ${pathValue} IS NOT NULL`;
const windows = process.platform === "win32";
const absolute = windows ? `${normalized} GLOB '[a-z]:/*'` : `substr(${normalized}, 1, 1) = '/'`;
const platformAmbiguity = windows ? "0" : `instr(CAST(${pathValue} AS TEXT), char(92)) > 0`;
const ambiguityIndex = `session_state_worktree_ambiguous_probe_${windows ? "win" : "posix"}`;
const ambiguous = `CASE WHEN json_type(summary, '$.worktreeCwd') <> 'text'
  OR ${normalized} GLOB '*[^ -~]*' OR instr(${normalized}, '..') > 0
  OR instr(${normalized}, '//') > 0 OR instr(${normalized}, '/./') > 0
  OR substr(${normalized}, -2) = '/.'
  OR ${platformAmbiguity} OR NOT (${absolute})
  THEN 1 ELSE 0 END`;

export async function initializeWorkspaceSessionProbe(db: StoreDatabase): Promise<void> {
  await db.exec(`CREATE INDEX IF NOT EXISTS session_state_worktree_normalized_probe ON session_state (${normalized}) WHERE ${nonNull};
    CREATE INDEX IF NOT EXISTS ${ambiguityIndex} ON session_state (${ambiguous}) WHERE ${nonNull};
    CREATE INDEX IF NOT EXISTS session_state_invalid_summary_probe ON session_state (id) WHERE NOT json_valid(summary);`);
}

export const workspaceSessionCandidatesSql = `SELECT id FROM session_state WHERE json_valid(summary) AND json_extract(summary, '$.workspaceId')=?
  UNION SELECT id FROM session_state WHERE ${nonNull} AND ${normalized}=?
  UNION SELECT id FROM session_state WHERE ${nonNull} AND ${normalized}>=? AND ${normalized}<?
  UNION SELECT id FROM session_state WHERE ${nonNull} AND ${ambiguous}=1
  UNION SELECT id FROM session_state WHERE NOT json_valid(summary)
  UNION SELECT value FROM json_each(?)`;

export function workspaceSessionCandidateArgs(
  id: string,
  root: string,
  pending: readonly string[],
): [string, string, string, string, string] {
  const normalizedRoot = workspacePathKey(root).replaceAll("\\", "/").toLowerCase();
  const prefix = normalizedRoot.endsWith("/") ? normalizedRoot : `${normalizedRoot}/`;
  return [id, normalizedRoot, prefix, `${prefix.slice(0, -1)}0`, JSON.stringify(pending)];
}

export async function startupSessionStates(
  db: StoreDatabase,
  pendingIds: readonly string[],
  pending: (id: string) => HostSession | undefined,
  session: (id: string) => Promise<HostSession>,
  candidateWorkspaceId?: string,
  candidatePath?: string,
) {
  const columns = `SELECT id, project_id, revision, has_desktop, status, shell_running, provider_session_id, harness, session_cwd,
    json_valid(summary) AS summary_valid,
    CASE WHEN json_valid(summary) THEN json_extract(summary, '$.workspaceId') END AS workspace_id,
    CASE WHEN json_valid(summary) THEN json_extract(summary, '$.worktreeCwd') END AS worktree_cwd,
    EXISTS(SELECT 1 FROM host_authority_heads h WHERE h.session_id=session_state.id) AS has_authority FROM session_state`;
  const rows =
    candidateWorkspaceId === undefined
      ? await db.prepare(`${columns} ORDER BY updated_at DESC`).all()
      : candidatePath === undefined
        ? await db
            .prepare(
              `${columns} WHERE id IN (SELECT id FROM session_state WHERE json_valid(summary) AND json_extract(summary, '$.workspaceId')=? UNION SELECT id FROM session_state WHERE json_valid(summary) AND json_extract(summary, '$.worktreeCwd') IS NOT NULL UNION SELECT id FROM session_state WHERE NOT json_valid(summary) UNION SELECT value FROM json_each(?))`,
            )
            .all(candidateWorkspaceId, JSON.stringify(pendingIds))
        : await db
            .prepare(`${columns} WHERE id IN (${workspaceSessionCandidatesSql})`)
            .all(...workspaceSessionCandidateArgs(candidateWorkspaceId, candidatePath, pendingIds));
  const legacy = new Map<string, HostSession>();
  for (const row of rows) {
    const id = String(row.id);
    if (!Number(row.summary_valid) && !pending(id)) legacy.set(id, await session(id));
  }
  return rows.map((row) => {
    const unwritten = pending(String(row.id)) ?? legacy.get(String(row.id));
    if (unwritten)
      return {
        id: unwritten.session.id,
        projectId: unwritten.projectId,
        revision: unwritten.revision,
        status: unwritten.status,
        hasAuthority: unwritten.authorityGeneration !== undefined || !!Number(row.has_authority),
        hasDesktop: unwritten.desktop != null,
        running: unwritten.status === "running",
        shellRunning: unwritten.session.blocks.some(
          (block) => block.shell?.running || block.shell?.terminationFailed,
        ),
        workspaceId: unwritten.session.workspaceId,
        worktreeCwd: unwritten.session.worktreeCwd,
        providerSessionId: unwritten.session.providerSessionId || null,
        harness: unwritten.session.harness ?? null,
        cwd: unwritten.session.cwd ?? null,
      };
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      revision: Number(row.revision),
      status: String(row.status) as HostSession["status"],
      hasAuthority: !!Number(row.has_authority),
      hasDesktop: !!Number(row.has_desktop),
      running: row.status === "running",
      shellRunning: !!Number(row.shell_running),
      workspaceId: row.workspace_id == null ? undefined : String(row.workspace_id),
      worktreeCwd: row.worktree_cwd == null ? undefined : String(row.worktree_cwd),
      providerSessionId: row.provider_session_id ? String(row.provider_session_id) : null,
      harness: row.harness == null ? null : String(row.harness),
      cwd: row.session_cwd == null ? null : String(row.session_cwd),
    };
  });
}
