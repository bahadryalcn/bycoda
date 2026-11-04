import {
  AssistantRequestValidationSchema,
  AssistantResponseValidationSchema,
} from "../../../src/shared/model/host-contracts/assistant";
import { assertDomainAuthority, type HostDomainContext } from "../context";

interface AssistantDomainPort {
  request(raw: unknown, principal: "owner", admission?: {
    environmentId: string;
    deviceHash: string;
    authorized: () => Promise<boolean>;
    signal?: AbortSignal;
  }): Promise<unknown>;
}
interface AssistantStorePort {
  environmentId: string;
  db: { withAuthorization<T>(authorized: () => Promise<boolean>, work: () => Promise<T>): Promise<T> };
}

/** The device RPC always binds an authenticated owner; clients cannot choose it. */
export function assistantDomain(assistant: AssistantDomainPort, store: AssistantStorePort) {
  return async (raw: unknown, context: HostDomainContext) => {
    await assertDomainAuthority(context);
    const request = AssistantRequestValidationSchema.parse(raw);
    return store.db.withAuthorization(
      async () => {
        await assertDomainAuthority({
          authorized: context.authorized,
          principalId: context.principalId,
        });
        return true;
      },
      async () => {
        const result = await assistant.request(request, "owner", context.principalId ? {
          environmentId: store.environmentId,
          deviceHash: context.principalId,
          authorized: context.authorized,
          ...(context.signal ? { signal: context.signal } : {}),
        } : undefined);
        await assertDomainAuthority({
          authorized: context.authorized,
          principalId: context.principalId,
        });
        return AssistantResponseValidationSchema.parse(result);
      },
    );
  };
}
