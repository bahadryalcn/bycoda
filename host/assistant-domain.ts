import {
  AssistantRequestValidationSchema,
  AssistantResponseValidationSchema,
} from "../src/shared/model/host-contracts/assistant";
import type { HostAssistant } from "./assistant/service";
import type { HostStore } from "./store";
import { assertDomainAuthority, type HostDomainContext } from "./domains/context";

/** The device RPC always binds an authenticated owner; clients cannot choose it. */
export function assistantDomain(assistant: HostAssistant, store: HostStore) {
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
        const result = await assistant.request(request, "owner");
        await assertDomainAuthority({
          authorized: context.authorized,
          principalId: context.principalId,
        });
        return AssistantResponseValidationSchema.parse(result);
      },
    );
  };
}
