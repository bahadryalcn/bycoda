import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ManagedWorkspace,
  SessionRewindPlan,
  WorkspaceOperation,
  WorkspaceReservation,
} from "./workspace-contracts";
import type {
  ExecutionActivityReservations,
  WorkspaceRegistry,
} from "./workspace-service-contracts";
import {
  type ConversationRewindAdapter,
  type GitSessionRewindOptions,
  GitSessionRewindService,
} from "./session-rewind";
import { durableWrite, GitTurnHistory, gitText, rewindRef, turnGit } from "./turn-git-history";

const temporary: string[] = [];
// A rewind/Undo exercises hundreds of real Git invocations. Shared Windows runners can
// take nearly one second per process; this is integration coverage, not a latency assertion.
vi.setConfig({ testTimeout: 300_000, hookTimeout: 60_000 });
afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});
const clone = <T>(value: T): T => structuredClone(value);
type Transcript = {
  revision: number;
  userBlockIds: string[];
  providerSessionId?: string;
  pendingReplay?: string;
};

async function fixture(linkedAncestor = false) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "bycoda-rewind-"));
  temporary.push(temporaryRoot);
  let root = temporaryRoot;
  if (linkedAncestor) {
    const actual = join(temporaryRoot, "actual");
    root = join(temporaryRoot, "alias");
    await mkdir(actual);
    await symlink(actual, root, process.platform === "win32" ? "junction" : "dir");
  }
  const main = join(root, "main");
  const cwd = join(root, "session");
  const sibling = join(root, "sibling");
  const data = join(root, "private");
  await mkdir(main);
  await mkdir(data);
  await turnGit(main, ["init", "-b", "main"]);
  await turnGit(main, ["config", "core.autocrlf", "false"]);
  await writeFile(join(main, ".gitignore"), "cache/\n");
  await writeFile(join(main, "source.txt"), "base\n");
  await writeFile(join(main, "stable.txt"), "stable\n");
  await turnGit(main, ["add", "."]);
  await turnGit(main, ["commit", "-m", "baseline"]);
  const base = await gitText(main, ["rev-parse", "HEAD"]);
  await turnGit(main, ["worktree", "add", "-b", "bycoda/s/session", cwd]);
  await turnGit(main, ["worktree", "add", "-b", "bycoda/s/sibling", sibling]);
  await writeFile(join(sibling, "source.txt"), "sibling dirty\n");
  await writeFile(join(main, "owner.txt"), "owner untracked\n");
  await mkdir(join(cwd, "cache"));
  await writeFile(join(cwd, "cache", "sentinel.txt"), "ignored generated data\n");
  let workspace: ManagedWorkspace = {
    id: "workspace",
    repositoryId: "repository",
    projectId: "project",
    environmentId: "local",
    owner: { kind: "session", id: "session" },
    path: cwd,
    branchRef: "refs/heads/bycoda/s/session",
    baseRef: "refs/heads/main",
    baseCommit: base,
    targetBranchRef: "refs/heads/main",
    state: "idle",
    directoryState: "present",
    revision: 2,
    lastActivityAt: 100,
    pinned: false,
  };
  const workspacePath = join(data, "workspace.json");
  await durableWrite(workspacePath, JSON.stringify(workspace));
  const transcriptPath = join(data, "transcript.json");
  await durableWrite(
    transcriptPath,
    JSON.stringify({
      revision: 12,
      userBlockIds: ["u1", "u2", "u3"],
      providerSessionId: "old-provider",
    } satisfies Transcript),
  );
  const operationDir = join(data, "operations");
  await mkdir(operationDir);
  const operationIds = new Set<string>();
  const updateReceipts = new Map<string, ManagedWorkspace>();
  const updateRequests = new Map<string, string>();
  const reservations = new Map<string, WorkspaceReservation>();
  const reservationEvents: string[] = [];
  let rejectReservation = false;
  let clock = 1000;
  const readTranscript = async () =>
    JSON.parse(await readFile(transcriptPath, "utf8")) as Transcript;
  const registry = {
    async saveOperation(
      operation: WorkspaceOperation,
      expectedPhase: WorkspaceOperation["phase"] | null,
    ) {
      const previous = await this.getOperation(operation.id);
      if ((previous?.phase ?? null) !== expectedPhase)
        throw new Error("Journal compare-and-set mismatch");
      await durableWrite(join(operationDir, `${operation.id}.json`), JSON.stringify(operation));
      operationIds.add(operation.id);
    },
    async getOperation(id: string) {
      try {
        return JSON.parse(
          await readFile(join(operationDir, `${id}.json`), "utf8"),
        ) as WorkspaceOperation;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async listOperations(workspaceId?: string) {
      const records = await Promise.all([...operationIds].map((id) => this.getOperation(id)));
      return records.filter(
        (record): record is WorkspaceOperation =>
          !!record && (!workspaceId || record.workspaceId === workspaceId),
      );
    },
    async findOperation(request: { workspaceId: string; kind: string; idempotencyKey: string }) {
      return (
        (await this.listOperations(request.workspaceId)).find(
          (operation) =>
            operation.kind === request.kind && operation.idempotencyKey === request.idempotencyKey,
        ) ?? null
      );
    },
    async update(request: Parameters<WorkspaceRegistry["update"]>[0]) {
      const signature = JSON.stringify([
        request.expectedRevision,
        request.reservationId,
        request.changes,
      ]);
      const receipt = updateReceipts.get(request.idempotencyKey);
      if (receipt) {
        if (updateRequests.get(request.idempotencyKey) !== signature)
          throw new Error("Idempotent workspace update payload changed");
        return clone(receipt);
      }
      if (
        workspace.revision !== request.expectedRevision ||
        !reservations.has(request.reservationId)
      )
        throw new Error("Workspace update gate failed");
      workspace = { ...workspace, ...request.changes, revision: workspace.revision + 1 };
      await durableWrite(workspacePath, JSON.stringify(workspace));
      updateReceipts.set(request.idempotencyKey, clone(workspace));
      updateRequests.set(request.idempotencyKey, signature);
      return clone(workspace);
    },
  } as unknown as WorkspaceRegistry;
  const activity: ExecutionActivityReservations = {
    async start() {
      throw new Error("unused fixture start");
    },
    async stop() {},
    async list() {
      return [];
    },
    async reserve(request) {
      const previous = [...reservations.values()].find(
        (entry) => entry.operationId === request.operationId,
      );
      if (previous) return clone(previous);
      if (rejectReservation || reservations.size) throw new Error("Unsettled workspace writer");
      const reservation = { ...request, id: randomUUID(), acquiredAt: clock };
      reservations.set(reservation.id, reservation);
      reservationEvents.push("reserve");
      return clone(reservation);
    },
    async release(id) {
      reservations.delete(id);
      reservationEvents.push("release");
    },
  };
  const conversation: ConversationRewindAdapter = {
    async read() {
      const state = await readTranscript();
      return { revision: state.revision, userBlockIds: state.userBlockIds };
    },
    async settle() {
      reservationEvents.push("settle");
    },
    async withSessionGate(_id, work) {
      return work();
    },
    async rescue(operationId) {
      // Immutable rescue; retrying a prepare never overwrites the old transcript.
      const path = join(data, `${operationId}.transcript-rescue.json`);
      try {
        await writeFile(path, await readFile(transcriptPath), { flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      return path;
    },
    async receipt(operationId) {
      try {
        return JSON.parse(await readFile(join(data, `${operationId}.receipt.json`), "utf8")) as {
          revision: number;
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async restore(request) {
      const previous = await this.receipt(request.operationId);
      if (previous) return previous;
      const state = await readTranscript();
      if (state.revision !== request.expectedRevision)
        throw new Error("Conversation revision mismatch");
      const restored: Transcript =
        request.direction === "undo"
          ? JSON.parse(await readFile(request.transcriptRescueId!, "utf8"))
          : {
              ...state,
              userBlockIds: state.userBlockIds.slice(
                0,
                state.userBlockIds.indexOf(request.userBlockId),
              ),
            };
      restored.revision = state.revision + 1;
      delete restored.providerSessionId;
      restored.pendingReplay = restored.userBlockIds.join("\n");
      await durableWrite(transcriptPath, JSON.stringify(restored));
      const receipt = { revision: restored.revision };
      await durableWrite(
        join(data, `${request.operationId}.receipt.json`),
        JSON.stringify(receipt),
      );
      return receipt;
    },
  };
  const history = new GitTurnHistory({
    root: join(data, "history"),
    workspace: async () => clone(workspace),
  });
  const service = (afterPhase?: GitSessionRewindOptions["afterPhase"]) =>
    new GitSessionRewindService({
      root: join(data, "rewind"),
      history,
      registry,
      activity,
      conversation,
      now: () => clock,
      afterPhase,
    });
  const preview = (instance = service()) =>
    instance.plan({
      workspaceId: workspace.id,
      sessionId: "session",
      expectedRevision: workspace.revision,
      expectedConversationRevision: 12,
      direction: "rewind",
      userBlockId: "u2",
    });
  const request = (plan: SessionRewindPlan, idempotencyKey = randomUUID()) => ({
    workspaceId: workspace.id,
    sessionId: "session",
    expectedRevision: plan.expectedRevision,
    expectedConversationRevision: plan.expectedConversationRevision,
    planToken: plan.token,
    idempotencyKey,
  });
  const indexPath = await gitText(cwd, [
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "index",
  ]);
  async function state() {
    return {
      head: await gitText(cwd, ["rev-parse", "HEAD"]),
      index: await readFile(indexPath),
      paths: (await turnGit(cwd, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]))
        .toString()
        .split("\0")
        .filter(Boolean)
        .sort(),
      source: await readFile(join(cwd, "source.txt"), "utf8"),
      staged: await turnGit(cwd, ["show", ":source.txt"]),
    };
  }
  async function prepareTurns(complex = false) {
    if (!complex) {
      const boundary = await history.begin({
        workspaceId: workspace.id,
        sessionId: "session",
        userBlockId: "u2",
        runId: "run-u2",
        conversationRevision: 10,
      });
      expect(boundary.before.status, JSON.stringify(boundary.before)).toBe("complete");
      const before = await state();
      await writeFile(join(cwd, "source.txt"), "agent commit\n");
      await turnGit(cwd, ["add", "source.txt"]);
      await turnGit(cwd, ["commit", "-m", "agent"]);
      await writeFile(join(cwd, "source.txt"), "after unstaged\n");
      return { before, after: await state() };
    }
    await writeFile(join(cwd, "source.txt"), "before staged\n");
    await turnGit(cwd, ["add", "source.txt"]);
    await writeFile(join(cwd, "source.txt"), "before unstaged\n");
    await writeFile(join(cwd, "before-untracked.txt"), "before untracked\n");
    const boundary = await history.begin({
      workspaceId: workspace.id,
      sessionId: "session",
      userBlockId: "u2",
      runId: "run-u2",
      conversationRevision: 10,
    });
    expect(boundary.before.status, JSON.stringify(boundary.before)).toBe("complete");
    const before = await state();
    await writeFile(join(cwd, "source.txt"), "agent commit one\n");
    await turnGit(cwd, ["add", "source.txt"]);
    await turnGit(cwd, ["commit", "-m", "agent one"]);
    await writeFile(join(cwd, "agent-new.txt"), "agent committed new\n");
    await turnGit(cwd, ["add", "agent-new.txt"]);
    await turnGit(cwd, ["commit", "-m", "agent two"]);
    await writeFile(join(cwd, "source.txt"), "after staged\n");
    await turnGit(cwd, ["add", "source.txt"]);
    await writeFile(join(cwd, "source.txt"), "after unstaged\n");
    await writeFile(join(cwd, "after-untracked.txt"), "after untracked\n");
    await writeFile(join(cwd, "before-untracked.txt"), "after changed untracked\n");
    const completed = await history.end({
      workspaceId: workspace.id,
      sessionId: "session",
      userBlockId: "u2",
      runId: "run-u2",
    });
    expect(completed.after?.status, JSON.stringify(completed.after)).toBe("complete");
    return { before, after: await state() };
  }
  return {
    root,
    main,
    cwd,
    sibling,
    base,
    service,
    registry,
    history,
    conversation,
    readTranscript,
    preview,
    request,
    state,
    prepareTurns,
    reservations,
    reservationEvents,
    operationIds,
    indexPath,
    get workspace() {
      return workspace;
    },
    advanceClock() {
      clock += 61_000;
    },
    rejectWriters() {
      rejectReservation = true;
    },
    async changeConversation(userBlockId?: string) {
      const state = await readTranscript();
      await durableWrite(
        transcriptPath,
        JSON.stringify({
          ...state,
          revision: state.revision + 1,
          ...(userBlockId ? { userBlockIds: [...state.userBlockIds, userBlockId] } : {}),
        }),
      );
    },
    changeWorkspace() {
      workspace.revision += 3;
    },
  };
}

describe("managed session Git rewind", () => {
  it("rewinds and undoes beneath an aliased ancestor while refusing a link inside the workspace", async () => {
    const f = await fixture(true);
    const { before, after } = await f.prepareTurns();
    const service = f.service();
    const receipt = await service.apply(f.request(await f.preview(service)));
    expect(await f.state()).toEqual(before);
    const undo = await service.plan({
      workspaceId: "workspace",
      sessionId: "session",
      expectedRevision: receipt.workspaceRevision,
      expectedConversationRevision: receipt.conversationRevision,
      direction: "undo",
      operationId: receipt.operationId,
    });
    await service.undo(f.request(undo));
    expect(await f.state()).toEqual(after);
    const link = join(f.cwd, "unsafe");
    await symlink(f.main, link, process.platform === "win32" ? "junction" : "dir");
    try {
      const boundary = await f.history.begin({
        workspaceId: "workspace",
        sessionId: "session",
        userBlockId: "unsafe",
        runId: "unsafe",
        conversationRevision: 14,
      });
      expect(boundary.before).toMatchObject({
        status: "blocked",
        reason: expect.stringMatching(/Unsafe (captured path|symlink|parent)/),
      });
      expect(await readFile(join(f.main, "owner.txt"), "utf8")).toBe("owner untracked\n");
      expect(await gitText(f.main, ["rev-parse", "HEAD"])).toBe(f.base);
    } finally {
      await rm(link);
    }
  });

  it("rewinds several agent commits and exact staged/unstaged/untracked bytes; Undo restores rescue and sibling checkouts stay unchanged", async () => {
    const f = await fixture();
    const { before, after } = await f.prepareTurns(true);
    const service = f.service();
    const plan = await f.preview(service);
    expect(plan.removedUserBlockIds).toEqual(["u2", "u3"]);
    expect(plan.affectedCommits).toHaveLength(2);
    expect(plan.affectedPaths).toEqual(
      expect.arrayContaining(["source.txt", "agent-new.txt", "after-untracked.txt"]),
    );
    const request = f.request(plan);
    const receipt = await service.apply(request);
    expect(await f.state()).toEqual(before);
    expect(await readFile(join(f.cwd, "before-untracked.txt"), "utf8")).toBe("before untracked\n");
    expect(await f.readTranscript()).toMatchObject({
      revision: 13,
      userBlockIds: ["u1"],
      pendingReplay: "u1",
    });
    expect((await f.readTranscript()).providerSessionId).toBeUndefined();
    expect(await gitText(f.cwd, ["rev-parse", rewindRef(receipt.operationId, "rescue-head")])).toBe(
      after.head,
    );
    for (const phase of ["rescue-index", "rescue-worktree"] as const)
      expect(await gitText(f.cwd, ["cat-file", "-t", rewindRef(receipt.operationId, phase)])).toBe(
        "commit",
      );
    expect(await service.apply(request)).toEqual(receipt);
    expect(
      await service.apply({
        planToken: request.planToken,
        idempotencyKey: request.idempotencyKey,
        expectedConversationRevision: request.expectedConversationRevision,
        sessionId: request.sessionId,
        workspaceId: request.workspaceId,
        expectedRevision: request.expectedRevision,
      }),
    ).toEqual(receipt);
    expect(f.reservations.size).toBe(0);
    expect(f.reservationEvents.slice(0, 2)).toEqual(["settle", "reserve"]);
    const undoPlan = await service.plan({
      workspaceId: "workspace",
      sessionId: "session",
      expectedRevision: receipt.workspaceRevision,
      expectedConversationRevision: receipt.conversationRevision,
      direction: "undo",
      operationId: receipt.operationId,
    });
    expect(undoPlan.affectedCommits).toHaveLength(2);
    const undo = await service.undo(f.request(undoPlan));
    expect(undo.direction).toBe("undo");
    expect(await f.state()).toEqual(after);
    expect(await f.readTranscript()).toMatchObject({
      revision: 14,
      userBlockIds: ["u1", "u2", "u3"],
    });
    expect((await f.readTranscript()).providerSessionId).toBeUndefined();
    expect(await readFile(join(f.cwd, "before-untracked.txt"), "utf8")).toBe(
      "after changed untracked\n",
    );
    expect(await readFile(join(f.cwd, "cache", "sentinel.txt"), "utf8")).toBe(
      "ignored generated data\n",
    );
    expect(await gitText(f.main, ["rev-parse", "HEAD"])).toBe(f.base);
    expect(await readFile(join(f.main, "owner.txt"), "utf8")).toBe("owner untracked\n");
    expect(await gitText(f.sibling, ["rev-parse", "HEAD"])).toBe(f.base);
    expect(await readFile(join(f.sibling, "source.txt"), "utf8")).toBe("sibling dirty\n");
    f.workspace.directoryState = "removed";
    expect(await service.apply(request)).toEqual(receipt);
  });

  it.each(["prepared", "git-restored", "conversation-restored", "complete"] as const)(
    "reconciles a restart after durable %s phase without replaying transcript edits",
    async (failurePhase) => {
      const f = await fixture();
      const { before } = await f.prepareTurns();
      const failing = f.service(async (phase) => {
        if (phase === failurePhase) throw new Error("simulated crash");
      });
      const request = f.request(await f.preview(failing));
      await expect(failing.apply(request)).rejects.toThrow("simulated crash");
      const operationId = [...f.operationIds][0];
      expect(operationId).toBeTruthy();
      const restarted = f.service();
      if (failurePhase !== "complete")
        await expect(restarted.assertWritable("workspace")).rejects.toThrow("recovery");
      const recovered = await restarted.recover(operationId);
      expect(recovered.phase).toBe("complete");
      expect(await f.state()).toEqual(before);
      expect(await restarted.apply(request)).toEqual(recovered.receipt);
      expect((await f.readTranscript()).revision).toBe(13);
      expect(f.workspace.revision).toBe(3);
      expect(f.reservations.size).toBe(0);
      await expect(restarted.assertWritable("workspace")).resolves.toBeUndefined();
    },
  );

  it.each(["content", "head", "index", "conversation", "workspace"] as const)(
    "refuses %s drift after preview without restoring Git or transcript",
    async (drift) => {
      const f = await fixture();
      await f.prepareTurns();
      const service = f.service();
      const request = f.request(await f.preview(service));
      if (drift === "content")
        await writeFile(join(f.cwd, "source.txt"), "external unsaved data\n");
      if (drift === "head") {
        await turnGit(f.cwd, ["add", "source.txt"]);
        await turnGit(f.cwd, ["commit", "-m", "external commit"]);
      }
      if (drift === "index") await turnGit(f.cwd, ["add", "source.txt"]);
      if (drift === "conversation") await f.changeConversation();
      if (drift === "workspace") f.changeWorkspace();
      const current = await f.state();
      const transcript = await f.readTranscript();
      await expect(service.apply(request)).rejects.toThrow(/changed|revision/);
      expect(await f.state()).toEqual(current);
      expect(await f.readTranscript()).toEqual(transcript);
      expect(f.operationIds.size).toBe(0);
      expect(f.reservations.size).toBe(0);
    },
  );

  it("blocks pending recovery on external edits and preserves those edits and rescue refs", async () => {
    const f = await fixture();
    const { after } = await f.prepareTurns();
    const failing = f.service(async (phase) => {
      if (phase === "prepared") throw new Error("simulated crash");
    });
    await expect(failing.apply(f.request(await f.preview(failing)))).rejects.toThrow(
      "simulated crash",
    );
    await writeFile(join(f.cwd, "source.txt"), "external after crash\n");
    const restarted = f.service();
    const result = await restarted.recoverPending();
    expect(result).toHaveLength(1);
    expect(result[0].error).toMatch(/drift/);
    await expect(restarted.assertWritable("workspace")).rejects.toThrow("recovery");
    expect(await readFile(join(f.cwd, "source.txt"), "utf8")).toBe("external after crash\n");
    expect(await gitText(f.cwd, ["rev-parse", "HEAD"])).toBe(after.head);
    expect(
      await gitText(f.cwd, ["rev-parse", rewindRef(result[0].operationId, "rescue-head")]),
    ).toBe(after.head);
    expect((await f.readTranscript()).revision).toBe(12);
    expect(f.reservations.size).toBe(1);
  });

  it("refuses an external edit that arrives after preview recheck but before rescue capture", async () => {
    const f = await fixture();
    const { after } = await f.prepareTurns();
    const service = f.service();
    const request = f.request(await f.preview(service));
    const capture = f.history.capture.bind(f.history);
    f.history.capture = async (workspace) => {
      await writeFile(join(f.cwd, "source.txt"), "external during rescue capture\n");
      return capture(workspace);
    };
    await expect(service.apply(request)).rejects.toThrow(/changed|drift/);
    const current = await f.state();
    expect(current.head).toBe(after.head);
    expect(current.index).toEqual(after.index);
    expect(current.source).toBe("external during rescue capture\n");
    expect(f.operationIds.size).toBe(0);
    expect(f.reservations.size).toBe(0);
    expect((await f.readTranscript()).revision).toBe(12);
  });

  it.each(["transcript-receipt", "registry-update"] as const)(
    "reconciles a crash after %s commits but before the next journal phase",
    async (failureBoundary) => {
      const f = await fixture();
      const { before } = await f.prepareTurns();
      if (failureBoundary === "transcript-receipt") {
        const restore = f.conversation.restore.bind(f.conversation);
        let crashed = false;
        f.conversation.restore = async (request) => {
          const receipt = await restore(request);
          if (!crashed) {
            crashed = true;
            throw new Error("commit-before-journal crash");
          }
          return receipt;
        };
      } else {
        const update = f.registry.update.bind(f.registry);
        let crashed = false;
        f.registry.update = async (request) => {
          const receipt = await update(request);
          if (!crashed) {
            crashed = true;
            throw new Error("commit-before-journal crash");
          }
          return receipt;
        };
      }
      const service = f.service();
      const request = f.request(await f.preview(service));
      await expect(service.apply(request)).rejects.toThrow("commit-before-journal crash");
      f.advanceClock(); // The durable update payload must remain identical across restart/time drift.
      const restarted = f.service();
      const receipt = await restarted.apply(request);
      expect(receipt.workspaceRevision).toBe(3);
      expect(receipt.conversationRevision).toBe(13);
      expect(await f.state()).toEqual(before);
      expect((await f.readTranscript()).revision).toBe(13);
      expect(f.workspace.revision).toBe(3);
      expect(f.reservations.size).toBe(0);
    },
  );

  it.each(["rescue-not-written", "rescue-written-journal-not-updated"] as const)(
    "recovers Host prepared intent when native %s",
    async (failureBoundary) => {
      const f = await fixture();
      const { before, after } = await f.prepareTurns();
      let crashed = false;
      if (failureBoundary === "rescue-not-written") {
        const rescue = f.conversation.rescue.bind(f.conversation);
        f.conversation.rescue = async (...args) => {
          if (!crashed) {
            crashed = true;
            throw new Error("native rescue unavailable");
          }
          return rescue(...args);
        };
      } else {
        const saveOperation = f.registry.saveOperation.bind(f.registry);
        f.registry.saveOperation = async (operation, previousPhase) => {
          if (
            !crashed &&
            operation.kind === "rewind" &&
            operation.transcriptRescueId &&
            previousPhase === "prepared"
          ) {
            crashed = true;
            throw new Error("native rescue unavailable");
          }
          await saveOperation(operation, previousPhase);
        };
      }
      const service = f.service();
      const request = f.request(await f.preview(service));
      await expect(service.apply(request)).rejects.toThrow("native rescue unavailable");
      expect(await f.state()).toEqual(after);
      expect((await f.readTranscript()).revision).toBe(12);
      const restarted = f.service();
      await expect(restarted.assertWritable("workspace")).rejects.toThrow("recovery");
      const receipt = await restarted.apply(request);
      expect(receipt.conversationRevision).toBe(13);
      expect(await f.state()).toEqual(before);
      expect(f.reservations.size).toBe(0);
    },
  );

  it("keeps a complete Host journal write-fenced until native acknowledgement and reservation release finalize", async () => {
    const f = await fixture();
    const { before } = await f.prepareTurns();
    let acknowledgements = 0;
    f.conversation.complete = async () => {
      acknowledgements += 1;
      if (acknowledgements === 1) throw new Error("native acknowledgement unavailable");
    };
    const service = f.service();
    const request = f.request(await f.preview(service));
    await expect(service.apply(request)).rejects.toThrow("native acknowledgement unavailable");
    expect(await f.state()).toEqual(before);
    expect((await f.readTranscript()).revision).toBe(13);
    expect(f.reservations.size).toBe(1);
    const restarted = f.service();
    await expect(restarted.assertWritable("workspace")).rejects.toThrow("recovery");
    const receipt = await restarted.apply(request);
    expect(receipt.conversationRevision).toBe(13);
    expect(receipt.workspaceRevision).toBe(3);
    expect(acknowledgements).toBe(2);
    expect(f.reservations.size).toBe(0);
    await expect(restarted.assertWritable("workspace")).resolves.toBeUndefined();
  });

  it("requires a fresh Undo preview after later work and does not reuse an idempotency key for changed payloads", async () => {
    const f = await fixture();
    await f.prepareTurns();
    const service = f.service();
    const request = f.request(await f.preview(service));
    const receipt = await service.apply(request);
    await expect(service.apply({ ...request, sessionId: "another-session" })).rejects.toThrow(
      "Idempotency",
    );
    const plan = await service.plan({
      workspaceId: "workspace",
      sessionId: "session",
      expectedRevision: receipt.workspaceRevision,
      expectedConversationRevision: receipt.conversationRevision,
      direction: "undo",
      operationId: receipt.operationId,
    });
    await writeFile(join(f.cwd, "later-work.txt"), "later work\n");
    await f.changeConversation("later-user-turn");
    await expect(service.undo(f.request(plan))).rejects.toThrow("changed");
    expect(await readFile(join(f.cwd, "later-work.txt"), "utf8")).toBe("later work\n");
    const fresh = await service.plan({
      workspaceId: "workspace",
      sessionId: "session",
      expectedRevision: receipt.workspaceRevision,
      expectedConversationRevision: (await f.readTranscript()).revision,
      direction: "undo",
      operationId: receipt.operationId,
    });
    expect(fresh.removedUserBlockIds).toEqual(["later-user-turn"]);
    expect(fresh.affectedPaths).toContain("later-work.txt");
    await service.undo(f.request(fresh));
    expect((await f.readTranscript()).userBlockIds).toEqual(["u1", "u2", "u3"]);
    await expect(readFile(join(f.cwd, "later-work.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an expired preview and in-use workspaces before rescue or mutation", async () => {
    const f = await fixture();
    await f.prepareTurns();
    const service = f.service();
    const request = f.request(await f.preview(service));
    const current = await f.state();
    f.advanceClock();
    await expect(service.apply(request)).rejects.toThrow("stale");
    const fresh = f.request(await f.preview(service));
    f.rejectWriters();
    await expect(service.apply(fresh)).rejects.toThrow("writer");
    expect(await f.state()).toEqual(current);
    expect(f.operationIds.size).toBe(0);
  });

  it("discloses a merged/published branch as local-only and leaves main and remote refs unchanged", async () => {
    const f = await fixture();
    await f.prepareTurns();
    f.workspace.state = "merged";
    const published = await gitText(f.cwd, ["rev-parse", "HEAD"]);
    await turnGit(f.cwd, ["update-ref", "refs/remotes/origin/session", published]);
    const service = f.service();
    const plan = await f.preview(service);
    expect(plan.merged).toBe(true);
    expect(plan.published).toBe(true);
    await service.apply(f.request(plan));
    expect(await gitText(f.cwd, ["rev-parse", "refs/remotes/origin/session"])).toBe(published);
    expect(await gitText(f.main, ["rev-parse", "HEAD"])).toBe(f.base);
  });

  it("does not offer an exact rewind for unsupported sparse capture or an unknown accepted turn", async () => {
    const f = await fixture();
    await turnGit(f.cwd, ["config", "core.sparseCheckout", "true"]);
    const boundary = await f.history.begin({
      workspaceId: "workspace",
      sessionId: "session",
      userBlockId: "u2",
      runId: "run",
      conversationRevision: 10,
    });
    expect(boundary.before.status).toBe("blocked");
    await expect(f.preview()).rejects.toThrow("no complete exact Git boundary");
    await expect(
      f.service().plan({
        workspaceId: "workspace",
        sessionId: "session",
        expectedRevision: 2,
        expectedConversationRevision: 12,
        direction: "rewind",
        userBlockId: "unknown",
      }),
    ).rejects.toThrow("no complete exact Git boundary");
  });
});
