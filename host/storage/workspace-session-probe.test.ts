import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { StoreDatabase } from "../store-db";
import {
  initializeWorkspaceSessionProbe,
  workspaceSessionCandidateArgs,
  workspaceSessionCandidatesSql,
} from "./workspace-session-probe";

it("uses indexed path candidates while retaining pending, legacy and ambiguous paths", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE session_state(id TEXT PRIMARY KEY, summary TEXT);
      CREATE INDEX session_state_workspace_probe ON session_state(json_extract(summary, '$.workspaceId')) WHERE json_valid(summary);`);
    await initializeWorkspaceSessionProbe(db as unknown as StoreDatabase);
    const add = db.prepare("INSERT INTO session_state VALUES (?, ?)");
    const base =
      process.platform === "win32" ? "C:\\bycoda-probe-fixture" : "/bycoda-probe-fixture";
    const root = join(base, "workspace_%");
    for (let index = 0; index < 2000; index++)
      add.run(`other-${index}`, JSON.stringify({ worktreeCwd: join(base, `unrelated-${index}`) }));
    add.run("nested", JSON.stringify({ worktreeCwd: join(root, "nested") }));
    add.run(
      "workspace",
      JSON.stringify({ workspaceId: "target", worktreeCwd: join(base, "other") }),
    );
    add.run("dot", JSON.stringify({ worktreeCwd: `${root}/nested/../same` }));
    add.run("double-slash", JSON.stringify({ worktreeCwd: `${root}//nested` }));
    add.run("single-dot", JSON.stringify({ worktreeCwd: `${root}/./nested` }));
    add.run("relative", JSON.stringify({ worktreeCwd: "../unknown" }));
    add.run(
      "platform-relative",
      JSON.stringify({ worktreeCwd: process.platform === "win32" ? "\\rooted" : "C:/relative" }),
    );
    add.run("unicode", JSON.stringify({ worktreeCwd: join(base, "İstanbul") }));
    add.run("legacy", "{");
    add.run("pending", JSON.stringify({ worktreeCwd: join(base, "elsewhere") }));
    const args = workspaceSessionCandidateArgs("target", root, ["pending"]);
    const ids = db
      .prepare(workspaceSessionCandidatesSql)
      .all(...args)
      .map((row) => row.id)
      .sort();
    expect(ids).toEqual([
      "dot",
      "double-slash",
      "legacy",
      "nested",
      "pending",
      "platform-relative",
      "relative",
      "single-dot",
      "unicode",
      "workspace",
    ]);
    const plan = db
      .prepare(`EXPLAIN QUERY PLAN ${workspaceSessionCandidatesSql}`)
      .all(...args)
      .map((row) => String(row.detail))
      .join("\n");
    expect(plan).toContain("session_state_workspace_probe");
    expect(plan).toContain("session_state_worktree_normalized_probe");
    expect(plan).toContain("session_state_worktree_ambiguous_probe");
  } finally {
    db.close();
  }
});
