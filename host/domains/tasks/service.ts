import { z } from "zod";
import * as dto from "../../../src/shared/model/host-contracts/tasks";
import { assertDomainAuthority, type HostDomainContext } from "../context";

export interface HostTasksServicePorts<Task extends dto.TaskIdentity> {
  project(id: string): Promise<unknown>;
  withAuthorization<T>(authorized: () => Promise<boolean>, work: () => Promise<T>): Promise<T>;
  tasks: {
    snapshotWithCursor(): Promise<dto.TaskSnapshotResult>;
    events(after: number, limit?: number): Promise<dto.TaskEventsResult>;
    list(projectId?: string): Promise<Task[]>;
    save(raw: unknown): Promise<Task>;
    move(id: string, to: unknown): Promise<Task>;
    startTask(id: string): Promise<Task>;
    finishWithFindings(id: string, expectedUpdatedAt: number): Promise<Task>;
    reorder(ids: unknown): Promise<Task[]>;
    recheckReview(id: string): Promise<Task>;
    readNotes(id: string, ids: unknown): Promise<Task>;
    resolveNote(id: string, noteId: unknown, resolved: unknown): Promise<Task>;
    delete(id: string, discard: boolean, expectedUpdatedAt?: number): Promise<void>;
    preflight(raw: unknown): Promise<dto.TaskPreflightResult>;
    recordEvaluation(id: string, raw: unknown, expectedUpdatedAt: unknown): Promise<Task>;
  };
  /** Composition supplies existing authenticated workspace-owner authorization. */
  retarget(
    id: string,
    workspace: unknown,
    autoMerge: unknown,
    context: HostDomainContext,
  ): Promise<Task>;
}
export function createHostTasksService<Task extends dto.TaskIdentity>(
  ports: HostTasksServicePorts<Task>,
) {
  type Options = { legacy?: boolean };
  async function execute<S extends z.ZodObject, R>(
    schema: S,
    raw: unknown,
    context: HostDomainContext,
    options: Options,
    operation: (params: z.output<S>) => Promise<R>,
  ): Promise<R> {
    await assertDomainAuthority(context);
    let params: z.output<S>;
    if (options.legacy) {
      // Preserve the old HTTP owner validation/errors and its two ID coercions.
      const legacy = { ...(raw as Record<string, unknown>) };
      if ("taskId" in schema.shape) legacy.taskId = String(legacy.taskId ?? "");
      if ("projectId" in schema.shape && legacy.projectId !== undefined)
        legacy.projectId = String(legacy.projectId);
      params = legacy as z.output<S>;
    } else params = schema.parse(raw) as z.output<S>;
    const result = await ports.withAuthorization(
      async () => {
        await assertDomainAuthority(context);
        return true;
      },
      async () => {
        await assertDomainAuthority(context);
        return operation(params);
      },
    );
    await assertDomainAuthority(context);
    return result;
  }
  return {
    snapshotWithCursor: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.TasksEmptyParamsSchema, p, c, o, () => ports.tasks.snapshotWithCursor()),
    events: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.TasksEventsParamsSchema, p, c, o, (params) =>
        ports.tasks.events(params.after, params.limit),
      ),
    list: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.TasksListParamsSchema, p, c, o, async (params) => {
        if (params.projectId !== undefined) await ports.project(params.projectId);
        return ports.tasks.list(params.projectId);
      }),
    save: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.TasksSaveParamsSchema, p, c, o, (params) => ports.tasks.save(params.task)),
    move: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.TasksMoveParamsSchema, p, c, o, (params) =>
        ports.tasks.move(params.taskId, params.to),
      ),
    start: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.TasksIdParamsSchema, p, c, o, (params) => ports.tasks.startTask(params.taskId)),
    finishWithFindings: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.TasksFinishWithFindingsParamsSchema, p, c, o, (params) =>
        ports.tasks.finishWithFindings(params.taskId, params.expectedUpdatedAt),
      ),
    reorder: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.TasksReorderParamsSchema, p, c, o, (params) =>
        ports.tasks.reorder(params.taskIds),
      ),
    retarget: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.TasksRetargetParamsSchema, p, c, o, (params) =>
        ports.retarget(params.taskId, params.workspace, params.autoMerge, c),
      ),
    recheckReview: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.TasksIdParamsSchema, p, c, o, (params) =>
        ports.tasks.recheckReview(params.taskId),
      ),
    readNotes: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.TasksNotesReadParamsSchema, p, c, o, (params) =>
        ports.tasks.readNotes(params.taskId, params.noteIds),
      ),
    resolveNote: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.TasksNotesResolveParamsSchema, p, c, o, (params) =>
        ports.tasks.resolveNote(params.taskId, params.noteId, params.resolved),
      ),
    delete: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.TasksDeleteParamsSchema, p, c, o, async (params) => {
        await ports.tasks.delete(params.taskId, params.discard === true, params.expectedUpdatedAt);
        return { deleted: true as const };
      }),
    preflight: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.TasksSaveParamsSchema, p, c, o, (params) => ports.tasks.preflight(params.task)),
    recordEvaluation: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.TasksEvaluationSaveParamsSchema, p, c, o, (params) =>
        ports.tasks.recordEvaluation(params.taskId, params.evaluation, params.expectedUpdatedAt),
      ),
  };
}
