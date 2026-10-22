// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  createHistoryImportControl,
  type HistoryImportPreview,
  type HistoryImportStatus,
} from "./historyImportControl";
import type { ImportCandidate } from "../../../platform/tauri/sessionImport";
const row: ImportCandidate = {
  provider: "codex",
  path: "/private/provider/history.jsonl",
  providerSessionId: "provider-source",
  cwd: "/project",
  cwdExists: true,
  resumable: true,
  firstPrompt: "example\nrequest",
  startedAt: 1,
  lastAt: 2,
  sizeBytes: 100,
  kind: "interactive",
  archived: false,
};
const summary = {
  imported: 1,
  skipped: 0,
  failed: [],
  cancelled: false,
  readOnly: 0,
  truncated: 0,
  projects: 0,
  groups: [],
};
function fixture() {
  let now = 100,
    valid = true,
    counter = 0;
  const discover = vi.fn(async () => ({
    candidates: [row, { ...row, path: "/private/other", cwd: "/other" }],
    filesScanned: 2,
    filesSkipped: 0,
    elapsedMs: 1,
  }));
  const run = vi.fn(
    async (_input: Parameters<typeof import("./importRunner").runSessionImport>[0]) => summary,
  );
  const control = createHistoryImportControl({
    discover,
    run,
    now: () => now,
    storedKeys: async () => [],
    uuid: () => `opaque-${++counter}`,
    hash: async () => "a".repeat(64),
  });
  const context = {
    environmentId: "env",
    sourceSessionId: "session",
    projectCwd: "/project",
    valid: () => valid,
  };
  const preview = async () =>
    (await control(context, "historyImport.discover", {})) as HistoryImportPreview;
  const commit = (review: HistoryImportPreview) => ({
    reviewId: review.reviewId,
    digest: review.digest,
    candidateIds: review.candidates.map((candidate) => candidate.id),
    operationId: "operation",
  });
  return {
    control,
    context,
    preview,
    commit,
    discover,
    run,
    expire: () => {
      now += 300001;
    },
    revoke: () => {
      valid = false;
    },
  };
}
describe("canonical history import bridge", () => {
  it("runs the existing importer with synthetic transcript/persistence dependencies", async () => {
    localStorage.clear();
    const persist = vi.fn(async (session: { id: string }) => ({ id: session.id }) as never);
    const control = createHistoryImportControl({
      discover: async () => ({ candidates: [row], filesScanned: 1, filesSkipped: 0, elapsedMs: 0 }),
      storedKeys: async () => [], uuid: () => "opaque", hash: async () => "a".repeat(64), persist,
      readCodex: async () => ({ entries: [{ kind: "user", at: 1, text: "Synthetic user" }, { kind: "assistant", at: 2, text: "Synthetic reply" }], truncated: false, dropped: 0, oversizeSkipped: 0 }),
    });
    const context = { environmentId: "env", sourceSessionId: "source", projectCwd: row.cwd, valid: () => true };
    const preview = await control(context, "historyImport.discover", {}) as HistoryImportPreview;
    await control(context, "historyImport.commit", { reviewId: preview.reviewId, digest: preview.digest, candidateIds: [preview.candidates[0].id], operationId: "operation" });
    await vi.waitFor(async () => expect(await control(context, "historyImport.status", { operationId: "operation" })).toMatchObject({ state: "complete", result: { imported: 1, failed: 0 } }));
    expect(persist).toHaveBeenCalledTimes(1); expect(persist.mock.calls[0][0]).toMatchObject({ id: "imp-codex-provider-source", cwd: "/project", providerSessionId: "provider-source" });
  });
  it("projects only bounded safe metadata and opaque handles for its own local project", async () => {
    const f = fixture();
    const preview = await f.preview();
    expect(preview.candidates).toHaveLength(1);
    expect(preview.candidates[0].prompt).toBe("example request");
    expect(JSON.stringify(preview)).not.toContain("private");
    expect(JSON.stringify(preview)).not.toContain("provider-source");
    expect(f.run).not.toHaveBeenCalled();
  });
  it("records one exact operation and reconciles status without importing twice", async () => {
    const f = fixture();
    const preview = await f.preview();
    const input = f.commit(preview);
    expect(await f.control(f.context, "historyImport.commit", input)).toMatchObject({
      state: "running",
    });
    await vi.waitFor(() => expect(f.run).toHaveBeenCalledTimes(1));
    await vi.waitFor(async () => expect(await f.control(f.context, "historyImport.commit", input)).toMatchObject({
      state: "complete",
      result: { imported: 1 },
    }));
    expect(f.run).toHaveBeenCalledTimes(1);
    await expect(
      f.control(f.context, "historyImport.commit", { ...input, digest: "b".repeat(64) }),
    ).rejects.toThrow("already used");
  });
  it("refuses stale/expired/revoked source state before native import", async () => {
    const f = fixture();
    const preview = await f.preview();
    f.discover.mockResolvedValue({
      candidates: [{ ...row, sizeBytes: 101 }],
      filesScanned: 1,
      filesSkipped: 0,
      elapsedMs: 1,
    });
    await f.control(f.context, "historyImport.commit", f.commit(preview));
    await vi.waitFor(async () =>
      expect(
        await f.control(f.context, "historyImport.status", { operationId: "operation" }),
      ).toMatchObject({ state: "failed" }),
    );
    expect(f.run).not.toHaveBeenCalled();
    const other = fixture();
    const review = await other.preview();
    other.expire();
    await expect(
      other.control(other.context, "historyImport.commit", other.commit(review)),
    ).rejects.toThrow("expired");
    other.revoke();
    await expect(other.preview()).rejects.toThrow("unavailable");
  });
  it("rejects fabricated candidates and preserves unknown across a new owner", async () => {
    const f = fixture();
    const preview = await f.preview();
    await expect(
      f.control(f.context, "historyImport.commit", {
        ...f.commit(preview),
        candidateIds: ["invented"],
      }),
    ).rejects.toThrow("not in this review");
    expect(await f.control(f.context, "historyImport.status", { operationId: "missing" })).toEqual({
      state: "unknown",
    });
    await expect(
      f.control({ ...f.context, projectCwd: "remote://env/project" }, "historyImport.discover", {}),
    ).rejects.toThrow("unavailable");
  });
  it("retains bounded progress and cancellation on the same real operation signal", async () => {
    const f = fixture();
    let finish: (() => void) | undefined;
    f.run.mockImplementation(async (input) => {
      input.onProgress({
        total: 1,
        done: 0,
        imported: 0,
        skipped: 0,
        failed: [],
        current: "/private/source",
      });
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { ...summary, imported: 0, cancelled: input.signal.aborted };
    });
    const preview = await f.preview();
    await f.control(f.context, "historyImport.commit", f.commit(preview));
    await vi.waitFor(() => expect(f.run).toHaveBeenCalledTimes(1));
    const status = (await f.control(f.context, "historyImport.cancel", {
      operationId: "operation",
    })) as HistoryImportStatus;
    expect(status).toMatchObject({ state: "running", progress: { total: 1, done: 0 } });
    expect(JSON.stringify(status)).not.toContain("private");
    finish!();
    await vi.waitFor(async () =>
      expect(
        await f.control(f.context, "historyImport.status", { operationId: "operation" }),
      ).toMatchObject({ state: "complete", result: { cancelled: true, imported: 0 } }),
    );
  });
});
