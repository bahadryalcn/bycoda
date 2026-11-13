import { z } from "zod";
import * as dto from "../../../src/shared/model/host-contracts/automations";
import { assertDomainAuthority, type HostDomainContext } from "../context";

export interface HostAutomationsServicePorts {
  propose?: (
    input: dto.AutomationProposalInput,
    context: HostDomainContext,
  ) => Promise<dto.AutomationProposal>;
  automations: {
    withAuthorization<T>(authorized: () => Promise<boolean>, work: () => Promise<T>): Promise<T>;
    list(): Promise<dto.HostAutomation[]>;
    preview(schedule: unknown): dto.AutomationPreview;
    save(automation: unknown): Promise<dto.HostAutomation>;
    delete(id: string): Promise<void>;
    runs(id: string): Promise<dto.HostAutomationRun[]>;
    runNow(id: string): Promise<dto.HostAutomationRun>;
  };
}
type Options = { legacy?: boolean };

/** Scheduling, run ownership and effects remain in the existing HostAutomations.
 * Mutations wait for this attempt and are never automatically replayed. */
export function createHostAutomationsService(ports: HostAutomationsServicePorts) {
  async function execute<S extends z.ZodObject, R>(
    schema: S,
    raw: unknown,
    context: HostDomainContext,
    options: Options,
    mutation: boolean,
    operation: (params: z.output<S>) => R | Promise<R>,
  ): Promise<R> {
    await assertDomainAuthority(context);
    let params: z.output<S>;
    if (options.legacy) {
      // V1 passes nested input untouched and coerces only the three ID routes.
      const legacy = { ...(raw as Record<string, unknown>) };
      if ("automationId" in schema.shape) legacy.automationId = String(legacy.automationId ?? "");
      params = legacy as z.output<S>;
    } else params = schema.parse(raw) as z.output<S>;
    // A cancelled response waiter does not stop an accepted automation launch.
    // The live paired grant still follows all manual preparation and effects.
    const accepted: HostDomainContext = mutation
      ? { authorized: () => context.authorized(), principalId: context.principalId }
      : context;
    const result = await ports.automations.withAuthorization(
      () => accepted.authorized(),
      async () => {
        await assertDomainAuthority(accepted);
        return operation(params);
      },
    );
    await assertDomainAuthority(accepted);
    return result;
  }
  return {
    propose: (p: unknown, c: HostDomainContext) =>
      execute(dto.AutomationsProposeParamsSchema, p, c, {}, false, async (v) => {
        if (!ports.propose) throw new Error("Automation proposal helper unavailable.");
        return dto.AutomationsProposeResultSchema.parse(await ports.propose(v, c));
      }),
    list: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.AutomationsEmptyParamsSchema, p, c, o, false, () => ports.automations.list()),
    preview: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.AutomationsPreviewParamsSchema, p, c, o, false, (v) =>
        ports.automations.preview(v.schedule),
      ),
    save: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.AutomationsSaveParamsSchema, p, c, o, true, (v) =>
        ports.automations.save(v.automation),
      ),
    delete: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.AutomationsIdParamsSchema, p, c, o, true, async (v) => {
        await ports.automations.delete(v.automationId);
        return { deleted: true as const };
      }),
    runs: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.AutomationsIdParamsSchema, p, c, o, false, (v) =>
        ports.automations.runs(v.automationId),
      ),
    runNow: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      execute(dto.AutomationsIdParamsSchema, p, c, o, true, (v) =>
        ports.automations.runNow(v.automationId),
      ),
  };
}
