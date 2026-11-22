import type { z } from "zod";
import type {
  NATIVE_WORKSPACE_RPC_SCHEMAS,
  NativeWorkspaceMethod,
} from "../../../src/shared/model/host-contracts/native-workspaces";

type Params<Method extends NativeWorkspaceMethod> = z.infer<
  (typeof NATIVE_WORKSPACE_RPC_SCHEMAS)[Method]["params"]
>;
type Operation<Method extends NativeWorkspaceMethod> = (
  request: Params<Method>,
) => Promise<unknown>;

/** Actual operations closed over one issued managed owner. The domain never
 * constructs, stores, inspects or reconstructs the authorization object. */
export interface NativeWorkspaceOwnerActions {
  nativeTurns: {
    begin: Operation<"native.turn.begin">;
    end: Operation<"native.turn.end">;
  };
  nativeActivity: {
    start: Operation<"native.activity.start">;
    end: Operation<"native.activity.end">;
  };
  nativeRewind: {
    bindTurn(
      request: Pick<
        Params<"native.turn.begin">,
        "workspaceId" | "sessionId" | "conversationRevision"
      >,
    ): Promise<unknown>;
    plan: Operation<"native.rewind.plan">;
    prepare: Operation<"native.rewind.prepare">;
    apply: Operation<"native.rewind.apply">;
    status: Operation<"native.rewind.status">;
    lookup: Operation<"native.rewind.lookup">;
    cancelPreparation: Operation<"native.rewind.cancelPreparation">;
    ack: Operation<"native.rewind.ack">;
  };
  removal: { apply: Operation<"workspaces.cleanup.apply"> };
}
export type NativeWorkspaceOwnerScope = <T>(
  action: (owner: NativeWorkspaceOwnerActions) => Promise<T>,
) => Promise<T>;

/** Read/gate ports retain the existing Host implementation. Workspace admission
 * only needs this already-authorized identity projection, not a runtime graph. */
export interface NativeWorkspacesPorts {
  managed: {
    exactGitRewind: { enabled(): Promise<boolean> };
    assertWritable(workspaceId: string): Promise<void>;
    /** Settles (apply) or detects a creation blocked before Git ran; null when not applicable. */
    abandonUnmaterializedCreate(
      workspaceId: string,
      apply: boolean,
    ): Promise<{ id: string; revision: number; branchRef: string } | null>;
    removal: {
      plan: Operation<"workspaces.cleanup.plan">;
      status: Operation<"workspaces.cleanup.status">;
    };
  };
  workspace(id: unknown): Promise<{ id: string; owner: { kind: string; id: string } } | null>;
  touchActivity(id: string): Promise<unknown>;
}
