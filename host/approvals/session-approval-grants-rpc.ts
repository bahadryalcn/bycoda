import {
  RevokeSessionApprovalGrantParamsSchema,
  SessionApprovalGrantsParamsSchema,
} from "../../src/shared/model/host-contracts/session-approval-grants";
import { assertDomainAuthority, type HostDomainContext } from "../domains/context";
import type { HostEngine } from "../engine";

export function sessionApprovalGrantsRpc(
  engine: Pick<HostEngine, "sessionApprovalGrantList">,
  params: unknown,
  context: HostDomainContext,
  revoke = false,
) {
  const schema = revoke
    ? RevokeSessionApprovalGrantParamsSchema
    : SessionApprovalGrantsParamsSchema;
  return engine.sessionApprovalGrantList(schema.parse(params), () =>
    assertDomainAuthority(context),
  );
}
