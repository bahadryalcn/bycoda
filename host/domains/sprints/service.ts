import { z } from "zod";
import * as dto from "../../../src/shared/model/host-contracts/sprints";
import { assertDomainAuthority, type HostDomainContext } from "../context";

export interface HostSprintsServicePorts {
  sprints: {
    withAuthorization<T>(authorized: () => Promise<boolean>, work: () => Promise<T>): Promise<T>;
    list(): Promise<dto.SprintBoard>;
    get(id: string): Promise<dto.HostSprint | undefined>;
    create(input: dto.SprintCreateInput): Promise<dto.HostSprint>;
    update(id: string, input: dto.SprintUpdateInput): Promise<dto.HostSprint>;
    start(id: string, input: dto.SprintCommand): Promise<dto.HostSprint>;
    complete(id: string, input: dto.SprintCompleteInput): Promise<dto.HostSprint>;
    archive(id: string, input: dto.SprintCommand): Promise<dto.HostSprint>;
    plan(input: dto.SprintPlanInput): Promise<dto.SprintPlanItem>;
    report(id: string): Promise<dto.SprintReport>;
    ingest(input: dto.SprintIngestInput): Promise<dto.SprintSourceState>;
    setGoalContext(input: dto.SprintGoalContextInput): Promise<dto.SprintGoalContext>;
  };
}
type Options = { legacy?: boolean };
/** Paired owner planning only; execution and project-scoped tool grants stay
 * with their existing owners. No scheduler or provider authority is created. */
export function createHostSprintsService({ sprints }: HostSprintsServicePorts) {
  async function execute<S extends z.ZodObject, R>(
    schema: S,
    raw: unknown,
    context: HostDomainContext,
    options: Options,
    stateful: boolean,
    operation: (params: z.output<S>) => Promise<R>,
  ): Promise<R> {
    await assertDomainAuthority(context);
    let params: z.output<S>;
    if (options.legacy) {
      // Keep owner field/default/CAS validation and HTTP input receipt bytes.
      // Unknown nested fields were tolerated; do not strip or reserialize them.
      const legacy = { ...(raw as Record<string, unknown>) };
      if ("id" in schema.shape) legacy.id = String(legacy.id ?? "");
      params = legacy as z.output<S>;
    } else params = schema.parse(raw) as z.output<S>;
    const active: HostDomainContext = stateful
      ? { authorized: () => context.authorized(), principalId: context.principalId }
      : context;
    // Cancellation stops waiting for an accepted metadata transaction. Its live
    // device grant still guards concrete writes after every preparation wait.
    const result = await sprints.withAuthorization(
      async () => {
        await assertDomainAuthority(active);
        return true;
      },
      async () => {
        await assertDomainAuthority(active);
        return operation(params);
      },
    );
    await assertDomainAuthority(active);
    return result;
  }
  return {
    list: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.SprintsEmptyParamsSchema, p, c, o, false, () => sprints.list()),
    get: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.SprintsIdParamsSchema, p, c, o, false, async (v) => {
        const result = await sprints.get(v.id);
        return o.legacy ? result : (result ?? null);
      }),
    create: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.SprintsCreateParamsSchema, p, c, o, true, (v) => sprints.create(v.input)),
    update: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.SprintsUpdateParamsSchema, p, c, o, true, (v) => sprints.update(v.id, v.input)),
    start: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.SprintsCommandParamsSchema, p, c, o, true, (v) => sprints.start(v.id, v.input)),
    complete: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.SprintsCompleteParamsSchema, p, c, o, true, (v) =>
        sprints.complete(v.id, v.input),
      ),
    archive: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.SprintsCommandParamsSchema, p, c, o, true, (v) => sprints.archive(v.id, v.input)),
    plan: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.SprintsPlanParamsSchema, p, c, o, true, (v) => sprints.plan(v.input)),
    report: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.SprintsIdParamsSchema, p, c, o, false, (v) => sprints.report(v.id)),
    ingest: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.SprintsIngestParamsSchema, p, c, o, true, (v) => sprints.ingest(v.input)),
    setGoalContext: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.SprintsGoalContextParamsSchema, p, c, o, true, (v) =>
        sprints.setGoalContext(v.input),
      ),
  };
}
