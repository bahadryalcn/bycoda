import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HostBranchDeliveryService,
  DeliveryEffectNotAppliedError,
  type DeliveryPublicationAdapter,
} from "./branch-delivery";
import { hostGitRepositoryKey } from "./git-mutations";
import type { ManagedWorkspace, WorkspaceOperation } from "./workspace-contracts";
import type {
  ExecutionActivityReservations,
  WorkspaceRegistry,
} from "./workspace-service-contracts";

const dirs: string[] = [];
// These cases intentionally exercise full Git/index transactions on Windows.
vi.setConfig({ testTimeout: 120_000 });
afterEach(() => {
  for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true });
});
const owner = { ownerId: "owner", authorizationId: "trusted-owner-session" };
async function fixture() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "bycoda-delivery-")));
  dirs.push(root);
  const cwd = join(root, "repo");
  const source = join(root, "source");
  const run = (path: string, ...args: string[]) =>
    execFileSync("git", args, {
      cwd: path,
      windowsHide: true,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  run(root, "init", "-q", "--initial-branch=main", cwd);
  const git = (...args: string[]) => run(cwd, ...args);
  git("config", "user.name", "Delivery Test");
  git("config", "user.email", "delivery@example.test");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  const write = (name: string, text: string, path = cwd) => writeFileSync(join(path, name), text);
  write("shared.txt", "base\n");
  write("unrelated.txt", "base\n");
  write("staged.txt", "base\n");
  git("add", ".");
  git("commit", "-qm", "base");
  const baseCommit = git("rev-parse", "HEAD");
  git("worktree", "add", "-qb", "bycoda/t/test", source);
  write("shared.txt", "source\n", source);
  run(source, "add", "shared.txt");
  run(source, "commit", "-qm", "source work");
  const sourceHead = run(source, "rev-parse", "HEAD");
  let workspace: ManagedWorkspace = {
    id: "workspace",
    repositoryId: await hostGitRepositoryKey(cwd),
    projectId: "project",
    environmentId: "local",
    owner: { kind: "task", id: "task" },
    path: source,
    branchRef: "refs/heads/bycoda/t/test",
    baseRef: "refs/heads/main",
    baseCommit,
    targetBranchRef: "refs/heads/main",
    state: "finished",
    directoryState: "present",
    revision: 3,
    lastActivityAt: Date.now(),
    pinned: false,
  };
  const operations = new Map<string, WorkspaceOperation>();
  const registry = {
    get: vi.fn(async () => structuredClone(workspace)),
    update: vi.fn(async (request) => {
      if (request.expectedRevision !== workspace.revision) throw new Error("Revision changed");
      workspace = { ...workspace, ...request.changes, revision: workspace.revision + 1 };
      return structuredClone(workspace);
    }),
    saveOperation: vi.fn(async (operation, expectedPhase) => {
      const previous = operations.get(operation.id);
      if ((previous?.phase ?? null) !== expectedPhase) throw new Error("Operation CAS failed");
      operations.set(operation.id, structuredClone(operation));
    }),
    getOperation: vi.fn(async (id) => structuredClone(operations.get(id) ?? null)),
    findOperation: vi.fn(async (request) =>
      structuredClone(
        [...operations.values()].find(
          (operation) =>
            operation.workspaceId === request.workspaceId &&
            operation.idempotencyKey === request.idempotencyKey &&
            operation.kind === request.kind,
        ) ?? null,
      ),
    ),
  } as unknown as WorkspaceRegistry;
  const reservations = {
    reserve: vi.fn(async () => ({ id: "reservation" })),
    release: vi.fn(async () => undefined),
  } as unknown as ExecutionActivityReservations;
  const authorize = vi.fn(async (proof) => {
    if (proof.authorizationId !== owner.authorizationId) throw new Error("Unauthorized owner");
  });
  const publication: DeliveryPublicationAdapter = {
    fingerprint: vi.fn(async () => "remote-url-and-publication-fingerprint"),
    push: vi.fn(async () => ({
      remote: "origin",
      branchRef: workspace.branchRef,
      sourceHead,
      pushedAt: 1,
    })),
    findPush: vi.fn(async () => null),
    createPr: vi.fn(async () => ({
      repository: "owner/repo",
      number: 5,
      url: "https://example.test/5",
      sourceHead,
      createdAt: 1,
    })),
    findPr: vi.fn(async () => null),
  };
  const createService = (extra = {}) =>
    new HostBranchDeliveryService({
      registry,
      reservations,
      targetDirectory: async () => cwd,
      authorize,
      publication,
      ...extra,
    });
  const service = createService();
  const review = () =>
    service.review({
      workspaceId: "workspace",
      expectedRevision: workspace.revision,
      action: "merge",
    });
  const mutation = (token: string, idempotencyKey = "merge") => ({
    workspaceId: "workspace",
    expectedRevision: 3,
    planToken: token,
    idempotencyKey,
  });
  return {
    root,
    cwd,
    source,
    git,
    run,
    write,
    registry,
    reservations,
    operations,
    authorize,
    publication,
    createService,
    service,
    review,
    mutation,
    sourceHead,
    baseCommit,
    workspace: () => workspace,
    mutateWorkspace: (changes: Partial<ManagedWorkspace>) => {
      workspace = { ...workspace, ...changes };
    },
  };
}

describe("SHA-bound branch delivery", () => {
  it("reviews a patch and commits, merges while preserving unrelated staged/unstaged/untracked bytes", async () => {
    const r = await fixture();
    r.write("unrelated.txt", "owner unstaged\n");
    r.write("staged.txt", "owner staged\n");
    r.git("add", "staged.txt");
    r.write("staged.txt", "owner staged plus unstaged\n");
    r.write("untracked.txt", "owner untracked\n");
    const beforeStatus = r.git("status", "--porcelain=v1");
    const beforeIndex = r.git("show", ":staged.txt");
    const plan = await r.review();
    expect(plan.blockers).toEqual([]);
    expect(plan.diff).toContain("+source");
    expect(plan.commits[0]).toContain("source work");
    const receipt = await r.service.merge(r.mutation(plan.token), owner);
    expect(receipt.sourceHead).toBe(r.sourceHead);
    expect(r.git("status", "--porcelain=v1")).toBe(beforeStatus);
    expect(r.git("show", ":staged.txt")).toBe(beforeIndex);
    expect(readFileSync(join(r.cwd, "staged.txt"), "utf8")).toBe("owner staged plus unstaged\n");
    expect(readFileSync(join(r.cwd, "unrelated.txt"), "utf8")).toBe("owner unstaged\n");
    expect(readFileSync(join(r.cwd, "untracked.txt"), "utf8")).toBe("owner untracked\n");
    expect(r.git("show", `${receipt.targetHead}:staged.txt`)).toBe("base");
    expect(r.git("rev-list", "--parents", "-n", "1", "HEAD").split(" ").slice(1)).toEqual([
      r.baseCommit,
      r.sourceHead,
    ]);
    expect(r.workspace().state).toBe("merged");
    expect(await r.service.merge(r.mutation(plan.token), owner)).toEqual(receipt);
    expect(r.reservations.reserve).toHaveBeenCalledTimes(1);
  });
  it.each(["unstaged", "staged", "untracked", "rename"])(
    "blocks %s target overlap without altering source or target",
    async (kind) => {
      const r = await fixture();
      if (kind === "untracked") {
        r.git("rm", "shared.txt");
        r.git("commit", "-qm", "remove target file");
        r.write("shared.txt", "owner\n");
      } else if (kind === "rename") r.git("mv", "shared.txt", "renamed.txt");
      else {
        r.write("shared.txt", "owner\n");
        if (kind === "staged") r.git("add", "shared.txt");
      }
      const before = r.git("status", "--porcelain=v1");
      const plan = await r.review();
      expect(plan.overlappingPaths).toContain("shared.txt");
      await expect(r.service.merge(r.mutation(plan.token), owner)).rejects.toThrow("overlaps");
      expect(r.git("status", "--porcelain=v1")).toBe(before);
    },
  );
  it.each(["target bytes", "source head", "target head", "workspace revision"])(
    "rejects drift of %s",
    async (kind) => {
      const r = await fixture();
      r.write("unrelated.txt", "before\n");
      const plan = await r.review();
      if (kind === "target bytes") r.write("unrelated.txt", "after\n");
      else if (kind === "source head") {
        r.write("shared.txt", "more\n", r.source);
        r.run(r.source, "commit", "-am", "more");
      } else if (kind === "target head") {
        r.write("staged.txt", "target\n");
        r.git("add", "staged.txt");
        r.git("commit", "-qm", "target");
      } else r.mutateWorkspace({ revision: 4 });
      await expect(r.service.merge(r.mutation(plan.token), owner)).rejects.toThrow(
        /changed|review/,
      );
      expect(r.operations.size).toBe(0);
    },
  );
  it("checks trusted owner authorization and rejects mutated preview objects", async () => {
    const r = await fixture();
    const plan = await r.review();
    plan.sourceHead = r.baseCommit;
    await expect(
      r.service.merge(r.mutation(plan.token), { ownerId: "agent", authorizationId: "forged" }),
    ).rejects.toThrow("Unauthorized");
    const receipt = await r.service.merge(r.mutation(plan.token), owner);
    expect(receipt.sourceHead).toBe(r.sourceHead);
  });
  it("blocks an ignored owner file that a source commit would overwrite", async () => {
    const r = await fixture();
    r.write(".gitignore", "private.txt\n");
    r.git("add", ".gitignore");
    r.git("commit", "-qm", "ignore private file");
    r.write("private.txt", "private owner bytes\n");
    r.write("private.txt", "source addition\n", r.source);
    r.run(r.source, "add", "private.txt");
    r.run(r.source, "commit", "-qm", "add file");
    const plan = await r.review();
    expect(plan.overlappingPaths).toContain("private.txt");
    await expect(r.service.merge(r.mutation(plan.token), owner)).rejects.toThrow("overlaps");
    expect(readFileSync(join(r.cwd, "private.txt"), "utf8")).toBe("private owner bytes\n");
  });
  it("checks expiry and fresh state after reservation acquisition", async () => {
    const r = await fixture();
    let now = 1;
    const service = r.createService({ now: () => now, planLifetimeMs: 10 });
    const expired = await service.review({
      workspaceId: "workspace",
      expectedRevision: 3,
      action: "merge",
    });
    now = 12;
    await expect(service.merge(r.mutation(expired.token), owner)).rejects.toThrow("expired");
    const fresh = await r.review();
    vi.mocked(r.reservations.reserve).mockImplementationOnce(async () => {
      r.write("unrelated.txt", "late edit\n");
      return { id: "reservation" } as never;
    });
    await expect(r.service.merge(r.mutation(fresh.token), owner)).rejects.toThrow("changed");
    expect(r.reservations.release).toHaveBeenCalledWith("reservation");
  });
  it("blocks committed conflicts without disturbing a dirty target", async () => {
    const r = await fixture();
    r.write("shared.txt", "target\n");
    r.git("add", "shared.txt");
    r.git("commit", "-qm", "target conflict");
    r.write("unrelated.txt", "owner\n");
    const before = r.git("status", "--porcelain=v1");
    const plan = await r.review();
    expect(plan.blockers.join(" ")).toContain("conflict");
    await expect(r.service.merge(r.mutation(plan.token), owner)).rejects.toThrow("conflict");
    expect(r.git("status", "--porcelain=v1")).toBe(before);
    expect(r.git("rev-parse", "--verify", "HEAD")).toBe(plan.targetHead);
  });
  it("delivers a retained committed branch after its source directory retires", async () => {
    const r = await fixture();
    r.git("worktree", "remove", r.source);
    r.mutateWorkspace({ directoryState: "removed" });
    const plan = await r.review();
    const receipt = await r.service.merge(r.mutation(plan.token), owner);
    expect(receipt.sourceHead).toBe(r.sourceHead);
  });
  it("recovers a successful ref update whose completion journal failed without merging twice", async () => {
    const r = await fixture();
    const plan = await r.review();
    const save = vi.mocked(r.registry.saveOperation).getMockImplementation()!;
    let failed = false;
    vi.mocked(r.registry.saveOperation).mockImplementation(async (operation, phase) => {
      if (operation.kind === "delivery" && operation.phase === "merged" && !failed) {
        failed = true;
        throw new Error("journal unavailable after Git update");
      }
      await save(operation, phase);
    });
    await expect(r.service.merge(r.mutation(plan.token), owner)).rejects.toThrow(
      "journal unavailable",
    );
    const operation = [...r.operations.values()][0];
    expect(operation.phase).toBe("blocked");
    const head = r.git("rev-parse", "HEAD");
    const recovered = await r.createService().recover(operation.id);
    expect(recovered.phase).toBe("complete");
    expect(r.git("rev-parse", "HEAD")).toBe(head);
    expect(r.workspace().deliveredCommit).toBe(head);
  });
  it("holds an interrupted index update without resetting or cleaning the target", async () => {
    const r = await fixture();
    const plan = await r.review();
    const save = vi.mocked(r.registry.saveOperation).getMockImplementation()!;
    vi.mocked(r.registry.saveOperation).mockImplementation(async (operation, phase) => {
      await save(operation, phase);
      const intended = (operation as WorkspaceOperation & { intendedTargetHead?: string })
        .intendedTargetHead;
      if (operation.phase === "prepared" && intended) {
        r.git("read-tree", "-m", "-u", plan.targetHead, intended);
        throw new Error("process interrupted after index change");
      }
    });
    await expect(r.service.merge(r.mutation(plan.token), owner)).rejects.toThrow("interrupted");
    const operation = [...r.operations.values()][0];
    const index = r.git("ls-files", "--stage");
    const recovered = await r.createService().recover(operation.id);
    expect(recovered.phase).toBe("blocked");
    expect(r.git("rev-parse", "HEAD")).toBe(plan.targetHead);
    expect(r.git("ls-files", "--stage")).toBe(index);
    expect(readFileSync(join(r.cwd, "shared.txt"), "utf8")).toBe("source\n");
    expect(r.reservations.release).not.toHaveBeenCalled();
  });
});

describe("publication receipts", () => {
  async function publicationFixture() {
    const r = await fixture();
    const plan = await r.service.review({
      workspaceId: "workspace",
      expectedRevision: 3,
      action: "publish",
      publication: {
        repository: "owner/repo",
        remote: "origin",
        baseBranchRef: "refs/heads/main",
        headBranchRef: "refs/heads/bycoda/t/test",
        title: "Title",
        body: "Body\nsecond line",
      },
    });
    return { ...r, plan };
  }
  it("resumes a known PR failure after push without pushing the branch twice", async () => {
    const r = await publicationFixture();
    vi.mocked(r.publication.createPr).mockRejectedValueOnce(
      new DeliveryEffectNotAppliedError("PR validation rejected before creation"),
    );
    const first = await r.service.publish(r.mutation(r.plan.token, "publish"), owner);
    expect(first.status).toBe("blocked");
    expect(first.push?.sourceHead).toBe(r.sourceHead);
    const second = await r.createService().publish(r.mutation(r.plan.token, "publish"), owner);
    expect(second.status).toBe("complete");
    expect(r.publication.push).toHaveBeenCalledTimes(1);
    expect(r.publication.createPr).toHaveBeenCalledTimes(2);
  });
  it("records separate push and PR receipts and returns duplicate completion", async () => {
    const r = await publicationFixture();
    const receipt = await r.service.publish(r.mutation(r.plan.token, "publish"), owner);
    expect(receipt.status).toBe("complete");
    expect(receipt.push?.sourceHead).toBe(r.sourceHead);
    expect(receipt.pullRequest?.number).toBe(5);
    expect(await r.service.publish(r.mutation(r.plan.token, "publish"), owner)).toEqual(receipt);
    expect(r.publication.push).toHaveBeenCalledTimes(1);
    expect(r.publication.createPr).toHaveBeenCalledTimes(1);
    expect(r.workspace().state).toBe("finished");
  });
  it("reconciles a lost PR receipt after push without duplicating either publication", async () => {
    const r = await publicationFixture();
    vi.mocked(r.publication.createPr).mockRejectedValueOnce(
      new Error("connection lost after PR request"),
    );
    const receipt = await r.service.publish(r.mutation(r.plan.token, "publish"), owner);
    expect(receipt.status).toBe("blocked");
    expect(receipt.push?.sourceHead).toBe(r.sourceHead);
    const restored = r.createService();
    vi.mocked(r.publication.findPr).mockResolvedValue({
      repository: "owner/repo",
      number: 8,
      url: "https://example.test/8",
      sourceHead: r.sourceHead,
      createdAt: 2,
    });
    const result = await restored.publish(r.mutation(r.plan.token, "publish"), owner);
    expect(result.status).toBe("complete");
    expect(result.pullRequest?.number).toBe(8);
    expect(r.publication.push).toHaveBeenCalledTimes(1);
    expect(r.publication.createPr).toHaveBeenCalledTimes(1);
  });
  it("holds an unknown push until its exact remote source SHA is reconciled", async () => {
    const r = await publicationFixture();
    vi.mocked(r.publication.push).mockRejectedValueOnce(new Error("unknown push outcome"));
    const result = await r.service.publish(r.mutation(r.plan.token, "publish"), owner);
    expect(result.status).toBe("blocked");
    expect((await r.service.publish(r.mutation(r.plan.token, "publish"), owner)).status).toBe(
      "blocked",
    );
    expect(r.publication.push).toHaveBeenCalledTimes(1);
    expect(r.publication.createPr).not.toHaveBeenCalled();
    vi.mocked(r.publication.findPush).mockResolvedValue({
      remote: "origin",
      branchRef: r.plan.sourceBranchRef,
      sourceHead: r.sourceHead,
      pushedAt: 2,
    });
    expect((await r.service.publish(r.mutation(r.plan.token, "publish"), owner)).status).toBe(
      "complete",
    );
    expect(r.publication.push).toHaveBeenCalledTimes(1);
  });
  it("refuses changed publication destinations and changed idempotency payloads", async () => {
    const r = await publicationFixture();
    vi.mocked(r.publication.fingerprint).mockResolvedValue("different destination");
    await expect(r.service.publish(r.mutation(r.plan.token, "publish"), owner)).rejects.toThrow(
      "destination changed",
    );
    expect(r.publication.push).not.toHaveBeenCalled();
    vi.mocked(r.publication.fingerprint).mockResolvedValue(
      "remote-url-and-publication-fingerprint",
    );
    await r.service.publish(r.mutation(r.plan.token, "publish"), owner);
    await expect(
      r.service.publish({ ...r.mutation(r.plan.token, "publish"), planToken: "another" }, owner),
    ).rejects.toThrow("different delivery");
  });
});
