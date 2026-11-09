import type { IncomingMessage, ServerResponse } from "node:http";
import type { HostDomainContext } from "../domains/context";
import { body } from "./support";
export interface OwnerRpcRequest {
  input: Awaited<ReturnType<typeof body>>;
  params: Record<string, unknown>;
  result: unknown;
  token: string;
  domainContext: HostDomainContext;
  tokenHash: string;
  request: IncomingMessage;
  pollState: { revoked: boolean };
  response: ServerResponse;
  closing: boolean;
}
