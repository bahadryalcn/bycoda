import { z } from "zod";
import * as dto from "../../../src/shared/model/host-contracts/goals";
import { assertDomainAuthority, type HostDomainContext } from "../context";

export interface HostGoalsServicePorts<Goal extends dto.HostGoal> {
  goals: {
    withAuthorization<T>(authorized: () => Promise<boolean>, work: () => Promise<T>): Promise<T>;
    list(): Promise<Goal[]>;
    create(raw: unknown): Promise<Goal>;
    recheckFinalReview(id: string, expectedUpdatedAt: unknown): Promise<Goal>;
    approve(id: string): Promise<Goal>;
    update(id: string, settings: unknown, expectedUpdatedAt: unknown): Promise<Goal>;
    replan(id: string, feedback?: unknown): Promise<Goal>;
    cancel(id: string): Promise<Goal>;
    delete(id: string, withTasks?: boolean): Promise<void>;
  };
}
type Options = { legacy?: boolean };
/** All eight operations are stateful, wait-only and never automatically replayed.
 * Even list reconciles task/review progress and persists pending-review identity. */
export function createHostGoalsService<Goal extends dto.HostGoal>(
  ports: HostGoalsServicePorts<Goal>,
) {
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
      // Existing HTTP delegates nested input/errors/defaults to HostGoals. It
      // ignores outer extras, coerces goal IDs and treats only true as withTasks.
      const legacy = { ...(raw as Record<string, unknown>) };
      if ("goalId" in schema.shape) legacy.goalId = String(legacy.goalId ?? "");
      params = legacy as z.output<S>;
    } else params = schema.parse(raw) as z.output<S>;
    // Admission checks cancellation; accepted work outlives the socket's waiter.
    // The exact live device grant remains mandatory at actual storage/effects.
    const accepted: HostDomainContext = {
      authorized: () => context.authorized(),
      principalId: context.principalId,
    };
    const result = await ports.goals.withAuthorization(
      async () => {
        await assertDomainAuthority(accepted);
        return true;
      },
      async () => {
        await assertDomainAuthority(accepted);
        return operation(params);
      },
    );
    await assertDomainAuthority(accepted);
    return result;
  }
  return {
    list: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.GoalsEmptyParamsSchema, p, c, o, () => ports.goals.list()),
    create: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.GoalsCreateParamsSchema, p, c, o, (v) => ports.goals.create(v.goal)),
    recheckFinalReview: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.GoalsRecheckParamsSchema, p, c, o, (v) =>
        ports.goals.recheckFinalReview(v.goalId, v.expectedUpdatedAt),
      ),
    approve: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.GoalsIdParamsSchema, p, c, o, (v) => ports.goals.approve(v.goalId)),
    update: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.GoalsUpdateParamsSchema, p, c, o, (v) =>
        ports.goals.update(v.goalId, v.settings, v.expectedUpdatedAt),
      ),
    replan: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.GoalsReplanParamsSchema, p, c, o, (v) =>
        ports.goals.replan(v.goalId, v.feedback),
      ),
    cancel: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.GoalsIdParamsSchema, p, c, o, (v) => ports.goals.cancel(v.goalId)),
    delete: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.GoalsDeleteParamsSchema, p, c, o, async (v) => {
        await ports.goals.delete(v.goalId, v.withTasks === true);
        return { deleted: true as const };
      }),
  };
}
