import { CREWS_RPC_SCHEMAS } from "../../../src/shared/model/host-contracts/crews";
import { assertDomainAuthority, type HostDomainContext } from "../context";

export type CrewRpcMethod = keyof typeof CREWS_RPC_SCHEMAS;
const queries = new Set<CrewRpcMethod>(["crews.schema", "crews.inspect", "crews.get"]);

export function createHostCrewsService(ports: {
  crews: {
    withAuthorization<T>(authorize: () => Promise<boolean>, work: () => Promise<T>): Promise<T>;
    call(method: string, params: Record<string, unknown>, projectId: string): Promise<unknown>;
  };
}) {
  return {
    async call(
      method: CrewRpcMethod,
      raw: unknown,
      context: HostDomainContext,
      options: { legacy?: boolean } = {},
    ) {
      await assertDomainAuthority(context);
      const params = options.legacy
        ? { ...(raw as Record<string, unknown>) }
        : CREWS_RPC_SCHEMAS[method].params.parse(raw);
      const accepted: HostDomainContext = queries.has(method)
        ? context
        : { authorized: () => context.authorized(), principalId: context.principalId };
      const value = await ports.crews.withAuthorization(
        async () => {
          if (accepted.signal?.aborted) throw new Error("Request cancelled");
          const authorized = await accepted.authorized();
          if (accepted.signal?.aborted) throw new Error("Request cancelled");
          // The Store owns the denial type. Its owner uses that type to record
          // already accepted create/send receipts through narrow SQL recovery.
          return authorized;
        },
        async () => {
          await assertDomainAuthority(accepted);
          // Paired owner requests have no conversation principal. It is never
          // extracted from params; scoped tools keep their separate native binding.
          return ports.crews.call(method, params, String(params.projectId ?? ""));
        },
      );
      await assertDomainAuthority(accepted);
      return value;
    },
  };
}
