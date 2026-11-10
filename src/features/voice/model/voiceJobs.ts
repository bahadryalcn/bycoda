import { z } from "zod";
import {
  AssistantJobBatch,
  assistantJobDraftVisible,
  normalizeAssistantJobQuickAction,
  type AssistantJobDraft,
} from "../../assistant/model/assistantJobs";
import { normalizeAssistantQuickNoteAction } from "../../../shared/model/assistantQuick";
import { pathKey } from "../../../shared/lib/paths";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import { selectAssistantJobProjects } from "../../assistant/model/assistantJobs";
const project = z.strictObject({
  kind: z.literal("project").optional(),
  title: z.string().trim().min(1).max(300),
  request: z.string().min(1).max(16000),
  projectPath: z.string().max(4096).optional(),
  projectPaths: z.array(z.string().min(1).max(4096)).min(1).max(20).optional(),
  /** Start only after another job finished: the index of an earlier job in this call, or an existing job id. */
  after: z
    .preprocess(
      (value) => (typeof value === "string" && /^[0-9]{1,2}$/.test(value) ? Number(value) : value),
      z.union([z.number().int().min(0).max(9), z.string().min(1).max(200)]),
    )
    .optional(),
});
const quick = z.strictObject({
  kind: z.literal("quick"),
  title: z.string().trim().min(1).max(300),
  request: z.string().min(1).max(16000),
  quickAction: z.strictObject({
    kind: z.literal("note"),
    title: z.string().min(1).max(300),
    body: z.string().max(100000),
  }),
});
const automation = z.strictObject({
  kind: z.literal("quick"),
  title: z.string().trim().min(1).max(300),
  request: z.string().min(1).max(16000),
  quickAction: z.strictObject({
    kind: z.literal("automation"),
    projectPath: z.string().min(1).max(4096),
    name: z.string().trim().min(1).max(200),
    prompt: z.string().min(1).max(16000),
    scheduleKind: z.enum(["hourly", "daily", "weekdays", "weekly", "once"]),
    /** Epoch milliseconds of the single run when scheduleKind is once; resolved from the owner's local time. */
    runAt: z.number().int().positive().optional(),
    minute: z.number().int().min(0).max(59),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    dayOfWeek: z.number().int().min(0).max(6),
    maxRunMinutes: z.number().int().min(0).max(10080),
    maxRunsPerDay: z.number().int().min(0).max(1000),
    isolate: z.boolean(),
    enabled: z.boolean(),
  }),
});
export const VoiceJobDraftsSchema = z
  .array(z.union([project, quick, automation]))
  .min(1)
  .max(10)
  .superRefine((jobs, ctx) => {
    jobs.forEach((job, index) => {
      if (job.kind === "quick") {
        const action = job.quickAction;
        if (
          action.kind === "automation" &&
          (action.scheduleKind === "once") !== (action.runAt !== undefined)
        )
          ctx.addIssue({
            code: "custom",
            message: "A one-time automation needs runAt; others must omit it.",
          });
        return;
      }
      const after = job.after;
      if (typeof after !== "number") return;
      // Only an earlier project job can be waited for, which also rules out cycles and self-reference.
      const target = jobs[after];
      if (after >= index || !target || target.kind === "quick")
        ctx.addIssue({
          code: "custom",
          message: "after must be the index of an earlier project job in this call.",
        });
    });
  });
export type VoiceJobDraft = AssistantJobDraft;
export type VoiceJobReviewState = {
  id: string;
  jobs: VoiceJobDraft[];
  projects: { id: string; path: string; name: string }[];
  quickNotes?: boolean;
  quickAutomations?: boolean;
  busy: boolean;
  error: string;
  accepted: string[];
};
export function resolveVoiceJobDraft(
  input: z.infer<typeof VoiceJobDraftsSchema>[number],
  projects: readonly { id: string; path: string }[],
  allowedPaths: readonly string[],
  defaultPath: string,
): Omit<VoiceJobDraft, "id" | "idempotencyKey"> {
  if (input.kind === "quick") {
    if (input.quickAction.kind === "automation") {
      const { projectPath, ...action } = input.quickAction;
      // The Host derives the stored local time of a one-time run from runAt; keep the form's fields consistent.
      if (action.runAt !== undefined) {
        const at = new Date(action.runAt);
        action.minute = 0;
        action.dayOfWeek = at.getDay();
        action.time = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
      }
      const scope = resolveVoiceJobProjects({ projectPath }, projects, allowedPaths, defaultPath);
      return {
        kind: "quick",
        title: input.title,
        request: input.request,
        ...scope,
        quickAction: {
          ...action,
          projectId: scope.projectId,
          harness: "codex",
          model: "",
          modelSettings: {},
          runtimeMode: "supervised",
        },
      };
    }
    return {
      kind: "quick",
      title: input.title,
      request: input.request,
      projectId:
        projects.find((project) => pathKey(project.path) === pathKey(defaultPath))?.id ?? "",
      projectIds: [],
      quickAction: normalizeAssistantQuickNoteAction(input.quickAction),
    };
  }
  return {
    ...resolveVoiceJobProjects(input, projects, allowedPaths, defaultPath),
    kind: "project",
    title: input.title,
    request: input.request,
  };
}
/** Drafts for one give_jobs call; an index in `after` becomes the earlier draft's idempotency key. */
export function voiceJobDrafts(
  input: z.infer<typeof VoiceJobDraftsSchema>,
  projects: readonly { id: string; path: string }[],
  allowedPaths: readonly string[],
  defaultPath: string,
  newKey: () => string,
): VoiceJobDraft[] {
  const drafts: VoiceJobDraft[] = [];
  input.forEach((item) => {
    const after = item.kind === "quick" ? undefined : item.after;
    drafts.push({
      ...resolveVoiceJobDraft(item, projects, allowedPaths, defaultPath),
      id: crypto.randomUUID(),
      idempotencyKey: newKey(),
      ...(typeof after === "number" ? { afterKey: drafts[after].idempotencyKey } : {}),
      ...(typeof after === "string" ? { after } : {}),
    });
  });
  return drafts;
}
export function changeVoiceJobRows(
  original: readonly VoiceJobDraft[],
  rows: readonly VoiceJobDraft[],
  projects: readonly { id: string }[],
  quickNotes: boolean,
  quickAutomations = false,
): VoiceJobDraft[] | undefined {
  if (rows.length !== original.length || new Set(rows.map((row) => row.id)).size !== rows.length)
    return;
  const result: VoiceJobDraft[] = [];
  for (const row of original) {
    const next = rows.find((item) => item.id === row.id);
    if (
      !next ||
      next.idempotencyKey !== row.idempotencyKey ||
      typeof next.title !== "string" ||
      next.title.length > 300 ||
      typeof next.request !== "string" ||
      next.request.length > 16000 ||
      (next.kind === "quick" &&
        (next.quickAction?.kind === "automation" ? !quickAutomations : !quickNotes)) ||
      !assistantJobDraftVisible(next, (id) => projects.some((project) => project.id === id))
    )
      return;
    result.push({
      ...next,
      projectIds: [...(next.projectIds ?? [])],
      ...(next.quickAction
        ? { quickAction: normalizeAssistantJobQuickAction(next.quickAction) }
        : {}),
    });
  }
  return result;
}
/** The accepted turn's live project scope for job proposals. */
export type VoiceJobScope = {
  /** Paths frozen for the accepted turn, plus projects that turn created. */
  allowed: readonly string[];
  /** Projects this window shows now. */
  visible: readonly { path: string }[];
  locked(path: string): boolean;
  /** Global turn scope; otherwise only `projectPath` qualifies. */
  global: boolean;
  projectPath: string;
};
/** Host projects a turn may hand work to: its frozen paths, narrowed by live visibility and locks. */
export function voiceJobProjects<T extends { path: string }>(
  host: readonly T[],
  scope: VoiceJobScope,
): T[] {
  const has = (paths: readonly string[], path: string) =>
    paths.some((item) => pathKey(item) === pathKey(path));
  const visible = scope.visible.map((item) => item.path);
  return host.filter(
    (project) =>
      has(scope.allowed, project.path) &&
      !scope.locked(project.path) &&
      has(visible, project.path) &&
      (scope.global || pathKey(project.path) === pathKey(scope.projectPath)),
  );
}
/**
 * The result of a give_jobs call refused before anything was saved. It is definite, unlike a
 * thrown error, which the realtime route reports as uncertain and sends the model to read a state
 * that does not exist.
 */
function voiceJobsRejected(cause: unknown) {
  const error =
    cause instanceof z.ZodError
      ? z.prettifyError(cause)
      : cause instanceof Error
        ? cause.message
        : String(cause);
  return {
    status: "rejected" as const,
    created: 0,
    error: truncateGraphemes(error, 600),
    next: "Nothing was saved, so there is no job status to read. Correct the named field or project and call give_jobs again.",
  };
}
/** Parse and resolve one give_jobs call. A refusal is returned, never thrown. */
export function draftVoiceJobs(
  proposal: unknown,
  projects: readonly { id: string; path: string }[],
  allowedPaths: readonly string[],
  defaultPath: string,
  newKey: () => string,
  capabilities?: { quickNotes?: boolean; quickAutomations?: boolean },
): { jobs: VoiceJobDraft[] } | ReturnType<typeof voiceJobsRejected> {
  try {
    const input = VoiceJobDraftsSchema.parse(proposal);
    const quick = (kind: "note" | "automation") =>
      input.some((item) => item.kind === "quick" && item.quickAction.kind === kind);
    if (quick("note") && capabilities?.quickNotes !== true)
      throw new Error("Quick note jobs are unavailable on this Host.");
    if (quick("automation") && capabilities?.quickAutomations !== true)
      throw new Error("Quick automation jobs are unavailable for this project.");
    return { jobs: voiceJobDrafts(input, projects, allowedPaths, defaultPath, newKey) };
  } catch (cause) {
    return voiceJobsRejected(cause);
  }
}
const unverified = (detail: string) =>
  new Error(`The project could not be verified for job review. ${detail}`);
export function resolveVoiceJobProjects(
  input: { projectPath?: string; projectPaths?: readonly string[] },
  projects: readonly { id: string; path: string }[],
  allowedPaths: readonly string[],
  defaultPath: string,
) {
  const paths = input.projectPaths ?? [input.projectPath ?? defaultPath];
  const allowed = new Set(allowedPaths.map(pathKey));
  const lead =
    input.projectPath ??
    (paths.some((path) => pathKey(path) === pathKey(defaultPath)) ? defaultPath : paths[0]);
  if (!lead) throw unverified("No project is selected; pass an exact projectPath.");
  if (
    !paths.length ||
    paths.length > 20 ||
    new Set(paths.map(pathKey)).size !== paths.length ||
    !paths.some((path) => pathKey(path) === pathKey(lead))
  )
    throw unverified("projectPaths must be unique, at most twenty and include projectPath.");
  const selected = paths.map((path) => {
    const name = JSON.stringify(truncateGraphemes(path, 200));
    if (!allowed.has(pathKey(path)))
      throw unverified(
        `${name} is not one of this spoken turn's projects. Use an exact path from workspace.projects.list.`,
      );
    const project = projects.find((project) => pathKey(project.path) === pathKey(path));
    if (!project)
      throw unverified(
        `${name} is locked, hidden, outside the selected voice scope or not registered on the Host yet.`,
      );
    return project;
  });
  const primary = selected.find((project) => pathKey(project.path) === pathKey(lead))!;
  return selectAssistantJobProjects(
    primary.id,
    selected.map((project) => project.id),
  );
}
/** Freeze owner-reviewed payloads and retain their keys after uncertain transport results. */
export class VoiceJobBatch extends AssistantJobBatch {
  private linking?: Promise<
    import("../../../shared/model/host-contracts/assistant").AssistantJob[]
  >;
  constructor(
    request: ConstructorParameters<typeof AssistantJobBatch>[0],
    private linked?: (
      job: import("../../../shared/model/host-contracts/assistant").AssistantJob,
    ) => Promise<void>,
  ) {
    super(request);
  }
  override start(jobs: readonly AssistantJobDraft[]) {
    if (this.linking) return this.linking;
    const acceptance = super.start(jobs);
    if (!this.linked) return acceptance;
    // An uncertain annotation retries metadata for these same accepted receipts;
    // the base batch retains creation identity and never creates work again.
    this.linking = acceptance
      .then(async (accepted) => {
        for (const job of accepted) await this.linked!(job);
        return accepted;
      })
      .finally(() => {
        this.linking = undefined;
      });
    return this.linking;
  }
}

/** A spoken approval or cancellation of an open job review; other speech stays conversation. */
export function spokenJobReviewDecision(text: string): "start" | "cancel" | undefined {
  const input = text
    .trim()
    .toLocaleLowerCase()
    .replace(/[.!?]+$/g, "");
  if (
    /^(?:(?:evet|yes|tamam|ok|okay),?\s+)?(?:start jobs|start them|start|approve|başlat|işleri başlat|başla|onayla|onaylıyorum|starten|iniciar|démarrer|開始|开始)(?:\s+(?:lütfen|please))?$/u.test(
      input,
    )
  )
    return "start";
  if (
    /^(?:cancel review|cancel|iptal|vazgeç|abbrechen|cancelar|annuler|キャンセル|取消)$/u.test(
      input,
    )
  )
    return "cancel";
  return undefined;
}
