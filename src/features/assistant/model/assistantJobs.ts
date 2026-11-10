import type {
  AssistantJob,
  AssistantRequest,
  AssistantResponse,
} from "../../../shared/model/host-contracts/assistant";
import { assistantJobProjectIds as canonicalProjectIds } from "../../../shared/model/assistantProjects";
import {
  normalizeAssistantQuickNoteAction,
  type AssistantQuickNoteAction,
} from "../../../shared/model/assistantQuick";
import {
  normalizeAssistantQuickAutomationAction,
  type AssistantQuickAutomationAction,
} from "../../../shared/model/assistantQuickAutomation";
import { AssistantRequestValidationSchema } from "../../../shared/model/host-contracts/assistant";
export type AssistantQuickAction = AssistantQuickNoteAction | AssistantQuickAutomationAction;

export type AssistantJobDraft = {
  id: string;
  kind?: "project" | "quick";
  title: string;
  request: string;
  projectId: string;
  projectIds?: readonly string[];
  quickAction?: AssistantQuickAction;
  noteDraft?: AssistantQuickNoteAction;
  automationDraft?: AssistantQuickAutomationAction;
  projectDraft?: { projectId: string; projectIds: readonly string[] };
  idempotencyKey: string;
  /** Project jobs only: start after this existing job finished. */
  after?: string;
  /** Project jobs only: start after the job created from the draft with this idempotency key. */
  afterKey?: string;
};
export type AssistantJobProjectSource = {
  kind?: "project" | "quick";
  projectId?: string | null;
  projectIds?: readonly string[];
  quickAction?: unknown;
};
const validNote = (value: unknown): value is AssistantQuickNoteAction => {
  const note = value as AssistantQuickNoteAction | undefined;
  return Boolean(
    note &&
    note.kind === "note" &&
    typeof note.title === "string" &&
    note.title.trim() &&
    Array.from(note.title).length <= 200 &&
    typeof note.body === "string" &&
    note.body.length <= 100000,
  );
};
const isGlobalQuick = (source: AssistantJobProjectSource) =>
  source.kind === "quick" &&
  source.projectId === null &&
  Array.isArray(source.projectIds) &&
  source.projectIds.length === 0 &&
  validNote(source.quickAction);
const automationScope = (source: AssistantJobProjectSource) => {
  const action = source.quickAction as Partial<AssistantQuickAutomationAction> | undefined;
  return (
    action?.kind === "automation" &&
    typeof action.projectId === "string" &&
    !!action.projectId &&
    source.projectId === action.projectId &&
    source.projectIds?.length === 1 &&
    source.projectIds[0] === action.projectId
  );
};
function normalizeQuick(action: AssistantQuickAction): AssistantQuickAction {
  if (action?.kind === "note") return normalizeAssistantQuickNoteAction(action);
  if (action?.kind === "automation") return normalizeAssistantQuickAutomationAction(action);
  throw new Error("Review the project, schedule, model and run limits for every automation.");
}
export { normalizeQuick as normalizeAssistantJobQuickAction };
type ProjectSource = AssistantJobProjectSource;
export function assistantJobProjectIds(source: ProjectSource): string[] {
  if (source.kind === "quick") {
    if (!automationScope(source)) return [];
    try {
      return canonicalProjectIds({
        kind: "quick",
        projectId: source.projectId!,
        projectIds: source.projectIds,
        quickAction: source.quickAction as AssistantQuickAutomationAction,
      });
    } catch {
      return [];
    }
  }
  if (!source.projectId) return [];
  const values = source.projectIds ?? [source.projectId];
  if (
    !values.length ||
    values.length > 20 ||
    !values.includes(source.projectId) ||
    values.some((id) => !id) ||
    new Set(values).size !== values.length
  )
    return [];
  return canonicalProjectIds({ projectId: source.projectId, projectIds: source.projectIds });
}
export function assistantJobVisible(
  source: ProjectSource,
  visible: (id: string) => boolean,
): boolean {
  if (source.kind === "quick") {
    if (isGlobalQuick(source)) return true;
    const ids = assistantJobProjectIds(source);
    return automationScope(source) && ids.length === 1 && ids.every(visible);
  }
  const values = assistantJobProjectIds(source);
  return values.length > 0 && values.every(visible);
}
export function selectAssistantJobProjects(
  lead: string,
  selected: readonly string[],
): { projectId: string; projectIds: string[] } {
  const projectIds = [...new Set(selected)].filter(Boolean).slice(0, 20);
  const projectId = projectIds.includes(lead) ? lead : (projectIds[0] ?? "");
  return { projectId, projectIds: projectId ? canonicalProjectIds({ projectId, projectIds }) : [] };
}
export function assistantJobDraftIdentity(
  text: string,
  lead: string,
  projects: readonly string[],
): string {
  // Preserve existing persisted single-project intent identities.
  return JSON.stringify(
    projects.length === 1 && projects[0] === lead
      ? [text.trim(), lead]
      : [text.trim(), lead, projects],
  );
}
export function assistantJobDraftVisible(
  draft: AssistantJobDraft,
  visible: (id: string) => boolean,
): boolean {
  if (draft.kind !== "quick") return assistantJobVisible(draft, visible);
  if (draft.quickAction?.kind === "note")
    return (
      typeof draft.quickAction.title === "string" &&
      typeof draft.quickAction.body === "string" &&
      draft.quickAction.body.length <= 100000
    );
  return (
    draft.quickAction?.kind === "automation" &&
    ((!draft.projectId && !draft.quickAction.projectId && !draft.projectIds?.length) ||
      (automationScope(draft) && visible(draft.quickAction.projectId)))
  );
}
export function assistantJobDraftReady(draft: AssistantJobDraft): boolean {
  try {
    if (!draft.title.trim() || !draft.request.trim()) return false;
    assistantJobDraftRequest(draft);
    return true;
  } catch {
    return false;
  }
}
export function assistantQuickDraftIdentity(
  request: string,
  title: string,
  action: AssistantQuickAction,
): string {
  return JSON.stringify(["quick", request, title, normalizeQuick(action)]);
}
export function changeAssistantJobDraftKind(
  draft: AssistantJobDraft,
  kind: "project" | "quick" | "automation",
): AssistantJobDraft {
  const saved = {
    ...draft,
    ...(draft.kind !== "quick"
      ? { projectDraft: { projectId: draft.projectId, projectIds: [...(draft.projectIds ?? [])] } }
      : draft.quickAction?.kind === "note"
        ? { noteDraft: draft.quickAction }
        : draft.quickAction?.kind === "automation"
          ? { automationDraft: draft.quickAction }
          : {}),
  };
  if (kind === "project") return { ...saved, kind, ...saved.projectDraft, quickAction: undefined };
  if (kind === "quick")
    return {
      ...saved,
      kind,
      quickAction: normalizeAssistantQuickNoteAction(
        saved.noteDraft ?? { kind: "note", title: draft.title, body: draft.request },
      ),
    };
  const action =
    saved.automationDraft ??
    ({
      kind: "automation",
      projectId: saved.projectDraft?.projectId ?? draft.projectId,
      name: draft.title.trim().slice(0, 200),
      prompt: draft.request,
      harness: "codex",
      model: "",
      modelSettings: {},
      runtimeMode: "supervised",
      scheduleKind: "daily",
      minute: 0,
      time: "09:00",
      dayOfWeek: 1,
      maxRunMinutes: 30,
      maxRunsPerDay: 1,
      isolate: false,
      enabled: false,
    } satisfies AssistantQuickAutomationAction);
  return {
    ...saved,
    kind: "quick",
    projectId: action.projectId,
    projectIds: action.projectId ? [action.projectId] : [],
    quickAction: action,
  };
}
type Create = Extract<AssistantRequest, { op: "jobs.create" }>;
export function assistantJobDraftRequest(row: AssistantJobDraft): Create {
  if (row.kind === "quick") {
    if (!row.quickAction)
      throw new Error("Review the exact title and content of every personal note.");
    const input = {
      op: "jobs.create" as const,
      kind: "quick" as const,
      title: row.title.trim(),
      request: row.request,
      idempotencyKey: row.idempotencyKey,
      quickAction: normalizeQuick(row.quickAction),
    };
    if (!AssistantRequestValidationSchema.safeParse(input).success)
      throw new Error(
        row.quickAction.kind === "automation"
          ? "Review the project, schedule, model and run limits for every automation."
          : "Review the exact title and content of every personal note.",
      );
    return input;
  }
  const projectIds = assistantJobProjectIds(row);
  if (!projectIds.length)
    throw new Error("Review a title, request and one to twenty projects for every job.");
  return {
    op: "jobs.create",
    title: row.title.trim(),
    request: row.request.trim(),
    projectId: row.projectId,
    projectIds,
    idempotencyKey: row.idempotencyKey,
  };
}
function receiptMatches(job: AssistantJob, input: Create): boolean {
  if (
    job.idempotencyKey !== input.idempotencyKey ||
    job.title !== input.title ||
    job.request !== input.request
  )
    return false;
  return input.kind === "quick"
    ? job.kind === "quick" &&
        (input.quickAction.kind === "note" ? isGlobalQuick(job) : automationScope(job)) &&
        JSON.stringify(job.quickAction) === JSON.stringify(input.quickAction)
    : job.kind !== "quick" &&
        job.projectId === input.projectId &&
        JSON.stringify(assistantJobProjectIds(job)) === JSON.stringify(input.projectIds);
}
type Request = (input: AssistantRequest) => Promise<AssistantResponse>;
/** Actual service receipts decide acceptance; retries retain the complete reviewed payload. */
export class AssistantJobBatch {
  private frozen?: readonly AssistantJobDraft[];
  readonly accepted: AssistantJob[] = [];
  private pending?: Promise<AssistantJob[]>;
  constructor(private request: Request) {}
  start(jobs: readonly AssistantJobDraft[]): Promise<AssistantJob[]> {
    if (this.pending) return this.pending;
    let normalized: AssistantJobDraft[];
    try {
      normalized = jobs.map((row) => {
        return {
          ...row,
          title: row.title.trim(),
          request: row.kind === "quick" ? row.request : row.request.trim(),
          ...(row.kind === "quick"
            ? { quickAction: normalizeQuick(row.quickAction!) }
            : { projectIds: assistantJobProjectIds(row) }),
        };
      });
      for (const row of normalized) assistantJobDraftRequest(row);
    } catch (error) {
      return Promise.reject(error);
    }
    const identities = new Map<string, string>();
    const inconsistent = normalized.some(({ id: _id, idempotencyKey, ...payload }) => {
      const identity = JSON.stringify(payload),
        prior = identities.get(idempotencyKey);
      identities.set(idempotencyKey, identity);
      return prior !== undefined && prior !== identity;
    });
    if (
      !normalized.length ||
      normalized.some(
        (row) =>
          !row.id ||
          !row.idempotencyKey ||
          !row.title ||
          row.title.length > 300 ||
          !row.request.trim() ||
          row.request.length > 16000,
      ) ||
      inconsistent
    )
      return Promise.reject(
        new Error("Review a title, request and one to twenty projects for every job."),
      );
    if (!this.frozen) this.frozen = structuredClone(normalized);
    else if (JSON.stringify(this.frozen) !== JSON.stringify(normalized))
      return Promise.reject(
        new Error(
          "Review already started. Keep the original job requests while checking their status.",
        ),
      );
    this.pending = (async () => {
      const current = await this.request({ op: "snapshot", limit: 100 });
      if (!current.snapshot)
        throw new Error("Job status is unknown. Check the Room before retrying.");
      for (const row of this.frozen!) {
        if (this.accepted.some((job) => job.idempotencyKey === row.idempotencyKey)) continue;
        const prior = current.snapshot?.jobs.find(
          (job) => job.idempotencyKey === row.idempotencyKey,
        );
        const base = assistantJobDraftRequest(row);
        const after =
          row.kind === "quick"
            ? undefined
            : row.afterKey
              ? this.accepted.find((job) => job.idempotencyKey === row.afterKey)?.id
              : row.after;
        if (row.afterKey && row.kind !== "quick" && !after)
          throw new Error("The job to wait for was not created. Check the Room before retrying.");
        const input: Create = after && base.kind !== "quick" ? { ...base, after } : base;
        if (prior) {
          if (!receiptMatches(prior, input))
            throw new Error("Job request identity changed. Open the Room to check it.");
          this.accepted.push(prior);
          continue;
        }
        const result = await this.request(input);
        if (!result.job) throw new Error("Job status is unknown. Check the Room before retrying.");
        if (!receiptMatches(result.job, input))
          throw new Error("Job request identity changed. Open the Room to check it.");
        this.accepted.push(result.job);
      }
      return this.accepted;
    })().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
}
