import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CommandReceipt, HostSession } from "../src/features/connections/model/protocol";
import { HostStore, summary } from "./store";
import { sessionIssue } from "../src/features/sessions/model/sessionIssue";
import { sessionNeedsInput, type Block } from "../src/features/sessions/model/session";
import { registerBlockChanges } from "../src/features/sessions/model/blockChanges";
import { HostEngine } from "./engine";
import type {
  ManagedWorkspace,
  WorkspaceCreateOperation,
  WorkspaceFeatureClaim,
  WorkspaceRewindOperation,
} from "./workspaces/workspace-contracts";
const cleanups: Array<() => void | Promise<void>> = [];
describe("durable desktop command receipts", () => {
  const identity = () => ({
    commandId: "desktop-control",
    sessionId: "session",
    signature: "signature",
    principalId: "principal",
    ownerId: "physical-owner",
    delivery: '{"type":"cancel"}',
    receipt: { commandId: "desktop-control", sessionId: "session", revision: 17 },
  });
  it("survives restart and pruning while preserving exact acceptance and one offer", async () => {
    const path = join(open(), "desktop-command.db");
    let store = new HostStore(path);
    const input = identity();
    expect(await store.acceptDesktopCommand(input, async () => {})).toEqual(input.receipt);
    expect(
      await store.acceptDesktopCommand(
        { ...input, receipt: { ...input.receipt, revision: 99 } },
        async () => {},
      ),
    ).toEqual(input.receipt);
    await expect(
      store.acceptDesktopCommand({ ...input, delivery: "other" }, async () => {}),
    ).rejects.toThrow(/different/);
    await expect(store.desktopCommandStatus(input.commandId, "foreign")).rejects.toThrow(
      /principal/,
    );
    await expect(store.desktopCommandStatus(input.commandId, undefined)).rejects.toThrow(
      /principal/,
    );
    expect(await store.desktopCommandStatus("non-desktop", undefined)).toBeUndefined();
    const results = await Promise.all([
      store.offerDesktopCommand(input.commandId, input.ownerId, async () => {}),
      store.offerDesktopCommand(input.commandId, input.ownerId, async () => {}),
    ]);
    expect(results.filter(Boolean)).toEqual([input.delivery]);
    await store.close();
    store = new HostStore(path);
    cleanups.push(() => store.close());
    expect(await store.desktopCommandStatus(input.commandId, input.principalId)).toEqual(
      input.receipt,
    );
    await store.pruneReceipts(Date.now() + 30 * 24 * 3600000);
    expect(await store.receiptStatus(input.commandId)).toBeUndefined();
    await expect(store.receipt(input.commandId, input.signature)).rejects.toThrow(
      /desktop control/,
    );
    await store.ackDesktopCommand(input.commandId, input.ownerId, async () => {});
    expect(
      await store.offerDesktopCommand(input.commandId, input.ownerId, async () => {}),
    ).toBeUndefined();
  });
  it("holds an unoffered acceptance after Host restart", async () => {
    const path = join(open(), "desktop-unoffered.db");
    const first = new HostStore(path);
    const input = identity();
    await first.acceptDesktopCommand(input, async () => {});
    await first.close();
    const reopened = new HostStore(path);
    cleanups.push(() => reopened.close());
    expect(await reopened.desktopCommandStatus(input.commandId, input.principalId)).toEqual(
      input.receipt,
    );
    expect(
      await reopened.offerDesktopCommand(input.commandId, input.ownerId, async () => {}),
    ).toBeUndefined();
  });
  it("does not publish acceptance or offer when owner revalidation fails", async () => {
    const store = new HostStore(join(open(), "desktop-revalidation.db"));
    cleanups.push(() => store.close());
    const input = identity();
    await expect(
      store.acceptDesktopCommand(input, async () => {
        throw new Error("revoked");
      }),
    ).rejects.toThrow("revoked");
    expect(await store.receiptStatus(input.commandId)).toBeUndefined();
    await store.acceptDesktopCommand(input, async () => {});
    await expect(
      store.offerDesktopCommand(input.commandId, "other", async () => {}),
    ).rejects.toThrow(/owner/);
    await expect(
      store.offerDesktopCommand(input.commandId, input.ownerId, async () => {
        throw new Error("retired");
      }),
    ).rejects.toThrow("retired");
    expect(await store.offerDesktopCommand(input.commandId, input.ownerId, async () => {})).toBe(
      input.delivery,
    );
  });
  it("refuses a desktop command ID already accepted by the Host", async () => {
    const store = new HostStore(join(open(), "desktop-collision.db"));
    cleanups.push(() => store.close());
    const input = identity();
    await store.recordReceipt(input.signature, input.receipt);
    await expect(store.acceptDesktopCommand(input, async () => {})).rejects.toThrow(
      /another command/,
    );
  });
  it("captures immutable acceptance before asynchronous authority checks", async () => {
    const store = new HostStore(join(open(), "desktop-capture.db"));
    cleanups.push(() => store.close());
    const input = identity();
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const pending = store.acceptDesktopCommand(input, () => gate);
    input.ownerId = "other";
    input.delivery = "other";
    input.receipt.revision = 99;
    resume();
    expect(await pending).toEqual({
      commandId: "desktop-control",
      sessionId: "session",
      revision: 17,
    });
    expect(
      await store.offerDesktopCommand("desktop-control", "physical-owner", async () => {}),
    ).toBe('{"type":"cancel"}');
  });
});
describe("managed workspace persistence", () => {
  it("hydrates legacy summaries in bounded batches without overwriting newer projections", async () => {
    const store = new HostStore(join(open(), "summary-batches.db"));
    cleanups.push(() => store.close());
    const project = await store.addProject("/summary-batches", "Summaries");
    for (let i = 0; i < 40; i++)
      await store.save(session(`legacy-${i}`, project.id, { updatedAt: i }), {});
    await store.db
      .prepare("UPDATE session_state SET summary=? WHERE project_id=?")
      .run("{}", project.id);
    const original = store.session.bind(store);
    let active = 0,
      peak = 0,
      changed = false;
    const spy = vi.spyOn(store, "session").mockImplementation(async (id) => {
      active++;
      peak = Math.max(peak, active);
      const value = await original(id);
      if (!changed) {
        changed = true;
        await store.db
          .prepare("UPDATE session_state SET revision=revision+1,summary=? WHERE id=?")
          .run('{"newer":true}', id);
      }
      active--;
      return value;
    });
    const summaries = await store.summaries(project.id);
    expect(peak).toBeLessThanOrEqual(32);
    expect(summaries).toHaveLength(40);
    expect(summaries.map((value) => value.updatedAt)).toEqual(
      summaries.map((value) => value.updatedAt).sort((a, b) => b - a),
    );
    expect(
      await store.db
        .prepare("SELECT count(*) AS n FROM session_state WHERE summary=?")
        .get('{"newer":true}'),
    ).toMatchObject({ n: 1 });
    spy.mockRestore();
  });
  it("keeps the summaries of every registered project cached, not only the last 16", async () => {
    const store = new HostStore(join(open(), "summary-capacity.db"));
    cleanups.push(() => store.close());
    const ids: string[] = [];
    for (let index = 0; index < 40; index++) {
      const project = await store.addProject(`/summary-capacity-${index}`, `P${index}`);
      await store.save(session(`capacity-${index}`, project.id), {});
      ids.push(project.id);
    }
    for (const id of ids) await store.summaries(id);
    const prepare = vi.spyOn(store.db, "prepare");
    for (const id of ids) expect(await store.summaries(id)).toHaveLength(1);
    const reads = prepare.mock.calls.filter(([sql]) =>
      String(sql).includes("FROM session_state WHERE project_id"),
    );
    prepare.mockRestore();
    expect(reads).toHaveLength(0);
  });
  it("does not refresh a legacy summary after authority transfers during hydration", async () => {
    const store = new HostStore(join(open(), "summary-authority.db"));
    cleanups.push(() => store.close());
    const project = await store.addProject("/summary-authority", "Authority");
    await store.save(session("authority-session", project.id), {});
    await store.db
      .prepare("UPDATE session_state SET summary=? WHERE id=?")
      .run("{}", "authority-session");
    const original = store.session.bind(store);
    const spy = vi.spyOn(store, "session").mockImplementation(async (id) => {
      const value = await original(id);
      await store.db
        .prepare(
          "INSERT INTO host_authority_heads(environment_id,session_id,generation,migration_id,phase) VALUES(?,?,?,?,?)",
        )
        .run("env", id, 1, "migration", "active");
      return value;
    });
    await store.summaries(project.id);
    expect(
      await store.db
        .prepare("SELECT summary FROM session_state WHERE id=?")
        .get("authority-session"),
    ).toMatchObject({ summary: "{}" });
    spy.mockRestore();
  });
  it("keeps provider history in cold summaries after reopen", async () => {
    const path = join(open(), "provider-history.db");
    const store = new HostStore(path);
    cleanups.push(() => store.close());
    const project = await store.addProject("/provider-history", "History");
    const value = session("history", project.id);
    value.session.harness = "codex";
    value.session.blocks = [
      {
        id: "u1",
        role: "user",
        text: "First",
        turnModel: { harness: "claude", id: "opus", name: "Opus" },
      },
      {
        id: "h",
        role: "handoff",
        text: "",
        handoff: { from: "claude", to: "codex", status: "ready" },
      },
      {
        id: "u2",
        role: "user",
        text: "Continue",
        turnModel: { harness: "codex", id: "gpt", name: "GPT" },
      },
    ];
    const expected = {
      providers: ["claude", "codex"],
      activeHarness: "codex",
      activeModel: "GPT",
      handedOffFrom: "claude",
    };
    await store.save(value, {});
    expect((await store.summaries(project.id))[0].providerHistory).toEqual(expected);
    await store.close();
    const reopened = new HostStore(path);
    cleanups.push(() => reopened.close());
    expect((await reopened.summaries(project.id))[0].providerHistory).toEqual(expected);
  });
  it("retains optional session workspace identity in summaries after reopen", async () => {
    const path = join(open(), "workspace-summary.db"),
      store = new HostStore(path);
    cleanups.push(() => store.close());
    const project = await store.addProject("/workspace-summary", "Workspace summary");
    const legacy = session("legacy-session", project.id),
      managed = session("managed-session", project.id);
    managed.session.workspaceId = "authoritative-workspace";
    await store.save(legacy, {});
    await store.save(managed, {});
    expect(
      (await store.summaries(project.id)).find((row) => row.id === managed.session.id)?.workspaceId,
    ).toBe("authoritative-workspace");
    expect(
      (await store.summaries(project.id)).find((row) => row.id === legacy.session.id)?.workspaceId,
    ).toBeUndefined();
    await store.close();
    const reopened = new HostStore(path);
    cleanups.push(() => reopened.close());
    expect(
      (await reopened.summaries(project.id)).find((row) => row.id === managed.session.id)
        ?.workspaceId,
    ).toBe("authoritative-workspace");
    expect(
      (await reopened.summaries(project.id)).find((row) => row.id === legacy.session.id)
        ?.workspaceId,
    ).toBeUndefined();
  });
  function workspace(id = "workspace-1"): ManagedWorkspace {
    return {
      id,
      repositoryId: "canonical-repository",
      projectId: "project",
      environmentId: "host",
      owner: { kind: "session", id: `session-${id}` },
      path: `/managed/${id}`,
      branchRef: `refs/heads/by/test-${id}`,
      baseRef: "refs/heads/main",
      baseCommit: "a".repeat(40),
      targetBranchRef: "refs/heads/main",
      state: "idle",
      directoryState: "present",
      revision: 0,
      lastActivityAt: 100,
      pinned: false,
    };
  }
  function operation(value: ManagedWorkspace): WorkspaceCreateOperation {
    return {
      id: `create-${value.id}`,
      workspaceId: value.id,
      kind: "create",
      idempotencyKey: "create-key",
      expectedRevision: 0,
      phase: "prepared",
      createdAt: 100,
      updatedAt: 100,
      plannedWorkspace: value,
    };
  }
  async function setup() {
    const path = join(open(), "workspaces.db"),
      store = new HostStore(path);
    cleanups.push(() => store.close());
    await store.ready;
    return { store, path };
  }
  it("keeps ownership, journal, policy, claims and receipts across reopening", async () => {
    const { store, path } = await setup(),
      value = workspace(),
      journal = operation(value);
    const claim: WorkspaceFeatureClaim = {
      id: "claim",
      repositoryId: value.repositoryId,
      projectId: value.projectId,
      workspaceId: value.id,
      featureKey: "editor",
      owner: value.owner,
      branchRef: value.branchRef,
      acquiredAt: 101,
    };
    await store.transaction(async () => {
      await store.insertManagedWorkspace(value);
      await store.saveWorkspaceOperation(journal, null);
      await store.saveWorkspacePolicy(value.repositoryId, "host", { defaultMode: "current" }, 0);
      await store.insertWorkspaceFeatureClaim(claim);
      await store.saveWorkspaceReceipt(
        "prepare",
        "key",
        { a: 1, nested: { z: 2, b: 3 } },
        { workspaceId: value.id },
      );
    });
    await store.close();
    const reopened = new HostStore(path);
    cleanups.push(() => reopened.close());
    expect(await reopened.managedWorkspace(value.id)).toEqual(value);
    expect(await reopened.workspaceOperation(journal.id)).toEqual(journal);
    expect(await reopened.findWorkspaceOperation(journal)).toEqual(journal);
    expect(await reopened.workspacePolicy(value.repositoryId, "host")).toEqual({
      revision: 1,
      policy: { defaultMode: "current" },
    });
    expect(await reopened.workspaceFeatureClaims({ repositoryId: value.repositoryId })).toEqual([
      claim,
    ]);
    expect(
      await reopened.workspaceReceipt("prepare", "key", { nested: { b: 3, z: 2 }, a: 1 }),
    ).toEqual({ workspaceId: value.id });
    await expect(reopened.workspaceReceipt("prepare", "key", { a: 2 })).rejects.toMatchObject({
      code: "WORKSPACE_IDEMPOTENCY_CONFLICT",
    });
    expect(await reopened.managedWorkspaces({ states: [] })).toEqual([]);
    expect(await reopened.managedWorkspaces({ environmentId: "other" })).toEqual([]);
    expect(
      await reopened.managedWorkspaces({ repositoryId: value.repositoryId, states: ["idle"] }),
    ).toEqual([value]);
  });
  it("rolls back an atomic reservation with its operation and receipt", async () => {
    const { store } = await setup(),
      value = workspace(),
      journal = operation(value);
    await expect(
      store.transaction(async () => {
        await store.insertManagedWorkspace(value);
        await store.saveWorkspaceOperation(journal, null);
        await store.saveWorkspaceReceipt("prepare", "key", {}, { id: value.id });
        throw new Error("interrupt before commit");
      }),
    ).rejects.toThrow("interrupt before commit");
    expect(await store.managedWorkspace(value.id)).toBeNull();
    expect(await store.workspaceOperations()).toEqual([]);
    expect(await store.workspaceReceipt("prepare", "key", {})).toBeNull();
  });
  it("rejects stale workspace writes and duplicate writer or branch ownership", async () => {
    const { store } = await setup(),
      value = workspace();
    await store.insertManagedWorkspace(value);
    const outcomes = await Promise.allSettled([
      store.updateManagedWorkspace({ ...value, state: "finished", revision: 1 }, 0),
      store.updateManagedWorkspace({ ...value, state: "abandoned", revision: 1 }, 0),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await store.managedWorkspace(value.id))?.revision).toBe(1);
    await expect(
      store.updateManagedWorkspace({ ...value, path: "/other", revision: 2 }, 1),
    ).rejects.toThrow("immutable");
    await expect(
      store.insertManagedWorkspace({ ...workspace("other"), owner: value.owner }),
    ).rejects.toThrow();
    await expect(
      store.insertManagedWorkspace({ ...workspace("other"), branchRef: value.branchRef }),
    ).rejects.toThrow();
    expect(await store.managedWorkspaces()).toHaveLength(1);
  });
  it("compares operation phase and preserves recovery metadata", async () => {
    const { store } = await setup(),
      journal = operation(workspace());
    await store.saveWorkspaceOperation(journal, null);
    await store.saveWorkspaceOperation(
      { ...journal, phase: "registered", updatedAt: 101 },
      "prepared",
    );
    await expect(
      store.saveWorkspaceOperation({ ...journal, phase: "materialized" }, "prepared"),
    ).rejects.toMatchObject({ code: "WORKSPACE_OPERATION_CONFLICT" });
    await expect(
      store.saveWorkspaceOperation({ ...journal, phase: "blocked" }, "registered"),
    ).rejects.toThrow("recovery phase");
    await store.saveWorkspaceOperation(
      {
        ...journal,
        phase: "blocked",
        resumePhase: "registered",
        error: { code: "IO", message: "interrupted" },
      },
      "registered",
    );
    expect(await store.workspaceOperation(journal.id)).toMatchObject({
      phase: "blocked",
      resumePhase: "registered",
    });
    await expect(
      store.saveWorkspaceOperation({ ...journal, idempotencyKey: "different" }, "blocked"),
    ).rejects.toThrow("immutable");
  });
  it("freezes creation and reviewed plans while allowing recovery progress", async () => {
    const { store } = await setup(),
      creation = operation(workspace());
    await store.saveWorkspaceOperation(creation, null);
    for (const changes of [
      { path: "/unowned-directory" },
      { branchRef: "refs/heads/main" },
      { baseCommit: "b".repeat(40) },
      { owner: { kind: "session" as const, id: "another-owner" } },
    ])
      await expect(
        store.saveWorkspaceOperation(
          {
            ...creation,
            phase: "registered",
            plannedWorkspace: { ...creation.plannedWorkspace, ...changes },
          },
          "prepared",
        ),
      ).rejects.toThrow("plan is immutable");
    expect(await store.workspaceOperation(creation.id)).toEqual(creation);
    const rewind: WorkspaceRewindOperation = {
      id: "rewind-operation",
      workspaceId: creation.workspaceId,
      kind: "rewind",
      phase: "prepared",
      idempotencyKey: "rewind-key",
      expectedRevision: 0,
      createdAt: 100,
      updatedAt: 100,
      plan: {
        token: "reviewed-token",
        expiresAt: 1000,
        direction: "rewind",
        workspaceId: creation.workspaceId,
        sessionId: "session",
        userBlockId: "boundary",
        expectedRevision: 0,
        expectedConversationRevision: 1,
        branchRef: creation.plannedWorkspace.branchRef,
        currentHead: "a".repeat(40),
        targetHead: "b".repeat(40),
        statusFingerprint: "reviewed-state",
        removedUserBlockIds: ["later-turn"],
        affectedCommits: [],
        affectedPaths: ["source.ts"],
        blockers: [],
        published: false,
        merged: false,
      },
    };
    await store.saveWorkspaceOperation(rewind, null);
    for (const changes of [
      { targetHead: "c".repeat(40) },
      { token: "unreviewed-token" },
      { statusFingerprint: "different-state" },
      { removedUserBlockIds: ["other-turn"] },
    ])
      await expect(
        store.saveWorkspaceOperation(
          {
            ...rewind,
            phase: "git-restored",
            plan: { ...rewind.plan, ...changes },
          },
          "prepared",
        ),
      ).rejects.toThrow("plan is immutable");
    await store.saveWorkspaceOperation(
      {
        ...rewind,
        phase: "git-restored",
        transcriptRescueId: "private-rescue",
        updatedAt: 101,
      },
      "prepared",
    );
    expect(await store.workspaceOperation(rewind.id)).toMatchObject({
      phase: "git-restored",
      transcriptRescueId: "private-rescue",
      plan: rewind.plan,
    });
  });
  it("serializes policy compare-and-set and binds claim removal to its workspace", async () => {
    const { store } = await setup(),
      value = workspace();
    await store.saveWorkspacePolicy("repository", "host", { defaultMode: "worktree" }, 0);
    await expect(store.saveWorkspacePolicy("repository", "host", {}, 0)).rejects.toMatchObject({
      code: "WORKSPACE_POLICY_REVISION_CONFLICT",
    });
    const claim: WorkspaceFeatureClaim = {
      id: "claim",
      repositoryId: value.repositoryId,
      projectId: value.projectId,
      featureKey: "feature",
      workspaceId: value.id,
      owner: value.owner,
      branchRef: value.branchRef,
      acquiredAt: 100,
    };
    await store.insertWorkspaceFeatureClaim(claim);
    await expect(store.insertWorkspaceFeatureClaim({ ...claim, id: "other" })).rejects.toThrow();
    expect(await store.deleteWorkspaceFeatureClaim(claim.id, "other-workspace")).toBe(false);
    expect(await store.deleteWorkspaceFeatureClaim(claim.id, value.id)).toBe(true);
    expect(await store.workspaceFeatureClaims({ featureKey: "feature" })).toEqual([]);
  });
});
describe("incremental project summaries", () => {
  it("patches streamed summaries without rereading unchanged project rows", async () => {
    const store = new HostStore(join(open(), "summaries.db"));
    cleanups.push(async () => await store.close());
    const project = await store.addProject("/summaries", "Summaries");
    let value = await store.save(session("stream", project.id, { status: "running" }), {});
    await store.save(session("other", project.id), {});
    expect(await store.summaries(project.id)).toHaveLength(2);
    const prepare = vi.spyOn(store.db, "prepare");
    try {
      for (let index = 1; index <= 10; index++) {
        value = await store.save(
          { ...value, revision: value.revision + 1, updatedAt: value.updatedAt + 1 },
          {},
          { deferred: true },
        );
        const list = await store.summaries(project.id);
        expect((await list.find((item) => item.id === "stream"))?.revision).toBe(value.revision);
        list.pop();
        expect(await store.summaries(project.id)).toHaveLength(2);
      }
      expect(
        prepare.mock.calls.filter(([sql]) =>
          String(sql).startsWith("SELECT id, summary FROM session_state"),
        ),
      ).toHaveLength(0);
    } finally {
      prepare.mockRestore();
    }
  });
  it("does not retain transaction rows after rollback or another writer's update", async () => {
    const path = join(open(), "summary-rollback.db"),
      store = new HostStore(path);
    cleanups.push(async () => await store.close());
    const project = await store.addProject("/summary-rollback", "Rollback");
    const base = await store.save(session("s", project.id), {});
    const title = (await store.summaries(project.id))[0].title;
    await expect(
      (async () =>
        await store.transaction(async () => {
          await store.save(
            {
              ...base,
              revision: base.revision + 1,
              session: { ...base.session, title: "uncommitted" },
            },
            {},
          );
          expect((await store.summaries(project.id))[0].title).toBe("uncommitted");
          throw new Error("rollback");
        }, "critical"))(),
    ).rejects.toThrow("rollback");
    expect((await store.summaries(project.id))[0].title).toBe(title);
    const writer = new DatabaseSync(path);
    try {
      writer
        .prepare("UPDATE session_state SET summary=? WHERE id=?")
        .run(JSON.stringify({ ...summary(base), title: "external" }), "s");
      expect((await store.summaries(project.id))[0].title).toBe("external");
    } finally {
      await writer.close();
    }
  });
  it("reparses only the summary an external writer changed on a cache miss", async () => {
    const path = join(open(), "summary-reuse.db"),
      store = new HostStore(path);
    cleanups.push(async () => await store.close());
    const project = await store.addProject("/summary-reuse", "Reuse");
    await store.save(session("stable", project.id), {});
    const moving = await store.save(session("moving", project.id), {});
    expect(await store.summaries(project.id)).toHaveLength(2);
    const writer = new DatabaseSync(path);
    try {
      writer
        .prepare("UPDATE session_state SET summary=? WHERE id=?")
        .run(JSON.stringify({ ...summary(moving), title: "external" }), "moving");
      const parse = vi.spyOn(JSON, "parse");
      try {
        const list = await store.summaries(project.id);
        expect(list.find((row) => row.id === "moving")?.title).toBe("external");
        expect(parse.mock.calls.some(([text]) => String(text).includes('"id":"moving"'))).toBe(
          true,
        );
        expect(
          parse.mock.calls.filter(([text]) => String(text).includes('"id":"stable"')),
        ).toHaveLength(0);
      } finally {
        parse.mockRestore();
      }
    } finally {
      await writer.close();
    }
  });
  it("keeps the cached row count equal to the rows held across projects", async () => {
    const store = new HostStore(join(open(), "summary-row-count.db"));
    cleanups.push(async () => await store.close());
    const first = await store.addProject("/summary-row-count-a", "A");
    const second = await store.addProject("/summary-row-count-b", "B");
    await store.save(session("a1", first.id), {});
    await store.save(session("a2", first.id), {});
    await store.save(session("b1", second.id), {});
    const counted = () => (store as unknown as { summaryRowCount: number }).summaryRowCount;
    await store.summaries(first.id);
    await store.summaries(second.id);
    expect(counted()).toBe(3);
    await store.save(session("a3", first.id), {});
    expect(await store.summaries(first.id)).toHaveLength(3);
    expect(counted()).toBe(4);
  });
});
describe("project filesystem identity", () => {
  it("reuses a project for equivalent folder spellings without emitting changes", async () => {
    const directory = open();
    const store = new HostStore(join(directory, "host.db"));
    cleanups.push(async () => await store.close());
    const project = await store.addProject(directory, "Original");
    const notify = vi.spyOn(store.changes, "notify");
    const variant =
      process.platform === "win32"
        ? directory.replace(/\\/g, "/").toUpperCase() + "/"
        : directory + "/./";
    expect(await store.addProject(variant, "Alias")).toEqual(project);
    expect(await store.projects()).toEqual([project]);
    expect(notify).not.toHaveBeenCalled();
    expect((await store.addProject(join(directory, "another"), "Another")).id).not.toBe(project.id);
  });
  it.runIf(process.platform === "win32")(
    "reuses a project registered with backslashes when added with slashes",
    async () => {
      const directory = open();
      const store = new HostStore(join(directory, "host.db"));
      cleanups.push(async () => await store.close());
      const project = await store.addProject(directory.replace(/\//g, "\\"), "Original");
      expect((await store.addProject(directory.replace(/\\/g, "/"), "Slashed")).id).toBe(
        project.id,
      );
      expect(await store.projects()).toHaveLength(1);
    },
  );
  it("preserves legacy project IDs and their sessions when opening an alias", async () => {
    const directory = open();
    const store = new HostStore(join(directory, "host.db"));
    cleanups.push(async () => await store.close());
    const project = await store.addProject(directory, "Original");
    await store.db
      .prepare("INSERT INTO projects VALUES (?, ?, ?)")
      .run("legacy", directory + "/", "Original");
    await store.save(session("legacy-session", "legacy"), {});
    expect((await store.addProject(directory + "/./", "Reopened")).id).toBe(project.id);
    expect((await store.project("legacy")).id).toBe("legacy");
    expect((await store.session("legacy-session")).projectId).toBe("legacy");
    expect(await store.projects()).toHaveLength(2);
  });
});
describe("sparse journal checkpoints", () => {
  async function setup(blocks: Block[]) {
    const path = join(open(), "sparse.db");
    const store = new HostStore(path);
    cleanups.push(async () => await store.close());
    const project = await store.addProject("/sparse", "Sparse");
    const input = session("sparse", project.id, { status: "running" });
    const base = await store.save({ ...input, session: { ...input.session, blocks } }, {});
    return { store, base, path };
  }
  async function edit(store: HostStore, previous: HostSession, updates: Block[]) {
    const changes = new Map(updates.map((block) => [block.id, block]));
    return await store.save(
      {
        ...previous,
        revision: previous.revision + 1,
        session: {
          ...previous.session,
          blocks: previous.session.blocks.map((block) => changes.get(block.id) ?? block),
        },
      },
      { edited: updates.map((block) => block.id) },
      { deferred: true, blockChanges: changes },
    );
  }
  async function flush(store: HostStore) {
    await (
      store as unknown as {
        flushPending(id: string): void;
      }
    ).flushPending("sparse");
  }
  it("coalesces edits across saves and reuses ordered IDs without visiting unchanged blocks", async () => {
    const { store, base } = await setup([
      { id: "user", role: "reasoning", text: "unchanged prefix" },
      { id: "a", role: "assistant", text: "first" },
      { id: "b", role: "assistant", text: "second" },
    ]);
    let next = await edit(store, base, [{ ...base.session.blocks[1], text: "first edit" }]);
    await flush(store); // The first journal has to seed block_ids.
    const ids = (await store.db.prepare("SELECT block_ids FROM session_journal").get())!.block_ids;
    const batch = vi.spyOn(store.db, "batchWrites");
    next = await edit(store, next, [{ ...next.session.blocks[1], text: "older" }]);
    next = await edit(store, next, [{ ...next.session.blocks[2], text: "second edit" }]);
    next = await edit(store, next, [{ ...next.session.blocks[1], text: "latest" }]);
    // A full scan or ID serialization would touch this unchanged block.
    Object.defineProperty(next.session.blocks[0], "id", { configurable: true, get: () => "user" });
    const getter = vi.spyOn(next.session.blocks[0], "id", "get");
    await flush(store);
    expect(getter).not.toHaveBeenCalled();
    getter.mockRestore();
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0][0][1].sql).toMatch(/^UPDATE session_journal SET revision=/);
    batch.mockRestore();
    expect((await store.db.prepare("SELECT block_ids FROM session_journal").get())!.block_ids).toBe(
      ids,
    );
    expect(
      (await store.db.prepare("SELECT revision FROM events ORDER BY revision").all()).map(
        (row) => row.revision,
      ),
    ).toEqual([1, 2, 3, 4, 5]);
    expect(
      (
        await store.db.prepare("SELECT payload FROM session_journal_blocks ORDER BY block_id").all()
      ).map((row) => JSON.parse(String(row.payload)).text),
    ).toEqual(["latest", "second edit"]);
  });
  it("restores all pending changes after an enclosing transaction rolls back", async () => {
    const { store, base } = await setup([{ id: "a", role: "assistant", text: "before" }]);
    let next = await edit(store, base, [{ ...base.session.blocks[0], text: "checkpoint" }]);
    await flush(store);
    next = await edit(store, next, [{ ...next.session.blocks[0], text: "pending" }]);
    await expect(
      (async () =>
        await store.transaction(async () => {
          await flush(store);
          throw new Error("rollback");
        }, "critical"))(),
    ).rejects.toThrow("rollback");
    expect((await store.db.prepare("SELECT revision FROM session_journal").get())!.revision).toBe(
      2,
    );
    expect((await store.session("sparse")).revision).toBe(3);
    next = await edit(store, next, [{ ...next.session.blocks[0], text: "retried" }]);
    await flush(store);
    expect(
      JSON.parse(
        String(
          (await store.db.prepare("SELECT payload FROM session_journal_blocks").get())!.payload,
        ),
      ).text,
    ).toBe("retried");
    expect(
      (await store.db.prepare("SELECT revision FROM events ORDER BY revision").all()).map(
        (row) => row.revision,
      ),
    ).toEqual([1, 2, 3, 4]);
  });
  it("keeps the full journal path for additions, removals and reordered known blocks", async () => {
    const { store, base } = await setup([
      { id: "a", role: "assistant", text: "A" },
      { id: "b", role: "user", text: "B" },
    ]);
    let next = await edit(store, base, [{ ...base.session.blocks[0], text: "edited" }]);
    await flush(store);
    const added: Block = { id: "c", role: "assistant", text: "C" };
    for (const blocks of [
      [...next.session.blocks, added],
      [added, next.session.blocks[1], next.session.blocks[0]],
      [added],
    ]) {
      next = await store.save(
        { ...next, revision: next.revision + 1, session: { ...next.session, blocks } },
        {},
        { deferred: true, blockChanges: new Map(blocks.map((block) => [block.id, block])) },
      );
      await flush(store);
      expect(
        JSON.parse(
          String(
            (await store.db.prepare("SELECT block_ids FROM session_journal").get())!.block_ids,
          ),
        ),
      ).toEqual(blocks.map((block) => block.id));
    }
  });
  it("detects reordering even when producer payload changes are empty", async () => {
    const { store, base } = await setup([
      { id: "a", role: "assistant", text: "A" },
      { id: "b", role: "user", text: "B" },
      { id: "c", role: "assistant", text: "C" },
    ]);
    let next = await edit(store, base, [{ ...base.session.blocks[0], text: "edited" }]);
    await flush(store);
    const blocks = [next.session.blocks[2], next.session.blocks[1], next.session.blocks[0]];
    registerBlockChanges(next.session.blocks, blocks, []);
    next = await store.save(
      { ...next, revision: 3, session: { ...next.session, blocks } },
      {},
      { deferred: true },
    );
    await flush(store);
    expect((await store.db.prepare("SELECT block_ids FROM session_journal").get())!.block_ids).toBe(
      '["c","b","a"]',
    );
    expect(summary(next).issueTurnId).toBeUndefined();
  });
  it("durably journals hard provider events without rewriting unchanged history", async () => {
    const history: Block[] = Array.from({ length: 100 }, (_, index) => ({
      id: `history-${index}`,
      role: "assistant",
      text: "x".repeat(64 * 1024),
    }));
    const exercise = async (journal: boolean) => {
      const { store, base, path } = await setup(history);
      let current = base;
      const writes = store.snapshotWrites;
      for (let index = 0; index < 10; index++) {
        const block = { ...current.session.blocks.at(-1)!, text: `tool event ${index}` };
        current = await store.transaction(
          async () =>
            await store.save(
              {
                ...current,
                revision: current.revision + 1,
                session: {
                  ...current.session,
                  providerSessionId: "provider-current",
                  blocks: [...current.session.blocks.slice(0, -1), block],
                },
              },
              { type: "tool.updated", index },
              { journal, blockChanges: new Map([[block.id, block]]) },
            ),
        );
      }
      return { store, current, path, writes: store.snapshotWrites - writes };
    };
    const control = await exercise(false);
    const sparse = await exercise(true);
    expect(control.writes).toBe(10);
    expect(sparse.writes).toBe(0);
    // The hard event is durable before any timer, settlement, or close.
    expect(
      (await sparse.store.db.prepare("SELECT revision FROM session_journal").get())!.revision,
    ).toBe(11);
    expect(
      (await sparse.store.db.prepare("SELECT count(*) AS n FROM session_journal_blocks").get())!.n,
    ).toBe(1);
    expect(
      (await sparse.store.db.prepare("SELECT provider_session_id FROM session_state").get())!
        .provider_session_id,
    ).toBe("provider-current");
    const reader = new HostStore(sparse.path);
    try {
      expect((await reader.session("sparse")).session.blocks).toEqual(
        sparse.current.session.blocks,
      );
      expect((await reader.session("sparse")).session.providerSessionId).toBe("provider-current");
      expect((await reader.events("sparse", 1)).events).toHaveLength(10);
    } finally {
      await reader.close();
    }
  });
  it("commits pending content and the receipt atomically with a hard save", async () => {
    const { store, base } = await setup([{ id: "a", role: "assistant", text: "base" }]);
    let next = await edit(store, base, [{ ...base.session.blocks[0], text: "checkpoint" }]);
    await flush(store);
    next = await edit(store, next, [{ ...next.session.blocks[0], text: "pending" }]);
    const accepted = { commandId: "settle" } as CommandReceipt;
    const save = async () => {
      await store.save({ ...next, revision: 4, status: "idle" }, {});
      await store.recordReceipt("signature", accepted);
    };
    await expect(
      (async () =>
        await store.transaction(async () => {
          await save();
          throw new Error("rollback");
        }, "critical"))(),
    ).rejects.toThrow("rollback");
    expect(await store.receiptStatus("settle")).toBeUndefined();
    expect((await store.db.prepare("SELECT revision FROM sessions").get())!.revision).toBe(1);
    expect((await store.session("sparse")).revision).toBe(3);
    await store.transaction(save, "critical");
    expect(await store.receipt("settle", "signature")).toEqual(accepted);
    expect(await store.db.prepare("SELECT * FROM session_journal").all()).toEqual([]);
    const snapshot = JSON.parse(
      String((await store.db.prepare("SELECT snapshot FROM sessions").get())!.snapshot),
    );
    expect(snapshot.revision).toBe(4);
    expect(snapshot.session.blocks[0].text).toBe("pending");
    expect(
      (await store.db.prepare("SELECT revision FROM events ORDER BY revision").all()).map(
        (row) => row.revision,
      ),
    ).toEqual([1, 2, 3, 4]);
  });
  it("reads an old snapshot and preexisting journal, then extends and compacts the same format", async () => {
    const { store, base, path } = await setup([{ id: "a", role: "assistant", text: "snapshot" }]);
    const {
      blockRevisions: _revisions,
      session: { blocks: _blocks, ...metadata },
      ...rest
    } = base;
    await store.db
      .prepare("INSERT INTO session_journal VALUES (?, ?, ?, ?)")
      .run("sparse", 2, JSON.stringify({ ...rest, revision: 2, session: metadata }), '["a"]');
    await store.db
      .prepare("INSERT INTO session_journal_blocks VALUES (?, ?, ?, ?)")
      .run("sparse", "a", 2, JSON.stringify({ id: "a", role: "assistant", text: "old journal" }));
    // Simulate a previous process: no new in-memory index or writer state.
    const reopened = new HostStore(path);
    await reopened.ready;
    cleanups.push(async () => await reopened.close());
    const old = await reopened.session("sparse");
    expect(old.revision).toBe(2);
    expect(old.session.blocks[0].text).toBe("old journal");
    const next = await edit(reopened, old, [{ ...old.session.blocks[0], text: "new checkpoint" }]);
    await flush(reopened);
    expect(
      (await reopened.db.prepare("SELECT block_ids FROM session_journal").get())!.block_ids,
    ).toBe('["a"]');
    await reopened.save({ ...next, revision: 4, status: "idle" }, {});
    expect(await reopened.db.prepare("SELECT * FROM session_journal").all()).toEqual([]);
    expect(
      JSON.parse(
        String((await reopened.db.prepare("SELECT snapshot FROM sessions").get())!.snapshot),
      ).session.blocks[0].text,
    ).toBe("new checkpoint");
  });
  it("matches full summary semantics while sparse edits change turns, errors, drafts and approvals", async () => {
    const { store, base } = await setup([
      { id: "old-error", role: "system", notice: "error", text: "old failure" },
      { id: "user", role: "user", text: "question" },
      { id: "answer", role: "assistant", text: "answer" },
      { id: "error", role: "system", text: "thread abc already has an active writer" },
      { id: "draft", role: "user", draft: true, text: "draft" },
      { id: "approval", role: "assistant", text: "", approval: { requestId: 1 } },
    ]);
    let next = base;
    const check = (value: HostSession) => {
      const actual = summary(value);
      const issue = sessionIssue({ ...value.session, busy: value.status === "running" });
      expect(actual.issue).toBe(issue);
      expect(actual.issueTurnId).toBe(
        issue
          ? value.session.blocks.findLast((block) => block.role === "user" && !block.draft)?.id
          : undefined,
      );
      expect(actual.issueMessage).toBe(
        issue
          ? (
              value.session.retryMessage ||
              value.session.blocks.findLast((block) => block.notice === "error")?.text ||
              ""
            ).slice(0, 500)
          : undefined,
      );
      expect(actual.draft).toBe(
        value.session.blocks.some((block) => block.role === "user" && block.draft),
      );
      expect(actual.needsInput).toBe(sessionNeedsInput(value.session));
    };
    check(next);
    for (const updates of [
      [{ ...next.session.blocks[3], text: "recovered" }],
      [{ ...next.session.blocks[2], text: "" }],
      [{ ...next.session.blocks[4], draft: false }],
      [{ ...next.session.blocks[5], approval: { requestId: 1, decided: "allow" as const } }],
      [
        {
          ...next.session.blocks[4],
          role: "system" as const,
          notice: "error" as const,
          text: "new failure",
        },
      ],
    ]) {
      next = await edit(store, next, updates);
      check(next);
      check({ ...next, status: "idle" });
      check({
        ...next,
        session: { ...next.session, retryMessage: "retry", continuingElsewhere: true },
      });
      check({ ...next, session: { ...next.session, worktreeRemoved: true } });
      await flush(store);
      expect(
        JSON.parse(
          String((await store.db.prepare("SELECT summary FROM session_state").get())!.summary),
        ),
      ).toEqual(JSON.parse(JSON.stringify(summary(next))));
    }
  });
});
it("accepts a mirrored message author whose keys come back in another order", async () => {
  const store = new HostStore(join(open(), "author-order.db"));
  cleanups.push(async () => await store.close());
  const project = await store.addProject("/author-order", "Author order");
  const author = {
    kind: "delegation",
    runId: "run",
    title: "Translate",
    reason: "completion",
  } as const;
  const notice: Block = { id: "notice", role: "user", text: "Subagent completion", author };
  await store.save(
    session("parent", project.id, {
      session: { ...session("parent", project.id).session, blocks: [notice] },
    }),
    {},
  );
  // The desktop's native storage writes object keys sorted; the author itself is unchanged.
  const sorted = { kind: "delegation", reason: "completion", runId: "run", title: "Translate" };
  const current = await store.session("parent");
  await store.save(
    {
      ...current,
      revision: current.revision + 1,
      session: {
        ...current.session,
        blocks: [
          { ...notice, author: sorted } as Block,
          { id: "reply", role: "assistant", text: "Ok" },
        ],
      },
    },
    {},
  );
  expect((await store.session("parent")).session.blocks.map((block) => block.id)).toEqual([
    "notice",
    "reply",
  ]);
  const next = await store.session("parent");
  await expect(
    store.save(
      {
        ...next,
        revision: next.revision + 1,
        session: {
          ...next.session,
          blocks: [{ ...notice, author: { ...author, title: "Forged" } }],
        },
      },
      {},
    ),
  ).rejects.toThrow("authorship");
});
it("keeps both session ownership indexes consistent when moving projects", async () => {
  const directory = open();
  const store = new HostStore(join(directory, "ownership.db"));
  cleanups.push(async () => await store.close());
  const first = await store.addProject(join(directory, "first"), "First");
  const second = await store.addProject(join(directory, "second"), "Second");
  const saved = await store.save(session("moved", first.id), {});
  await store.save({ ...saved, projectId: second.id, revision: 2 }, {});
  for (const table of ["sessions", "session_state"])
    expect(
      await store.db.prepare(`SELECT project_id FROM ${table} WHERE id=?`).get("moved"),
    ).toEqual({
      project_id: second.id,
    });
  expect(await store.sessions(first.id)).toEqual([]);
  expect((await store.sessions(second.id)).map((value) => value.session.id)).toEqual(["moved"]);
});
it("recovers reordered, deleted and updated blocks from the incremental journal", async () => {
  vi.useFakeTimers();
  try {
    const path = join(open(), "journal.db");
    const store = new HostStore(path);
    const project = await store.addProject("/tmp", "Journal");
    const base = await store.save(
      session("journal", project.id, {
        session: {
          ...session("journal", project.id).session,
          blocks: [
            { id: "a", role: "assistant", text: "large prefix" },
            { id: "b", role: "assistant", text: "tail" },
          ],
        },
      }),
      {},
    );
    const next = await store.save(
      {
        ...base,
        revision: 2,
        session: {
          ...base.session,
          title: "Changed",
          blocks: [{ ...base.session.blocks[1]!, text: "new tail" }, base.session.blocks[0]!],
        },
      },
      {},
      { deferred: true },
    );
    await vi.advanceTimersByTimeAsync(1000);
    await store.db.scope(() => undefined);
    await store.save(
      {
        ...next,
        revision: 3,
        session: { ...next.session, blocks: [next.session.blocks[0]!] },
      },
      {},
      { deferred: true },
    );
    await vi.advanceTimersByTimeAsync(1000);
    await store.db.scope(() => undefined);
    expect(
      JSON.parse(
        String(
          (await store.db.prepare("SELECT snapshot FROM sessions WHERE id='journal'").get())!
            .snapshot,
        ),
      ).revision,
    ).toBe(1);
    await store.db.close();
    const reopened = new HostStore(path);
    await reopened.ready;
    cleanups.push(async () => await reopened.close());
    expect((await reopened.session("journal")).session.blocks.map((b) => [b.id, b.text])).toEqual([
      ["b", "new tail"],
    ]);
    expect((await reopened.session("journal")).session.title).toBe("Changed");
    expect((await reopened.session("journal")).revision).toBe(3);
  } finally {
    vi.useRealTimers();
  }
});
it("rolls back a journal and its events when an enclosing transaction fails", async () => {
  const store = new HostStore(join(open(), "rollback.db"));
  cleanups.push(async () => await store.close());
  const project = await store.addProject("/tmp", "Rollback");
  const base = await store.save(session("rollback", project.id), {});
  await expect(
    (async () =>
      await store.transaction(async () => {
        await store.save({ ...base, revision: 2 }, { changed: true });
        throw new Error("rollback");
      }))(),
  ).rejects.toThrow("rollback");
  expect((await store.session("rollback")).revision).toBe(1);
  expect((await store.events("rollback", 1)).events).toEqual([]);
});
it("keeps session revisions in bounded metadata memory after the first indexed read", async () => {
  const path = join(open(), "metadata.db");
  const initial = new HostStore(path);
  const project = await initial.addProject("/tmp", "Metadata");
  const saved = await initial.save(session("metadata", project.id), {});
  await initial.close();
  const reopened = new HostStore(path);
  await reopened.ready;
  cleanups.push(async () => await reopened.close());
  const prepare = vi.spyOn(reopened.db, "prepare");
  expect(await reopened.sessionStateMetadata("metadata")).toEqual({
    projectId: project.id,
    createdAt: saved.createdAt,
    revision: saved.revision,
    status: "idle",
    desktop: false,
  });
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(await reopened.sessionRevision("metadata")).toBe(saved.revision);
  expect((await reopened.sessionStateMetadata("metadata"))?.status).toBe("idle");
  expect(prepare).toHaveBeenCalledTimes(1);
});
describe("reads beside the writer queue", () => {
  it("serves summaries, projects and adopted rows while a writer scope holds the queue", async () => {
    const store = new HostStore(join(open(), "beside-writer.db"));
    cleanups.push(async () => await store.close());
    const project = await store.addProject("/beside-writer", "Beside");
    await store.save(session("beside", project.id), {});
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const writer = store.db.storeScope(async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    try {
      expect(await store.summaries(project.id)).toHaveLength(1);
      expect((await store.project(project.id)).name).toBe("Beside");
      expect((await store.projects()).length).toBe(1);
      expect(await store.adopted(project.id)).toEqual([]);
    } finally {
      release.resolve();
      await writer;
    }
  });
  it("shows an unflushed save and then its flush, never an older row than the version it caches", async () => {
    const path = join(open(), "beside-pending.db");
    const store = new HostStore(path);
    cleanups.push(async () => await store.close());
    const project = await store.addProject("/beside-pending", "Pending");
    let value = await store.save(session("moving", project.id), {});
    expect((await store.summaries(project.id))[0]?.revision).toBe(value.revision);
    for (let index = 0; index < 5; index++) {
      value = await store.save(
        { ...value, revision: value.revision + 1, updatedAt: value.updatedAt + 1 },
        {},
        { deferred: true },
      );
      // Unwritten state wins over the stored row, cached or not.
      expect((await store.summaries(project.id))[0]?.revision).toBe(value.revision);
    }
    await store.flushAll();
    expect((await store.summaries(project.id))[0]?.revision).toBe(value.revision);
    // The reader connection sees the flushed commit and a rebuilt list agrees with the cache.
    const reopened = new HostStore(path);
    cleanups.push(async () => await reopened.close());
    expect((await reopened.summaries(project.id))[0]?.revision).toBe(value.revision);
  });
  it("sees a project registered by a committed transaction on the next read", async () => {
    const store = new HostStore(join(open(), "beside-registry.db"));
    cleanups.push(async () => await store.close());
    await store.addProject("/beside-registry-a", "A");
    expect((await store.projects()).map((row) => row.name)).toEqual(["A"]);
    await store.addProject("/beside-registry-b", "B");
    expect((await store.projects()).map((row) => row.name)).toEqual(["A", "B"]);
  });
});
describe("session reads beside the writer", () => {
  async function seeded(name: string) {
    const path = join(open(), name);
    const first = new HostStore(path);
    const project = await first.addProject(`/${name}`, name);
    const saved = await first.save(session("s1", project.id), {});
    await first.close();
    // A reopened store has a cold cache, so reads must come from SQLite.
    const store = new HostStore(path);
    cleanups.push(async () => await store.close());
    await store.ready;
    return { store, project, saved };
  }
  it("prefers an unwritten session over the stored row", async () => {
    const { store, project, saved } = await seeded("pending.db");
    await store.save(
      { ...saved, revision: saved.revision + 1, updatedAt: saved.updatedAt + 1 },
      {},
      { deferred: true },
    );
    expect((await store.session("s1")).revision).toBe(saved.revision + 1);
    expect((await store.sessionStateMetadata("s1"))?.revision).toBe(saved.revision + 1);
    expect(project.id).toBe(saved.projectId);
  });
  it("sees its own writes inside a writer scope", async () => {
    const { store, saved } = await seeded("owner.db");
    const next = await store.db.storeScope(async () => {
      await store.save({ ...saved, revision: saved.revision + 1 }, {});
      return {
        value: await store.session("s1"),
        metadata: await store.sessionStateMetadata("s1"),
      };
    });
    expect(next.value.revision).toBe(saved.revision + 1);
    expect(next.metadata?.revision).toBe(saved.revision + 1);
  });
  it("rejects a credential at once after it was revoked", async () => {
    const { store } = await seeded("auth.db");
    const { token } = await store.issueDevice("Phone", "phone");
    expect(await store.authenticated(token)).toBe(true);
    expect(await store.revokeToken(token)).toBe(true);
    expect(await store.authenticated(token)).toBe(false);
  });
});
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});
function open() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-store-test-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function session(id: string, projectId: string, extra: Partial<HostSession> = {}): HostSession {
  return {
    projectId,
    revision: 1,
    status: "idle",
    updatedAt: 100,
    session: {
      id,
      cwd: "/tmp",
      title: id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
      blocks: [],
    },
    ...extra,
  } as unknown as HostSession;
}

it("persists conversation image reservations across reopening and removes them with the session", async () => {
  const directory = open();
  const path = join(directory, "image-budget.db");
  const first = new HostStore(path);
  try {
    const project = await first.addProject(directory, "Test");
    await first.save(session("image-session", project.id), {});
    await expect(first.reserveConversationImage("image-session", 3)).resolves.toBe(1);
  } finally {
    await first.close();
  }

  const reopened = new HostStore(path);
  cleanups.push(() => reopened.close());
  await expect(reopened.conversationImagesUsed("image-session")).resolves.toBe(1);
  expect(
    await Promise.all([
      reopened.reserveConversationImage("image-session", 3),
      reopened.reserveConversationImage("image-session", 3),
      reopened.reserveConversationImage("image-session", 3),
    ]),
  ).toEqual([2, 3, undefined]);
  await expect(reopened.conversationImagesUsed("image-session")).resolves.toBe(3);
  await reopened.deleteSession("image-session");
  await expect(reopened.conversationImagesUsed("image-session")).resolves.toBe(0);
});

it("uses pending run identities ahead of checkpointed session metadata", async () => {
  const directory = open();
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(() => store.close());
  const { id: projectId } = await store.addProject(directory, "Test");
  const event = { type: "test" };
  await store.save(session("finishing", projectId), event);
  await store.save(session("starting", projectId), event);
  await store.save(
    session("finishing", projectId, { revision: 2, status: "running", runId: "checkpointed" }),
    event,
    { journal: true },
  );
  await store.save(session("no-run-id", projectId, { status: "running" }), event);
  expect(await store.runningSessionRuns()).toEqual([
    { sessionId: "finishing", projectId, runId: "checkpointed" },
  ]);

  await store.transaction(async () => {
    await store.save(session("finishing", projectId, { revision: 3 }), event, { deferred: true });
    await store.save(
      session("starting", projectId, { revision: 2, status: "running", runId: "pending" }),
      event,
      { deferred: true },
    );
    expect(await store.runningSessionRuns()).toEqual([
      { sessionId: "starting", projectId, runId: "pending" },
    ]);
  });
});

describe("HostStore.adopted", () => {
  it("lists only desktop-shared sessions and tracks updates", async () => {
    const directory = open();
    const store = new HostStore(join(directory, "host.db"));
    cleanups.push(async () => await store.close());
    const project = await store.addProject(directory, "Test");
    await store.save(session("plain", project.id), { type: "t" });
    await store.save(session("shared", project.id, { desktop: { updatedAt: 5 } }), {
      type: "t",
    });
    expect(await store.adopted()).toEqual([
      {
        id: "shared",
        projectId: project.id,
        revision: 1,
        updatedAt: 100,
        status: "idle",
        desktopUpdatedAt: 5,
      },
    ]);
    await store.save(
      session("shared", project.id, {
        desktop: { updatedAt: 9 },
        revision: 2,
        updatedAt: 200,
        status: "running",
      }),
      { type: "t" },
    );
    await store.save(
      session("plain", project.id, {
        desktop: { updatedAt: 0 },
        revision: 2,
        updatedAt: 300,
      }),
      { type: "t" },
    );
    expect((await store.adopted()).sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      {
        id: "plain",
        projectId: project.id,
        revision: 2,
        updatedAt: 300,
        status: "idle",
        desktopUpdatedAt: 0,
      },
      {
        id: "shared",
        projectId: project.id,
        revision: 2,
        updatedAt: 200,
        status: "running",
        desktopUpdatedAt: 9,
      },
    ]);
  });
  it("migrates and backfills a database created with the old schema", async () => {
    const directory = open();
    const path = join(directory, "host.db");
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, cwd TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), snapshot TEXT NOT NULL, summary TEXT);
      INSERT INTO projects VALUES ('p', '/x', 'X');`);
    const insert = old.prepare(
      "INSERT INTO sessions (id, project_id, snapshot) VALUES (?, 'p', ?)",
    );
    insert.run(
      "a",
      JSON.stringify(
        session("a", "p", {
          desktop: { updatedAt: 1 },
          revision: 7,
          updatedAt: 42,
          status: "running",
        }),
      ),
    );
    insert.run("b", JSON.stringify(session("b", "p")));
    await old.close();
    const store = new HostStore(path);
    expect(await store.adopted()).toEqual([
      {
        id: "a",
        projectId: "p",
        revision: 7,
        updatedAt: 42,
        status: "running",
        desktopUpdatedAt: 1,
      },
    ]);
    expect((await store.summaries("p")).map((entry) => entry.id).sort()).toEqual(["a", "b"]);
    expect(await store.hasRunning("p")).toBe(true);
    // Reopening must not re-run the backfill or fail on existing columns.
    await store.close();
    const again = new HostStore(path);
    cleanups.push(async () => await again.close());
    expect(await again.adopted()).toHaveLength(1);
  });
  it("creates the session_state side table on a fresh database and writes both rows on hard saves", async () => {
    const directory = open();
    const path = join(directory, "host.db");
    const store = new HostStore(path);
    cleanups.push(async () => await store.close());
    const project = await store.addProject(directory, "Test");
    await store.save(session("s", project.id, { revision: 4, updatedAt: 44 }), {
      type: "t",
    });
    const raw = new DatabaseSync(path);
    try {
      expect(
        raw.prepare("SELECT revision, updated_at, project_id FROM session_state").all(),
      ).toEqual([{ revision: 4, updated_at: 44, project_id: project.id }]);
      expect(raw.prepare("SELECT revision FROM sessions WHERE id='s'").get()).toEqual({
        revision: 4,
      });
      const indexes = raw
        .prepare("PRAGMA index_list(session_state)")
        .all()
        .map((index) => index.name);
      expect(indexes).toContain("session_state_project");
      expect(
        raw
          .prepare("PRAGMA index_list(sync_records)")
          .all()
          .map((index) => index.name),
      ).toContain("sync_records_rev");
    } finally {
      await raw.close();
    }
    expect(await store.hasRunning(project.id)).toBe(false);
  });
  it("mirrors writes an older host binary makes to sessions after a rollback", async () => {
    const directory = open();
    const path = join(directory, "host.db");
    const first = new HostStore(path);
    const project = await first.addProject(directory, "Test");
    await first.save(session("a", project.id, { desktop: { updatedAt: 3 } }), {
      type: "t",
    });
    await first.save(session("b", project.id, { status: "running" }), { type: "t" });
    await first.close();
    // What the previous binary does: it only knows the sessions table.
    const raw = new DatabaseSync(path);
    raw.exec("PRAGMA foreign_keys=ON");
    raw
      .prepare(
        "INSERT INTO sessions (id, project_id, snapshot, summary, has_desktop, revision, updated_at, status) VALUES ('late', ?, ?, NULL, 0, 9, 90, 'running')",
      )
      .run(
        project.id,
        JSON.stringify(
          session("late", project.id, {
            revision: 9,
            updatedAt: 90,
            status: "running",
            runId: "legacy-run",
          }),
        ),
      );
    raw
      .prepare(
        "UPDATE sessions SET summary=NULL, revision=5, updated_at=500, status='idle' WHERE id='b'",
      )
      .run();
    await raw.close();
    const store = new HostStore(path);
    cleanups.push(async () => await store.close());
    expect(await store.runningSessionRuns()).toEqual([
      { sessionId: "late", projectId: project.id, runId: "legacy-run" },
    ]);
    expect((await store.summaries(project.id)).map((entry) => entry.id).sort()).toEqual([
      "a",
      "b",
      "late",
    ]);
    expect(
      await store.db.prepare("SELECT revision, status FROM session_state WHERE id='b'").get(),
    ).toMatchObject({ revision: 5, status: "idle" });
    expect(await store.hasRunning(project.id)).toBe(true);
    expect((await store.adopted()).map((entry) => entry.id)).toEqual(["a"]);
    expect((await store.startupStates()).map((state) => state.id).sort()).toEqual([
      "a",
      "b",
      "late",
    ]);
    await store.deleteSession("a");
    expect(
      await store.db.prepare("SELECT id FROM session_state WHERE id='a'").get(),
    ).toBeUndefined();
  });
  it("adopts sessions rows that exist without a session_state row", async () => {
    const directory = open();
    const path = join(directory, "host.db");
    const first = new HostStore(path);
    const project = await first.addProject(directory, "Test");
    await first.save(session("a", project.id, { desktop: { updatedAt: 3 } }), {
      type: "t",
    });
    await first.close();
    const raw = new DatabaseSync(path);
    raw.exec("DROP TRIGGER session_state_insert; DELETE FROM session_state");
    await raw.close();
    const store = new HostStore(path);
    cleanups.push(async () => await store.close());
    expect(await store.adopted()).toMatchObject([{ id: "a", desktopUpdatedAt: 3 }]);
  });
  it("retires a deleted session's change counters and still moves the project scope", async () => {
    const directory = open();
    const store = new HostStore(join(directory, "host.db"));
    cleanups.push(async () => await store.close());
    const project = await store.addProject(directory, "Test");
    await store.save(session("a", project.id), { type: "t" });
    const seenSession = store.versions.session("a", false);
    const seenScope = store.versions.scope(project.id, false);
    expect(seenSession).toBeGreaterThan(0);
    await store.deleteSession("a");
    // Deletion delivery: the project scope a session stream watches still moves.
    expect(store.versions.scope(project.id, false)).toBeGreaterThan(seenScope);
    // A reader holding the old per-session counter sees it change, not a stale match.
    expect(store.versions.session("a", false)).not.toBe(seenSession);
    expect(store.versions.session("a", false)).toBe(0);
    expect(store.versions.lastStep("a")).toBe(1);
  });
});
describe("HostStore device credentials", () => {
  it("caps details at 256, orders current first then id, and persists phone metadata", async () => {
    const path = join(open(), "device-details.db");
    let store = new HostStore(path);
    try {
      const current = await store.issueDevice("Phone", "phone");
      const pairedAt = (await store.pairedDeviceDetails(current.token)).devices[0]?.pairedAt;
      await store.transaction(async () => {
        for (let index = 0; index < 256; index++)
          await store.db
            .prepare("INSERT INTO devices (id, name, hash) VALUES (?, ?, ?)")
            .run(`other-${String(index).padStart(3, "0")}`, "\n", `hash-${index}`);
      });
      await store.close();
      store = new HostStore(path);
      const details = await store.pairedDeviceDetails(current.token);
      expect(details.devicesTruncated).toBe(true);
      expect(details.devices).toHaveLength(256);
      expect(details.devices[0]).toEqual({
        id: current.id,
        name: "Phone",
        isCurrent: true,
        canManageDevices: false,
        isLocalDesktop: false,
        kind: "phone",
        pairedAt,
      });
      expect(details.devices[1]).toEqual({
        id: "other-000",
        name: "other-000",
        isCurrent: false,
        canManageDevices: false,
        isLocalDesktop: false,
      });
      expect(details.devices.at(-1)?.id).toBe("other-254");
      expect(JSON.stringify(details)).not.toContain("hash");
      expect(JSON.stringify(details)).not.toContain(current.token);
    } finally {
      await store.close();
    }
  });
  it("migrates legacy devices without inventing metadata and persists new metadata", async () => {
    const path = join(open(), "devices.db");
    const legacy = new DatabaseSync(path);
    legacy.exec(`CREATE TABLE devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, hash TEXT NOT NULL UNIQUE);
      INSERT INTO devices VALUES ('legacy', 'Old device', 'old-hash');`);
    legacy.close();
    const store = new HostStore(path);
    const clock = vi.spyOn(Date, "now").mockReturnValue(100_000);
    try {
      const current = await store.issueDevice("Desktop\nname", "desktop");
      expect(await store.pairedDeviceDetails(current.token)).toEqual({
        devices: [
          {
            id: current.id,
            name: "Desktop name",
            isCurrent: true,
            canManageDevices: false,
            isLocalDesktop: false,
            kind: "desktop",
            pairedAt: 100_000,
          },
          {
            id: "legacy",
            name: "Old device",
            isCurrent: false,
            canManageDevices: false,
            isLocalDesktop: false,
          },
        ],
        devicesTruncated: false,
      });
      expect((await store.pairedDevices(current.token)).devices[0]).toEqual({
        id: current.id,
        name: "Desktop name",
        isCurrent: true,
      });
      await store.db
        .prepare("UPDATE devices SET kind='invalid', paired_at=-1, last_seen_at=1.5 WHERE id=?")
        .run(current.id);
      expect((await store.pairedDeviceDetails(current.token)).devices[0]).toEqual({
        id: current.id,
        name: "Desktop name",
        isCurrent: true,
        canManageDevices: false,
        isLocalDesktop: false,
      });
      await store.revokeToken(current.token);
      await expect(store.pairedDeviceDetails(current.token)).rejects.toThrow("revoked");
    } finally {
      clock.mockRestore();
      await store.close();
    }
  });
  it("throttles last-seen writes across DB lookups and ignores write failures", async () => {
    const store = new HostStore(join(open(), "seen.db"));
    const clock = vi.spyOn(Date, "now").mockReturnValue(100_000);
    try {
      const current = await store.issueDevice("Phone", "phone");
      expect(await store.authenticated(current.token)).toBe(true);
      const lastSeen = async () =>
        (await store.pairedDeviceDetails(current.token)).devices[0]?.lastSeenAt;
      expect(await lastSeen()).toBe(100_000);
      clock.mockReturnValue(101_000);
      expect(await store.authenticated(current.token)).toBe(true);
      expect(await lastSeen()).toBe(100_000);
      // Revocation clears the auth cache, forcing a fresh lookup of the surviving token.
      await store.revokeDevice("missing");
      expect(await store.authenticated(current.token)).toBe(true);
      expect(await lastSeen()).toBe(100_000);
      clock.mockReturnValue(160_000);
      await store.revokeDevice("missing");
      expect(await store.authenticated(current.token)).toBe(true);
      expect(await lastSeen()).toBe(160_000);
      await store.db.exec(
        "CREATE TRIGGER reject_seen BEFORE UPDATE OF last_seen_at ON devices BEGIN SELECT RAISE(FAIL, 'read only'); END;",
      );
      clock.mockReturnValue(220_000);
      await store.revokeDevice("missing");
      expect(await store.authenticated(current.token)).toBe(true);
      expect(await lastSeen()).toBe(160_000);
    } finally {
      clock.mockRestore();
      await store.close();
    }
  });
  it("replaces only the credential bound to the proven earlier key when a device pairs again", async () => {
    const directory = open();
    const store = new HostStore(join(directory, "host.db"));
    cleanups.push(async () => await store.close());
    const key = (jkt: string) => ({ jkt, x: `${jkt}-x` });
    const owner = await store.issueDevice("Desktop", "desktop", true, key("phone-key-1"));
    const earlier = await store.issueDevice("Bycoda phone", "phone", false, key("phone-key-1"));
    const otherPhone = await store.issueDevice("Bycoda phone", "phone", false, key("other-key"));
    const otherKind = await store.issueDevice("Laptop", "desktop", false, key("phone-key-1"));
    const replace = (jkt: string) =>
      store.issueDevice("Bycoda phone", "phone", false, key(jkt), { jkt: "phone-key-1" });
    const listed = async () =>
      (await store.pairedDevices(owner.token)).devices.map((device) => device.id);
    // A replacement the phone never received (lost response, failed connection) retires nothing
    // and is not listed as a second phone; to itself it is listed.
    const lost = await replace("phone-key-2");
    expect((await store.deviceAuthority(lost.token))?.replacementPending).toBe(true);
    expect(await store.authenticated(earlier.token)).toBe(true);
    expect(await listed()).toContain(earlier.id);
    expect(await listed()).not.toContain(lost.id);
    expect((await store.pairedDevices(lost.token)).devices[0]).toMatchObject({
      id: lost.id,
      isCurrent: true,
    });
    // The phone pairs once more with the key it still holds and uses that credential.
    const replacement = await replace("phone-key-3");
    expect(await store.authenticated(earlier.token)).toBe(true);
    expect(await store.completeDeviceReplacement(replacement.token)).toBe(true);
    expect(await store.authenticated(earlier.token)).toBe(false);
    expect(await store.authenticated(lost.token)).toBe(false);
    // Same name, different key: another phone. Same key, another kind or the local desktop:
    // never retired here.
    expect(await store.authenticated(otherPhone.token)).toBe(true);
    expect(await store.authenticated(otherKind.token)).toBe(true);
    expect(await store.authenticated(owner.token)).toBe(true);
    expect(await store.authenticated(replacement.token)).toBe(true);
    expect(await listed()).toEqual(expect.not.arrayContaining([earlier.id, lost.id]));
    expect(await listed()).toContain(replacement.id);
    // Done once: later requests of the same credential and ordinary credentials change nothing.
    expect((await store.deviceAuthority(replacement.token))?.replacementPending).toBeUndefined();
    expect(await store.completeDeviceReplacement(replacement.token)).toBe(false);
    expect(await store.completeDeviceReplacement(otherPhone.token)).toBe(false);
    // A credential never names its own key as the one to retire.
    const same = await store.issueDevice("Bycoda phone", "phone", false, key("k"), { jkt: "k" });
    expect(await store.completeDeviceReplacement(same.token)).toBe(false);
    // A proven key with no credential left behind it (the owner revoked it) replaces nothing, so
    // the new credential is listed at once.
    const fresh = await store.issueDevice("Bycoda phone", "phone", false, key("k2"), {
      jkt: "gone-key",
    });
    expect((await store.deviceAuthority(fresh.token))?.replacementPending).toBeUndefined();
    expect(await listed()).toContain(fresh.id);
    // The phone saved a replacement but pairs again before using it: the next one inherits the
    // original target, so the whole chain is retired together.
    const second = await store.issueDevice("Bycoda phone", "phone", false, key("phone-key-4"), {
      jkt: "phone-key-3",
    });
    const third = await store.issueDevice("Bycoda phone", "phone", false, key("phone-key-5"), {
      jkt: "phone-key-4",
    });
    expect(await store.completeDeviceReplacement(third.token)).toBe(true);
    expect(await store.authenticated(replacement.token)).toBe(false);
    expect(await store.authenticated(second.token)).toBe(false);
    // Revoking the listed credential revokes its unlisted, unconfirmed replacement with it.
    const hidden = await store.issueDevice("Bycoda phone", "phone", false, key("phone-key-6"), {
      jkt: "phone-key-5",
    });
    expect(await store.revokeOtherDevice(third.id, owner.token)).toBe(true);
    expect(await store.authenticated(hidden.token)).toBe(false);
    expect(await store.authenticated(otherPhone.token)).toBe(true);
  });
  it("drops a hidden replacement left behind by a revoke interrupted before its sweep", async () => {
    const path = join(open(), "host.db");
    const key = (jkt: string) => ({ jkt, x: `${jkt}-x` });
    const first = new HostStore(path);
    const earlier = await first.issueDevice("Bycoda phone", "phone", false, key("old-key"));
    const hidden = await first.issueDevice("Bycoda phone", "phone", false, key("new-key"), {
      jkt: "old-key",
    });
    await first.close();
    // The revoke's first statement ran, the sweep did not.
    const raw = new DatabaseSync(path);
    raw.prepare("DELETE FROM devices WHERE id=?").run(earlier.id);
    raw.close();
    const reopened = new HostStore(path);
    cleanups.push(() => reopened.close());
    expect(await reopened.authenticated(hidden.token)).toBe(false);
  });
  it("replaces a reinstalled phone's credential by install ID, for phones only and after use", async () => {
    const directory = open();
    const store = new HostStore(join(directory, "host.db"));
    cleanups.push(async () => await store.close());
    const key = (jkt: string) => ({ jkt, x: `${jkt}-x` });
    const phone = (jkt: string, installId?: string) =>
      store.issueDevice("Bycoda phone", "phone", false, key(jkt), installId ? { installId } : {});
    const owner = await store.issueDevice("Desktop", "desktop", true, key("owner-key"));
    const first = await phone("key-1", "install-a");
    const otherInstall = await phone("key-2", "install-b");
    const noInstall = await phone("key-3");
    // A desktop never carries an install ID, so one can neither retire nor be retired by it.
    const desktop = await store.issueDevice("Laptop", "desktop", false, key("key-4"), {
      installId: "install-a",
    });
    expect((await store.deviceAuthority(first.token))?.replacementPending).toBeUndefined();
    expect((await store.deviceAuthority(desktop.token))?.replacementPending).toBeUndefined();
    // The reinstalled phone has a new key and no proof of the earlier one.
    const reinstalled = await phone("key-5", "install-a");
    expect((await store.deviceAuthority(reinstalled.token))?.replacementPending).toBe(true);
    expect(await store.authenticated(first.token)).toBe(true);
    expect(
      (await store.pairedDevices(owner.token)).devices.map((device) => device.id),
    ).not.toContain(reinstalled.id);
    expect(await store.completeDeviceReplacement(reinstalled.token)).toBe(true);
    expect(await store.authenticated(first.token)).toBe(false);
    for (const kept of [reinstalled, otherInstall, noInstall, desktop, owner])
      expect(await store.authenticated(kept.token)).toBe(true);
  });
  it("drops a remembered credential the moment it is revoked", async () => {
    const directory = open();
    const store = new HostStore(join(directory, "host.db"));
    cleanups.push(async () => await store.close());
    const first = await store.issueDevice("one");
    const second = await store.issueDevice("two");
    expect(await store.authenticated(first.token)).toBe(true);
    // Served from memory now; revocation must still win at once.
    expect(await store.authenticated(first.token)).toBe(true);
    expect(await store.authenticated(second.token)).toBe(true);
    expect(await store.revokeDevice(first.id)).toBe(true);
    expect(await store.authenticated(first.token)).toBe(false);
    expect(await store.authenticated(second.token)).toBe(true);
    expect(await store.revokeToken(second.token)).toBe(true);
    expect(await store.authenticated(second.token)).toBe(false);
    expect(await store.authenticated("unknown")).toBe(false);
  });
  it.each(["authenticated", "authenticateIncomingDevice"] as const)(
    "%s sees an external revocation when the authentication cache expires",
    async (check) => {
      const directory = open();
      const path = join(directory, "host.db");
      const store = new HostStore(path);
      cleanups.push(async () => await store.close());
      const device = await store.issueDevice("cli-revoked");
      expect(await store.authenticated(device.token)).toBe(true);
      expect(await store.authenticated(device.token)).toBe(true);
      const other = new DatabaseSync(path);
      try {
        other.prepare("DELETE FROM devices WHERE id=?").run(device.id);
      } finally {
        await other.close();
      }
      const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1501);
      try {
        expect(await store[check](device.token)).toBe(false);
      } finally {
        clock.mockRestore();
      }
    },
  );
  it("does not renew an incoming credential invalidated during its read", async () => {
    const store = new HostStore(join(open(), "host.db"));
    cleanups.push(async () => await store.close());
    const device = await store.issueDevice("desktop");
    await store.authenticated(device.token);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1501);
    const snapshot = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const readScope = store.db.readScope.bind(store.db);
    const paused = vi.spyOn(store.db, "readScope").mockImplementationOnce(async (read) => {
      const value = await readScope(read);
      snapshot.resolve();
      await release.promise;
      return value;
    });
    const check = store.authenticateIncomingDevice(device.token);
    try {
      await snapshot.promise;
      await store.revokeToken(device.token);
      release.resolve();
      expect(await check).toBe(false);
    } finally {
      release.resolve();
      paused.mockRestore();
      clock.mockRestore();
    }
  });
});
describe("HostStore receipts", () => {
  const receipt = (commandId: string) => ({ commandId }) as unknown as CommandReceipt;
  it("recovers unresolved follow-up evidence from a session saved before steer-aware receipts", async () => {
    const directory = open();
    const store = new HostStore(join(directory, "host.db"));
    try {
      const project = await store.addProject(directory, "legacy");
      const old = session("s", project.id);
      old.session.blocks.push({
        id: "steer",
        role: "user",
        text: "follow-up",
        draft: true,
        followUpDelivery: "uncertain",
      });
      await store.save(old, {});
      const wire = { commandId: "steer", sessionId: "s", revision: 1 };
      await store.recordReceipt("sig", wire);
      expect(await store.receiptStatus("steer")).toEqual(wire);
      expect((await store.receiptStatus("steer", { includeSteer: true }))?.steer).toBeDefined();
      await store.save(
        { ...old, revision: 2 },
        {
          type: "command",
          command: { type: "steer", commandId: "old-command", runId: "original-run" },
        },
      );
      await store.recordReceipt("sig", { ...wire, commandId: "old-command", revision: 2 });
      expect((await store.receiptStatus("old-command", { includeSteer: true }))?.steer).toEqual({
        runId: "original-run",
      });
    } finally {
      await store.close();
    }
  });
  it("keeps steer proof and claim private through compaction and restart", async () => {
    const path = join(open(), "host.db");
    const store = new HostStore(path);
    const wire = { commandId: "steer", sessionId: "s", revision: 1 };
    await store.recordReceipt("sig", { ...wire, steer: { runId: "r" } });
    await store.transaction(() => store.bindSteerClaim("steer", "token"), "critical");
    await store.db.prepare("UPDATE receipts SET created_at=0 WHERE id='steer'").run();
    await store.pruneReceipts();
    await store.transaction(() => store.settleSteerReceipt("steer", "not_delivered"), "critical");
    await store.close();
    const reopened = new HostStore(path);
    try {
      expect(await reopened.receipt("steer", "sig")).toEqual(wire);
      expect(await reopened.receiptStatus("steer", { includeSteer: true })).toEqual({
        ...wire,
        steer: { runId: "r", claimToken: "token", outcome: "not_delivered" },
      });
    } finally {
      await reopened.close();
    }
  });
  it("compacts old request signatures while preserving exact retry answers", async () => {
    const directory = open();
    const path = join(directory, "host.db");
    const store = new HostStore(path);
    await store.recordReceipt("sig", receipt("recent"));
    await store.recordReceipt("sig", receipt("old"));
    await store.db
      .prepare("UPDATE receipts SET created_at=? WHERE id='old'")
      .run(Date.now() - 8 * 24 * 3600000);
    await store.pruneReceipts();
    expect(await store.receipt("old", "sig")).toEqual(receipt("old"));
    expect(await store.receipt("recent", "sig")).toEqual(receipt("recent"));
    await expect((async () => await store.receipt("recent", "other"))()).rejects.toThrow(
      /different payload/,
    );
    await store.close();
  });
  it("migrates a receipts table without timestamps and gives old rows a full window", async () => {
    const directory = open();
    const path = join(directory, "host.db");
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE receipts (id TEXT PRIMARY KEY, signature TEXT NOT NULL, receipt TEXT NOT NULL);
      INSERT INTO receipts VALUES ('legacy', 'sig', '{"commandId":"legacy"}');`);
    await old.close();
    const store = new HostStore(path);
    cleanups.push(async () => await store.close());
    expect(await store.receipt("legacy", "sig")).toEqual(receipt("legacy"));
  });
  it("reads a durable command status receipt without requiring a retry signature", async () => {
    const directory = open();
    const path = join(directory, "host.db");
    const store = new HostStore(path);
    await store.recordReceipt("sig", receipt("durable"));
    await store.close();
    const reopened = new HostStore(path);
    await reopened.ready;
    cleanups.push(async () => await reopened.close());
    expect(await reopened.receiptStatus("durable")).toEqual(receipt("durable"));
    expect(await reopened.receiptStatus("missing")).toBeUndefined();
  });
});
describe("HostStore checkpointed streaming saves", () => {
  const withText = (base: HostSession, revision: number, text: string): HostSession =>
    ({
      ...base,
      revision,
      updatedAt: 100 + revision,
      session: {
        ...base.session,
        blocks: [{ id: "b", role: "assistant", text, streaming: true }],
      },
    }) as unknown as HostSession;
  const stored = async (path: string, id: string) => {
    const db = new DatabaseSync(path);
    try {
      const row = db.prepare("SELECT snapshot, revision, status FROM sessions WHERE id=?").get(id);
      const events = db
        .prepare("SELECT revision FROM events WHERE session_id=? ORDER BY revision")
        .all(id);
      const state = db.prepare("SELECT revision, status FROM session_state WHERE id=?").get(id);
      return {
        row,
        state,
        events: events.map((event) => Number(event.revision)),
      };
    } finally {
      await db.close();
    }
  };
  async function setup() {
    const directory = open();
    const path = join(directory, "host.db");
    const store = new HostStore(path);
    const project = await store.addProject(directory, "Test");
    const base = session("s", project.id, {
      status: "running",
      desktop: { updatedAt: 1 },
    });
    await store.save(base, { type: "turn" });
    return { store, path, project, base };
  }
  it("writes incremental journals per checkpoint while reads see every soft save", async () => {
    vi.useFakeTimers();
    try {
      const { store, path, base } = await setup();
      cleanups.push(async () => await store.close());
      const writes = store.snapshotWrites;
      for (let revision = 2; revision <= 6; revision++) {
        await store.save(
          withText(base, revision, "x".repeat(revision)),
          { type: "events" },
          { deferred: true },
        );
        expect((await store.session("s")).revision).toBe(revision);
        expect((await store.session("s")).session.blocks[0].text).toBe("x".repeat(revision));
        expect((await store.summaries(base.projectId))[0].revision).toBe(revision);
        expect((await store.adopted())[0].revision).toBe(revision);
        expect((await store.sessions(base.projectId))[0].revision).toBe(revision);
      }
      expect(store.snapshotWrites).toBe(writes);
      expect((await stored(path, "s")).state?.revision).toBe(1);
      await vi.advanceTimersByTimeAsync(1000);
      await store.db.scope(() => undefined);
      expect(store.snapshotWrites).toBe(writes);
      const after = await stored(path, "s");
      expect(after.state?.revision).toBe(6);
      // Checkpoints never rewrite the row that holds the snapshot.
      expect(after.row?.revision).toBe(1);
      expect(after.events).toEqual([1, 2, 3, 4, 5, 6]);
    } finally {
      vi.useRealTimers();
    }
  });
  it("serves a client the same events and revisions as unbatched saves", async () => {
    vi.useFakeTimers();
    try {
      const { store, base } = await setup();
      cleanups.push(async () => await store.close());
      for (let revision = 2; revision <= 4; revision++)
        await store.save(
          withText(base, revision, "t"),
          { type: "events", n: revision },
          { deferred: true },
        );
      const pending = await store.events("s", 1);
      await vi.advanceTimersByTimeAsync(1000);
      await store.db.scope(() => undefined);
      expect(await store.events("s", 1)).toEqual(pending);
      expect(pending.events).toEqual([
        { revision: 2, event: { type: "events", n: 2 } },
        { revision: 3, event: { type: "events", n: 3 } },
        { revision: 4, event: { type: "events", n: 4 } },
      ]);
      expect(pending.revision).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });
  it("a hard save flushes pending state at once and the row equals memory", async () => {
    vi.useFakeTimers();
    try {
      const { store, path, base } = await setup();
      cleanups.push(async () => await store.close());
      await store.save(withText(base, 2, "partial"), { type: "events" }, { deferred: true });
      const settled = await store.save(
        { ...withText(base, 3, "partial done"), status: "idle" },
        { type: "settled" },
      );
      const { row, events } = await stored(path, "s");
      expect(JSON.parse(String(row?.snapshot))).toEqual(settled);
      expect(row?.status).toBe("idle");
      expect((await stored(path, "s")).state).toMatchObject({ revision: 3, status: "idle" });
      expect(events).toEqual([1, 2, 3]);
      // No stale checkpoint timer rewrites anything afterwards.
      const writes = store.snapshotWrites;
      await vi.advanceTimersByTimeAsync(5000);
      await store.db.scope(() => undefined);
      expect(store.snapshotWrites).toBe(writes);
    } finally {
      vi.useRealTimers();
    }
  });
  it("keeps pending state when the LRU cache evicts the session", async () => {
    vi.useFakeTimers();
    try {
      const { store, path, project, base } = await setup();
      cleanups.push(async () => await store.close());
      await store.save(withText(base, 2, "streamed"), { type: "events" }, { deferred: true });
      for (let index = 0; index < 40; index++) {
        await store.save(session(`other-${index}`, project.id), { type: "t" });
        await store.session(`other-${index}`);
      }
      expect((await store.session("s")).session.blocks[0].text).toBe("streamed");
      expect((await stored(path, "s")).state?.revision).toBe(1);
      await vi.advanceTimersByTimeAsync(1000);
      await store.db.scope(() => undefined);
      expect((await stored(path, "s")).state?.revision).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it("close flushes pending state", async () => {
    vi.useFakeTimers();
    try {
      const { store, path, base } = await setup();
      await store.save(withText(base, 2, "last words"), { type: "events" }, { deferred: true });
      await store.close();
      const { row, events } = await stored(path, "s");
      expect(row?.revision).toBe(2);
      expect(String(row?.snapshot)).toContain("last words");
      expect(events).toEqual([1, 2]);
    } finally {
      vi.useRealTimers();
    }
  });
  it("after a crash the last checkpoint survives and startup interrupts the turn", async () => {
    vi.useFakeTimers();
    try {
      const { store, path, base } = await setup();
      await store.save(withText(base, 2, "checkpointed"), { type: "events" }, { deferred: true });
      await vi.advanceTimersByTimeAsync(1000);
      await store.db.scope(() => undefined);
      await store.save(withText(base, 3, "lost tail"), { type: "events" }, { deferred: true });
      // Crash: drop the checkpoint timer and close the raw handle without flushing,
      // so the pending state is lost and no file handle stays open.
      vi.clearAllTimers();
      await store.db.close();
      const reopened = new HostStore(path);
      await reopened.ready;
      cleanups.push(async () => await reopened.close());
      expect((await reopened.session("s")).session.blocks[0].text).toBe("checkpointed");
      const provider = {
        send: vi.fn(),
        stop: async () => {},
        cancel: async () => {},
        bind: vi.fn(),
        approve: () => {},
        answer: () => {},
      };
      const engine = new HostEngine(reopened, { codex: provider });
      await engine.ready;
      cleanups.push(async () => void (await engine.close()));
      expect((await reopened.session("s")).status).toBe("interrupted");
      expect((await reopened.session("s")).session.blocks[0].text).toBe("checkpointed");
      vi.clearAllTimers();
    } finally {
      vi.useRealTimers();
    }
  });
});
