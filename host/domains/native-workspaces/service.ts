import {
  NATIVE_WORKSPACE_RPC_SCHEMAS,
  type NativeWorkspaceMethod,
} from "../../../src/shared/model/host-contracts/native-workspaces";
import type { NativeWorkspacesPorts, NativeWorkspaceOwnerActions } from "./ports";
import {
  assertDomainAuthority,
  HostDomainAuthorizationError,
  type HostDomainContext,
} from "../context";

export type { NativeWorkspacesPorts } from "./ports";

/** Transport-neutral routing to the existing sole durable owners. Credential
 * identity is supplied only by a per-request capability, never by RPC params. */
export function createNativeWorkspacesService(ports: NativeWorkspacesPorts) {
  async function call(
    method: NativeWorkspaceMethod,
    raw: Record<string, unknown>,
    context: HostDomainContext,
    options: { legacy?: boolean } = {},
  ): Promise<unknown> {
    await assertDomainAuthority(context);
    const params = options.legacy ? raw : NATIVE_WORKSPACE_RPC_SCHEMAS[method].params.parse(raw);
    const owner = context.workspaceOwner;
    if (!owner) throw new HostDomainAuthorizationError();
    const { managed } = ports;
    let result: unknown;
    if (method.startsWith("native.rewind.") || method.startsWith("native.turn.")) {
      if (!(await managed.exactGitRewind.enabled()))
        throw new Error("Exact Git rewind is disabled on this execution host");
      await assertDomainAuthority(context);
    }
    if (method === "native.turn.begin" || method === "native.turn.end") {
      const request = params as Parameters<NativeWorkspaceOwnerActions["nativeTurns"]["begin"]>[0];
      const workspace = await ports.workspace(request.workspaceId);
      if (
        !workspace ||
        workspace.owner.kind !== "session" ||
        workspace.owner.id !== request.sessionId
      )
        throw new Error("Session does not own this workspace");
      result = await owner(async (owned) => {
        await assertDomainAuthority(context);
        if (method === "native.turn.begin") {
          await owned.nativeRewind.bindTurn(request);
          return owned.nativeTurns.begin(request);
        }
        return owned.nativeTurns.end(request);
      });
      await ports.touchActivity(workspace.id);
    } else if (method.startsWith("native.rewind.")) {
      const action = method.slice("native.rewind.".length) as
        | "plan"
        | "prepare"
        | "apply"
        | "status"
        | "lookup"
        | "cancelPreparation"
        | "ack";
      result = await owner<unknown>((owned) => owned.nativeRewind[action](params as never));
    } else if (method.startsWith("native.buffers.recovery.")) {
      const action =
        method === "native.buffers.recovery.list"
          ? "listBufferRecovery"
          : method === "native.buffers.recovery.read"
            ? "readBufferRecovery"
            : "bufferRecoveryStatus";
      result = await owner<unknown>((owned) => owned.nativeActivity[action](params as never));
    } else if (method.startsWith("native.")) {
      const action =
        method === "native.activity.start"
          ? "start"
          : method === "native.activity.end"
            ? "end"
            : method === "native.buffers.update"
              ? "updateBuffers"
              : method === "native.buffers.heartbeat"
                ? "heartbeatBuffers"
                : method === "native.buffers.retire"
                  ? "retireBuffers"
                  : "reconcileBuffers";
      result = await owner<unknown>((owned) => owned.nativeActivity[action](params as never));
    } else {
      const request = params as {
        workspaceId: string;
        expectedRevision: number;
        idempotencyKey: string;
        planToken: string;
      };
      if (!(await ports.workspace(request.workspaceId)))
        throw new Error("Managed workspace not found");
      await assertDomainAuthority(context);
      if (method === "workspaces.cleanup.status") result = await managed.removal.status(request);
      else if (method === "workspaces.cleanup.plan") {
        // A creation that never reached Git has nothing to recover; its record can be retired.
        // A preview reports why removal is blocked instead of failing as an opaque read.
        const blocker = (await managed.abandonUnmaterializedCreate(request.workspaceId, false))
          ? undefined
          : await managed.assertWritable(request.workspaceId).then(
              () => undefined,
              (error: unknown) => (error instanceof Error ? error.message : String(error)),
            );
        const plan = (await managed.removal.plan(request)) as { blockers: string[] };
        result = blocker ? { ...plan, blockers: [blocker, ...plan.blockers] } : plan;
      } else {
        const pending = await managed.abandonUnmaterializedCreate(request.workspaceId, false);
        if (pending) {
          if (pending.revision !== request.expectedRevision)
            throw new Error("Workspace revision changed; preview again");
          const retired = (await owner(async () =>
            managed.abandonUnmaterializedCreate(request.workspaceId, true),
          ))!;
          result = {
            operationId: request.idempotencyKey,
            workspaceId: retired.id,
            directoryState: "removed",
            workspaceRevision: retired.revision,
            retainedBranchRef: retired.branchRef,
            recoveryIds: [],
          };
        } else result = await owner((owned) => owned.removal.apply(request));
      }
    }
    await assertDomainAuthority(context);
    return result;
  }
  return { call };
}
