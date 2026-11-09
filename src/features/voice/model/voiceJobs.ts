import { z } from "zod";
import {
  AssistantJobBatch,
  assistantJobDraftVisible,
  normalizeAssistantJobQuickAction,
  type AssistantJobDraft,
} from "../../assistant/model/assistantJobs";
import { normalizeAssistantQuickNoteAction } from "../../../shared/model/assistantQuick";
import { pathKey } from "../../../shared/lib/paths";
import { selectAssistantJobProjects } from "../../assistant/model/assistantJobs";
const project = z.strictObject({
  kind: z.literal("project").optional(),
  title: z.string().trim().min(1).max(300),
  request: z.string().min(1).max(16000),
  projectPath: z.string().max(4096).optional(),
  projectPaths: z.array(z.string().min(1).max(4096)).min(1).max(20).optional(),
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
    scheduleKind: z.enum(["hourly", "daily", "weekdays", "weekly"]),
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
  .max(10);
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
  if (
    !paths.length ||
    paths.length > 20 ||
    new Set(paths.map(pathKey)).size !== paths.length ||
    !lead ||
    !paths.some((path) => pathKey(path) === pathKey(lead))
  )
    throw new Error("The project could not be verified for job review.");
  const selected = paths.map((path) => {
    const project = projects.find((project) => pathKey(project.path) === pathKey(path));
    if (!project || !allowed.has(pathKey(project.path)))
      throw new Error("The project could not be verified for job review.");
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
