import {
  discoverImportableSessions,
  readClaudeTranscript,
  readCodexTranscript,
  type DiscoveryReport,
  type ImportCandidate,
} from "../../../platform/tauri/sessionImport";
import { importSessionRecord, importedSessionKeys } from "../data/sessionStore";
import { sameProjectPath } from "../../projects/model/recents";
import { isAlreadyImported, SESSION_HISTORY_IMPORTED_EVENT } from "./importModel";
import { isUsableProjectFolder, runSessionImport, type ImportSummary, type ImportDeps } from "./importRunner";

export type HistoryImportContext = {
  environmentId: string;
  sourceSessionId: string;
  projectCwd: string;
  valid: () => boolean;
};
export type HistoryImportCandidate = {
  id: string;
  provider: "claude" | "codex";
  prompt: string;
  startedAt: number;
  lastAt: number;
  sizeBytes: number;
  resumable: boolean;
  kind: string;
  imported: boolean;
};
export type HistoryImportPreview = {
  reviewId: string;
  digest: string;
  expiresAt: number;
  environmentId: string;
  sourceSessionId: string;
  candidates: HistoryImportCandidate[];
  omitted: number;
};
export type HistoryImportResult = {
  imported: number;
  skipped: number;
  failed: number;
  readOnly: number;
  truncated: number;
  cancelled: boolean;
};
export type HistoryImportStatus = {
  state: "unknown" | "running" | "complete" | "failed";
  progress?: { total: number; done: number; imported: number; skipped: number; failed: number };
  result?: HistoryImportResult;
  message?: string;
};
type Deps = {
  discover: () => Promise<DiscoveryReport>;
  storedKeys: () => Promise<string[]>;
  run: typeof runSessionImport;
  now: () => number;
  uuid: () => string;
  hash: (value: string) => Promise<string>;
  readClaude: ImportDeps["readClaude"];
  readCodex: ImportDeps["readCodex"];
  persist: ImportDeps["persist"];
};
const defaults: Deps = {
  discover: discoverImportableSessions,
  storedKeys: importedSessionKeys,
  run: runSessionImport,
  now: Date.now,
  uuid: () => crypto.randomUUID(),
  readClaude: readClaudeTranscript,
  readCodex: readCodexTranscript,
  persist: importSessionRecord,
  hash: async (value) =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join(""),
};
const exact = (value: Record<string, unknown>, keys: string[]) => {
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error("Unsupported history import field");
};
const identity = (context: HistoryImportContext) =>
  JSON.stringify([context.environmentId, context.sourceSessionId, context.projectCwd]);
const safeId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
/** Scope-bound metadata handles; actual transcript reads and persistence retain their canonical owners. */
export function createHistoryImportControl(overrides: Partial<Deps> = {}) {
  const deps = { ...defaults, ...overrides };
  const reviews = new Map<
    string,
    {
      preview: HistoryImportPreview;
      scope: string;
      rows: Map<string, ImportCandidate>;
      used: boolean;
    }
  >();
  const operations = new Map<
    string,
    {
      scope: string;
      signature: string;
      status: HistoryImportStatus;
      promise: Promise<HistoryImportStatus>;
      abort: AbortController;
    }
  >();
  const assert = (context: HistoryImportContext) => {
    if (
      !context.valid() ||
      !context.environmentId ||
      !context.sourceSessionId ||
      context.projectCwd.startsWith("remote://")
    )
      throw new Error("Import source project is unavailable or locked");
  };
  const local = (report: DiscoveryReport, context: HistoryImportContext) =>
    report.candidates.filter(
      (candidate) => isUsableProjectFolder(candidate) && sameProjectPath(candidate.cwd, context.projectCwd),
    );
  return async (
    context: HistoryImportContext,
    action: string,
    input: Record<string, unknown>,
  ): Promise<HistoryImportPreview | HistoryImportStatus> => {
    assert(context);
    if (action === "historyImport.discover") {
      exact(input, []);
      for (const [id, review] of reviews)
        if (review.preview.expiresAt <= deps.now()) reviews.delete(id);
      if (reviews.size >= 32)
        throw new Error("Too many history reviews; close an older review and try again later");
      const report = await deps.discover();
      assert(context);
      const keys = new Set(await deps.storedKeys());
      assert(context);
      const candidates = local(report, context);
      const rows = new Map<string, ImportCandidate>();
      const metadata = candidates.slice(0, 500).map((row) => {
        const id = deps.uuid();
        rows.set(id, row);
        return {
          id,
          provider: row.provider,
          prompt: row.firstPrompt.replace(/[\0\r\n]/g, " ").slice(0, 1000),
          startedAt: row.startedAt,
          lastAt: row.lastAt,
          sizeBytes: row.sizeBytes,
          resumable: row.resumable,
          kind: row.kind,
          imported: isAlreadyImported(row, keys),
        };
      });
      const reviewId = deps.uuid();
      const expiresAt = deps.now() + 300000;
      const digest = await deps.hash(
        JSON.stringify([identity(context), reviewId, expiresAt, [...rows]]),
      );
      assert(context);
      const preview: HistoryImportPreview = {
        reviewId,
        digest,
        expiresAt,
        environmentId: context.environmentId,
        sourceSessionId: context.sourceSessionId,
        candidates: metadata,
        omitted: Math.max(0, candidates.length - 500),
      };
      reviews.set(reviewId, { preview, scope: identity(context), rows, used: false });
      return preview;
    }
    if (action === "historyImport.status" || action === "historyImport.cancel") {
      exact(input, ["operationId"]);
      if (!safeId(input.operationId)) throw new Error("Invalid history operation");
      const operation = operations.get(input.operationId);
      if (operation?.scope === identity(context) && action === "historyImport.cancel")
        operation.abort.abort();
      return operation?.scope === identity(context) ? operation.status : { state: "unknown" };
    }
    if (action !== "historyImport.commit") throw new Error("Unsupported history action");
    exact(input, ["reviewId", "digest", "candidateIds", "operationId"]);
    if (
      !safeId(input.reviewId) ||
      !safeId(input.operationId) ||
      typeof input.digest !== "string" ||
      !/^[a-f0-9]{64}$/.test(input.digest) ||
      !Array.isArray(input.candidateIds) ||
      !input.candidateIds.length ||
      input.candidateIds.length > 500 ||
      !input.candidateIds.every(safeId) ||
      new Set(input.candidateIds).size !== input.candidateIds.length
    )
      throw new Error("Invalid reviewed history selection");
    const signature = JSON.stringify([input.reviewId, input.digest, input.candidateIds]);
    const scope = identity(context);
    const previous = operations.get(input.operationId);
    if (previous) {
      if (previous.scope !== scope || previous.signature !== signature)
        throw new Error("History operation ID was already used");
      return previous.status;
    }
    if (operations.size >= 128)
      throw new Error(
        "History operation receipt capacity reached; reopen bycoda before a new import",
      );
    const review = reviews.get(input.reviewId);
    if (
      !review ||
      review.used ||
      review.scope !== scope ||
      review.preview.digest !== input.digest ||
      review.preview.expiresAt <= deps.now()
    )
      throw new Error("History review expired or changed; review it again");
    const chosen = input.candidateIds.map((id) => review.rows.get(id));
    if (chosen.some((row) => !row)) throw new Error("History selection is not in this review");
    review.used = true;
    const operation = {
      scope,
      signature,
      status: { state: "running" } as HistoryImportStatus,
      promise: Promise.resolve({ state: "running" } as HistoryImportStatus),
      abort: new AbortController(),
    };
    operations.set(input.operationId, operation);
    operation.promise = (async () => {
      try {
        const current = local(await deps.discover(), context);
        assert(context);
        if (
          review.preview.expiresAt <= deps.now() ||
          chosen.some(
            (row) => !current.some((actual) => JSON.stringify(actual) === JSON.stringify(row)),
          )
        )
          throw new Error("Provider history changed; review it again");
        const guarded = () => {
          assert(context);
          if (operation.abort.signal.aborted) throw new Error("History import cancelled");
          if (review.preview.expiresAt <= deps.now()) throw new Error("History review expired");
        };
        const summary: ImportSummary = await deps.run({
          candidates: chosen as ImportCandidate[],
          groupProjects: false,
          signal: operation.abort.signal,
          onProgress: (progress) => {
            operation.status = {
              state: "running",
              progress: {
                total: progress.total,
                done: progress.done,
                imported: progress.imported,
                skipped: progress.skipped,
                failed: progress.failed.length,
              },
            };
          },
          deps: {
            storedKeys: async () => {
              guarded();
              return deps.storedKeys();
            },
            readClaude: async (path, bytes) => {
              guarded();
              return deps.readClaude(path, bytes);
            },
            readCodex: async (path, bytes) => {
              guarded();
              return deps.readCodex(path, bytes);
            },
            persist: async (session, times) => {
              guarded();
              if (!sameProjectPath(session.cwd, context.projectCwd))
                throw new Error("Import destination changed");
              return deps.persist(session, times);
            },
          },
        }).finally(() => window.dispatchEvent(new Event(SESSION_HISTORY_IMPORTED_EVENT)));
        operation.status = {
          state: "complete",
          result: {
            imported: summary.imported,
            skipped: summary.skipped,
            failed: summary.failed.length,
            readOnly: summary.readOnly,
            truncated: summary.truncated,
            cancelled: summary.cancelled || operation.abort.signal.aborted,
          },
        };
      } catch {
        operation.status = {
          state: "failed",
          message:
            "History import did not finish. Review stored conversations before starting another import.",
        };
      }
      return operation.status;
    })();
    return operation.status;
  };
}
export const handleHistoryImport = createHistoryImportControl();
