import {
  type AssistantWorkspaceOwner,
  type WorkspaceOwnerSource,
  workspaceOperationJson,
} from "./assistant-workspace-owner";

/** Called only after owner approval and inside the signed project admission lease. */
export async function transferAssistantWorkspaceOperation(
  owner: AssistantWorkspaceOwner,
  source: WorkspaceOwnerSource,
  current: () => Promise<boolean>,
  valid: () => boolean,
  relay: (input: {
    operationJson: string;
    operationHash: string;
    requestId: string;
  }) => Promise<unknown>,
  verify: (receipt: unknown) => Promise<{ state: "unknown" | "ownerAccepted" | "accepted" }>,
) {
  const receipt = await owner.prepare(source, current, valid);
  if (receipt.state !== "prepared") return receipt;
  if (!(await owner.claim(receipt, valid)))
    throw new Error("Workspace ownership transfer already claimed; inspect its original status.");
  const signed = await relay({
    operationJson: workspaceOperationJson(source),
    operationHash: receipt.operationHash,
    requestId: source.requestId,
  });
  if (!valid() || !(await current()) || !valid())
    throw new Error("Workspace ownership authority changed; inspect its original status.");
  const result = await verify(signed);
  if (result.state === "unknown") return owner.settle(receipt, "unknown", valid);
  if (result.state !== "ownerAccepted")
    throw new Error(
      "Workspace effect preceded durable ownership acceptance; inspect its original status.",
    );
  return owner.settle(receipt, "ownerAccepted", valid);
}

/** The management receipt records handoff completion, not the native UI effect. */
export function describeWorkspaceTransfer(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const envelope = value as Record<string, unknown>;
  if (
    envelope.state !== "completed" ||
    !envelope.result ||
    typeof envelope.result !== "object" ||
    Array.isArray(envelope.result)
  )
    return value;
  const result = envelope.result as Record<string, unknown>;
  if (
    result.state !== "ownerAccepted" &&
    result.state !== "unknown" &&
    result.state !== "completed"
  )
    return value;
  return {
    ...envelope,
    state: result.state === "ownerAccepted" ? "accepted" : result.state,
    receiptState: "completed",
    ownerState: result.state,
  };
}
