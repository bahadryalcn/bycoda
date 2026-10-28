import { z } from "zod";
import * as dto from "../../../src/shared/model/host-contracts/stewards";
import { assertDomainAuthority, type HostDomainContext } from "../context";

export interface HostStewardsServicePorts {
  stewards: {
    withAuthorization<T>(
      authorized: () => Promise<boolean>,
      work: () => Promise<T>,
    ): Promise<T>;
    list(): Promise<dto.HostSteward[]>;
    save(raw: unknown): Promise<dto.HostSteward>;
    delete(id: string): Promise<void>;
    runNow(id: string): Promise<dto.HostSteward>;
    decline(taskId: string): Promise<void>;
  };
}
type Options = { legacy?: boolean };

/** Scheduling and proposal ownership remain with HostStewards. Its list only
 * reads persisted rows; the autonomous tick settles and starts work separately. */
export function createHostStewardsService(ports: HostStewardsServicePorts) {
  async function execute<S extends z.ZodObject, R>(
    schema: S,
    raw: unknown,
    context: HostDomainContext,
    options: Options,
    mutation: boolean,
    operation: (params: z.output<S>) => Promise<R>,
  ): Promise<R> {
    await assertDomainAuthority(context);
    let params: z.output<S>;
    if (options.legacy) {
      // V1 ignores outer extras and delegates the complete nested payload to the
      // old owner parser, coercing only the named ID routes as before.
      const legacy = { ...(raw as Record<string, unknown>) };
      if ("stewardId" in schema.shape)
        legacy.stewardId = String(legacy.stewardId ?? "");
      if ("taskId" in schema.shape) legacy.taskId = String(legacy.taskId ?? "");
      params = legacy as z.output<S>;
    } else params = schema.parse(raw) as z.output<S>;
    // Cancellation detaches an accepted mutation's waiter; the paired grant
    // continues to guard this attempt, never its future autonomous runs.
    const accepted: HostDomainContext = mutation
      ? {
          authorized: () => context.authorized(),
          principalId: context.principalId,
        }
      : context;
    const result = await ports.stewards.withAuthorization(
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
      execute(dto.StewardsEmptyParamsSchema, p, c, o, false, () =>
        ports.stewards.list(),
      ),
    save: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.StewardsSaveParamsSchema, p, c, o, true, (v) =>
        ports.stewards.save(v.steward),
      ),
    delete: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.StewardsIdParamsSchema, p, c, o, true, async (v) => {
        await ports.stewards.delete(v.stewardId);
        return { deleted: true as const };
      }),
    runNow: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.StewardsIdParamsSchema, p, c, o, true, (v) =>
        ports.stewards.runNow(v.stewardId),
      ),
    decline: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.StewardsDeclineParamsSchema, p, c, o, true, async (v) => {
        await ports.stewards.decline(v.taskId);
        return { declined: true as const };
      }),
  };
}
