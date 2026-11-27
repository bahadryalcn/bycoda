import {
  GroupAuthorizeHiddenParamsSchema,
  GroupLockParamsSchema,
  GroupSetHiddenParamsSchema,
  GroupUnlockParamsSchema,
  type GroupPasswordResult,
} from "../../src/shared/model/host-contracts/group-lock";
import { assertDomainAuthority, type HostDomainContext } from "../domains/context";
import type { ServerBindings } from "../server/bindings";
import type { OwnerRpcRequest } from "../server/owner-rpc-context";
import {
  groupLockUnavailable,
  type DesktopGroupLock,
  type GroupLockReply,
} from "./desktop-group-lock";

const MAX_RETRY_MS = 24 * 60 * 60_000;

/** The calling device, as the Host knows it; grants are never keyed by a caller-sent id. */
function principalOf(context: HostDomainContext): string {
  if (!context.principalId) throw new Error("Group lock device is unavailable");
  return context.principalId;
}

/** Only a verdict leaves this module; anything else the desktop sent is "unavailable". */
function verdict(reply: GroupLockReply): GroupPasswordResult {
  if (reply.result !== "ok" && reply.result !== "wrong" && reply.result !== "throttled")
    throw groupLockUnavailable();
  const wait = Number(reply.retryAfterMs);
  return {
    result: reply.result,
    ...(reply.result !== "ok" && Number.isFinite(wait) && wait > 0
      ? { retryAfterMs: Math.min(MAX_RETRY_MS, Math.ceil(wait)) }
      : {}),
  };
}

/**
 * Remote group lock. The password is checked by the desktop renderer with the same
 * hash and attempt throttle its own dialogs use; the Host keeps no password, hash or
 * attempt count, only which devices passed, in memory.
 */
export function createGroupLockService(dependencies: { groupLock: () => DesktopGroupLock }) {
  return {
    async unlock(raw: unknown, context: HostDomainContext): Promise<GroupPasswordResult> {
      await assertDomainAuthority(context);
      const params = GroupUnlockParamsSchema.parse(raw);
      const principal = principalOf(context);
      const groupLock = dependencies.groupLock();
      // An unknown group and a wrong password are both "wrong" from the desktop.
      const result = verdict(await groupLock.request({ kind: "unlock", ...params }));
      // A device revoked while the desktop checked must not leave with a grant.
      await assertDomainAuthority(context);
      if (result.result === "ok") groupLock.grantGroup(principal, params.groupId);
      return result;
    },

    async authorizeHidden(raw: unknown, context: HostDomainContext): Promise<GroupPasswordResult> {
      await assertDomainAuthority(context);
      const params = GroupAuthorizeHiddenParamsSchema.parse(raw);
      const principal = principalOf(context);
      const groupLock = dependencies.groupLock();
      const result = verdict(await groupLock.request({ kind: "authorizeHidden", ...params }));
      await assertDomainAuthority(context);
      if (result.result === "ok") groupLock.grantHidden(principal);
      return result;
    },

    /** Drops this device's grant for one group, or all of them. Never touches the desktop. */
    async lock(raw: unknown, context: HostDomainContext) {
      await assertDomainAuthority(context);
      const params = GroupLockParamsSchema.parse(raw);
      dependencies.groupLock().revoke(principalOf(context), params.groupId);
      return { locked: true as const };
    },

    /** Hiding and unhiding need the hidden-list grant; neither unlocks anything. */
    async setHidden(raw: unknown, context: HostDomainContext) {
      await assertDomainAuthority(context);
      const params = GroupSetHiddenParamsSchema.parse(raw);
      const principal = principalOf(context);
      const groupLock = dependencies.groupLock();
      if (!groupLock.access(principal).hiddenList)
        throw new Error("Enter the hidden groups password first.");
      const reply = await groupLock.request({ kind: "setHidden", ...params });
      await assertDomainAuthority(context);
      if (reply.error || reply.result !== "ok") throw new Error("The group could not be updated.");
      // Hiding a group ends this device's unlock of it; showing it again leaves it as the desktop has it.
      if (params.hidden) groupLock.revoke(principal, params.groupId);
      groupLock.onChange?.();
      return { updated: true as const };
    },
  };
}

/** HTTP twin of the WebSocket methods; the device is the authenticated token, never a parameter. */
export async function handleGroupLockRpc(
  dependencies: Pick<ServerBindings, "desktop">,
  request: OwnerRpcRequest,
): Promise<void> {
  const service = createGroupLockService({ groupLock: () => dependencies.desktop.live.groupLock });
  const context = { ...request.domainContext, principalId: request.tokenHash };
  switch (String(request.input.method)) {
    case "projects.groups.unlock":
      request.result = await service.unlock(request.params, context);
      break;
    case "projects.groups.authorizeHidden":
      request.result = await service.authorizeHidden(request.params, context);
      break;
    case "projects.groups.lock":
      request.result = await service.lock(request.params, context);
      break;
    case "projects.groups.setHidden":
      request.result = await service.setHidden(request.params, context);
      break;
    default:
      throw new Error("Unsupported group lock method");
  }
}
