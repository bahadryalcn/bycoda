import { assertDomainAuthority, type HostDomainContext } from "../domains/context";
import type { ServerBindings } from "../server/bindings";
import type { OwnerRpcRequest } from "../server/owner-rpc-context";
import { DRAFT_PRESENCE_METHOD, DraftPresenceReport, type DraftPresenceRegistry } from "./presence";
import type { HostStore } from "../store";

/** HTTP and WS share authenticated principal-to-device binding. */
export async function reportDraftPresence(
  store: HostStore,
  registry: DraftPresenceRegistry,
  raw: unknown,
  context: HostDomainContext,
): Promise<{ accepted: true }> {
  const params = DraftPresenceReport.parse(raw);
  await assertDomainAuthority(context);
  if (!context.principalId) throw new Error("Draft presence device is unavailable");
  const device = await store.db
    .prepare("SELECT id FROM devices WHERE hash=?")
    .get(context.principalId);
  if (typeof device?.id !== "string") throw new Error("Draft presence device is unavailable");
  await assertDomainAuthority(context);
  return registry.report(device.id, params);
}

/** Owner dispatcher supplies authenticated device credentials, never caller-supplied device IDs. */
export async function handleDraftPresenceRpc(
  dependencies: Pick<ServerBindings, "accountPlatform" | "engine">,
  request: OwnerRpcRequest,
): Promise<void> {
  if (String(request.input.method) !== DRAFT_PRESENCE_METHOD)
    throw new Error("Unsupported draft presence method");
  request.result = await reportDraftPresence(
    dependencies.engine.store,
    dependencies.accountPlatform.drafts,
    request.params,
    { ...request.domainContext, principalId: request.tokenHash },
  );
}
