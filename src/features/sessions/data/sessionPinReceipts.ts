import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  flushHostSessionBindings,
  hostSessionBinding,
} from "../../connections/public/sessionExecutionBinding";
import { pathKey } from "../../../shared/lib/paths";
import { isRemoteProjectPath } from "../../projects/public/recents";

export type NativePinAuthority = {
  environmentId: string;
  generation: number;
  phase: string;
  minWriterProtocol: number;
};
export type PinReceipt = {
  state: "current" | "applied" | "superseded" | "refused";
  version: number;
  pinned: boolean | null;
  authority?: NativePinAuthority | null;
};
export type PinAttempt = PinReceipt | { state: "unknown"; operationId: string };
export type PinTarget =
  | { kind: "native"; sessionId: string; cwd: string }
  | {
      kind: "host";
      sessionId: string;
      machineId: string;
      environmentId?: string;
      projectId: string;
      authorityGeneration?: number;
    };

export function samePinTarget(left: PinTarget, right: PinTarget): boolean {
  if (left.kind !== right.kind || left.sessionId !== right.sessionId) return false;
  if (left.kind === "native" && right.kind === "native")
    return pathKey(left.cwd) === pathKey(right.cwd);
  if (left.kind === "host" && right.kind === "host")
    return (
      left.machineId === right.machineId &&
      left.environmentId === right.environmentId &&
      left.projectId === right.projectId &&
      left.authorityGeneration === right.authorityGeneration
    );
  return false;
}

export async function resolvePinTarget(sessionId: string, cwd: string): Promise<PinTarget> {
  await flushHostSessionBindings(sessionId);
  const owner = hostSessionBinding({ id: sessionId });
  if (!owner) {
    if (!cwd || cwd === "~" || isRemoteProjectPath(cwd))
      throw new Error("The pin owner is unavailable.");
    return { kind: "native", sessionId, cwd };
  }
  if (!owner.created)
    throw new Error("Verify the pending conversation creation before changing its pin.");
  return {
    kind: "host",
    sessionId: owner.sessionId,
    machineId: owner.machineId,
    environmentId: owner.environmentId,
    projectId: owner.projectId,
    ...(owner.authorityGeneration === null
      ? {}
      : { authorityGeneration: owner.authorityGeneration }),
  };
}

async function host(target: Extract<PinTarget, { kind: "host" }>) {
  const { sessionAccessForMachine } = await import("../../connections/public/connections");
  return sessionAccessForMachine(target.machineId, false, true, target.environmentId);
}

export async function pinState(target: PinTarget): Promise<PinReceipt> {
  if (target.kind === "host")
    return (await host(target)).pinState(
      target.sessionId,
      target.projectId,
      target.authorityGeneration,
    );
  return nativePinState(target.sessionId, target.cwd);
}

export async function pinReceipt(
  target: PinTarget,
  operationId: string,
): Promise<PinReceipt | null> {
  if (target.kind === "host")
    return (await host(target)).pinReceipt(target.sessionId, target.projectId, operationId);
  return nativePinReceipt(operationId, target.sessionId, target.cwd);
}

export async function pinAttempt(
  target: PinTarget,
  operationId: string,
  desiredPinned: boolean,
  expectedVersion: number,
  expectedAuthority?: NativePinAuthority | null,
): Promise<PinAttempt> {
  if (target.kind === "native")
    return nativePinAttempt(
      operationId,
      target.sessionId,
      target.cwd,
      desiredPinned,
      expectedVersion,
      expectedAuthority ?? null,
    );
  try {
    return await (
      await host(target)
    ).pinApply(
      target.sessionId,
      target.projectId,
      operationId,
      desiredPinned,
      expectedVersion,
      target.authorityGeneration,
    );
  } catch {
    try {
      return (await pinReceipt(target, operationId)) ?? { state: "unknown", operationId };
    } catch {
      return { state: "unknown", operationId };
    }
  }
}

/** Native-only until Host pin receipts are available. Never transfer ownership. */
export async function nativePinState(sessionId: string, cwd: string): Promise<PinReceipt> {
  if (!isTauri() || isRemoteProjectPath(cwd) || hostSessionBinding({ id: sessionId }))
    throw new Error("Exact pin authority is unavailable for this conversation.");
  return invoke<PinReceipt>("session_pin_state", { sessionId, cwd });
}

export async function nativePinReceipt(
  operationId: string,
  sessionId: string,
  cwd: string,
): Promise<PinReceipt | null> {
  return invoke<PinReceipt | null>("session_pin_receipt", { operationId, sessionId, cwd });
}

export async function nativePinAttempt(
  operationId: string,
  sessionId: string,
  cwd: string,
  desiredPinned: boolean,
  expectedVersion: number,
  expectedAuthority: NativePinAuthority | null,
): Promise<PinAttempt> {
  if (!isTauri() || isRemoteProjectPath(cwd) || hostSessionBinding({ id: sessionId }))
    throw new Error("Exact pin authority is unavailable for this conversation.");
  try {
    return await invoke<PinReceipt>("session_pin_apply", {
      operationId,
      sessionId,
      cwd,
      desiredPinned,
      expectedVersion,
      expectedAuthority,
    });
  } catch {
    try {
      return (
        (await nativePinReceipt(operationId, sessionId, cwd)) ?? { state: "unknown", operationId }
      );
    } catch {
      return { state: "unknown", operationId };
    }
  }
}
