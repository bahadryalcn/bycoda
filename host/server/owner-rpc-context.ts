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
  /**
   * This computer's own desktop credential, sent straight to the loopback listener with no
   * browser origin. Forwarded requests (phone listener, tunnel) never qualify, whatever
   * their socket address.
   */
  thisComputer: boolean;
  pollState: { revoked: boolean };
  response: ServerResponse;
  closing: boolean;
}
