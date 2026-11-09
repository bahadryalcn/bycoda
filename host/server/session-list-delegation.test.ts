import { it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostSession } from "../../src/features/connections/model/protocol";
import { HostStore } from "../store";

it("refreshes legacy delegation metadata from canonical session with CAS", async () => {
  const directory = mkdtempSync(join(tmpdir(), "delegation-summary-"));
  const store = new HostStore(join(directory, "host.db"));
  try {
    const project = await store.addProject(directory, "Delegation");
    const parent = {
      parentSessionId: "parent",
      runId: "run",
      kind: "advisor",
      model: "m",
      startedAt: 1,
    };
    const child = {
      projectId: project.id,
      revision: 1,
      status: "idle",
      updatedAt: 100,
      session: {
        id: "child",
        cwd: directory,
        title: "child",
        harness: "codex",
        model: "codex:test",
        runtimeMode: "supervised",
        blocks: [],
        modelSettings: { delegationParent: JSON.stringify(parent) },
      },
    } as unknown as HostSession;
    await store.save(child, {});
    await store.db
      .prepare(
        "UPDATE session_state SET summary=json_remove(summary, '$.delegationParent') WHERE id=?",
      )
      .run("child");
    expect((await store.summaries(project.id))[0].delegationParent).toEqual(parent);
    const row = await store.db.prepare("SELECT summary FROM session_state WHERE id=?").get("child");
    expect(JSON.parse(String(row?.summary)).delegationParent).toEqual(parent);
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
