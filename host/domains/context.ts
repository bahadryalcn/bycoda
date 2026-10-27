import type { DevServersBridgeResult } from "../../src/shared/model/host-contracts/dev-servers";

export class HostDomainAuthorizationError extends Error {
  readonly code = "HOST_DOMAIN_AUTHORIZATION";
  constructor() {
    super("Device authorization was revoked");
    this.name = "HostDomainAuthorizationError";
  }
}

/** Authenticated request capabilities supplied by transport composition. */
export interface HostDomainContext {
  authorized(): Promise<boolean>;
  /** Opaque authenticated identity; never a bearer credential. */
  readonly principalId?: string;
  readonly signal?: AbortSignal;
  closing?(): boolean;
  /** Request-scoped grant; credentials remain in transport composition. */
  exposeQueueAttachments?(ids: string[], params: Record<string, unknown>): Promise<void>;
  /** Existing workspace-owner capability, bound to this authenticated request. */
  retargetTask?(id: string, workspace: unknown, autoMerge: unknown): Promise<unknown>;
  devServerAccess?(
    method: `devServers.${"bridgeCheck" | "bridgeOpen" | "bridgeRead" | "bridgeWrite" | "bridgeClose"}`,
    params: Record<string, unknown>,
    authorize: () => Promise<void>,
  ): Promise<DevServersBridgeResult>;
}

export async function assertDomainAuthority(context: HostDomainContext): Promise<void> {
  if (context.signal?.aborted) throw new Error("Request cancelled");
  if (!(await context.authorized())) throw new HostDomainAuthorizationError();
  if (context.signal?.aborted) throw new Error("Request cancelled");
}
