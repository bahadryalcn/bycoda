import type { NativeDeviceOwnerPorts, DeviceResultAuthority } from "./native-devices/ports";
import type { DevServersBridgeResult } from "../../src/shared/model/host-contracts/dev-servers";
import type { NativeWorkspaceOwnerScope } from "./native-workspaces/ports";
import type { NativeServiceOwnerPorts } from "./native-services/ports";
import type { NativeDeliveryOwnerPorts } from "./native-delivery/ports";

export class HostDomainAuthorizationError extends Error {
  readonly code = "HOST_DOMAIN_AUTHORIZATION";
  constructor() {
    super("Device authorization was revoked");
    this.name = "HostDomainAuthorizationError";
  }
}

/** Safe domain outcome only; diagnostic storage/provider causes remain local. */
export class HostDomainOutcomeError extends Error {
  constructor(
    message: string,
    readonly delivery: "not-sent" | "accepted" | "unknown",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "HostDomainOutcomeError";
  }
}

/** Authenticated request capabilities supplied by transport composition. */
export interface HostDomainContext {
  nativeDelivery?: NativeDeliveryOwnerPorts;
  nativeServices?: NativeServiceOwnerPorts;
  nativeDevices?: NativeDeviceOwnerPorts;
  /** Request-local result guards survive socket detachment in retained bulk entries. */
  retainResultAuthority?(check: DeviceResultAuthority): void;
  /** Actual Device owner admission; used for legacy HTTP uncertain outcomes. */
  deviceEffectAdmitted?(): void;
  /** Existing managed.withOwner capability, bound by authenticated composition.
   * Retains owner authorization through completion, independent of socket wait. */
  workspaceOwner?: NativeWorkspaceOwnerScope;
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
