import { invoke } from "@tauri-apps/api/core";
import type { ForwardRule } from "./serverInventory";

export type ForwardStatus = {
  id: string;
  connectionId: string;
  localPort: number;
  kind?: "local" | "dynamic";
  targetHost: string;
  targetPort: number;
  state: "starting" | "running" | "failed" | "stopped";
  error?: string;
};

export function validateForwardRule(input: {
  name: string;
  kind?: "local" | "dynamic";
  localPort: string;
  targetHost: string;
  targetPort: string;
}): Omit<ForwardRule, "id"> {
  const localPort = Number(input.localPort);
  const targetPort = Number(input.targetPort);
  const targetHost = input.targetHost.trim();
  const kind = input.kind ?? "local";
  if (kind !== "local" && kind !== "dynamic") throw new Error("Invalid forwarding type.");
  if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535)
    throw new Error("Enter a port between 1 and 65535.");
  if (input.name.trim().length > 100) throw new Error("Name must be at most 100 characters.");
  if (kind === "dynamic")
    return {
      kind,
      name: input.name.trim() || `SOCKS5 :${localPort}`,
      localPort,
      targetHost: "",
      targetPort: 0,
    };
  if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535)
    throw new Error("Enter a port between 1 and 65535.");
  if (
    !targetHost ||
    targetHost.length > 253 ||
    targetHost.startsWith("-") ||
    !/^[\w.:-]+$/.test(targetHost)
  )
    throw new Error("Enter a valid destination hostname or IP address.");
  return {
    kind,
    name: input.name.trim() || `${targetHost}:${targetPort}`,
    localPort,
    targetHost,
    targetPort,
  };
}
export const forwardRuntimeId = (connectionId: string, ruleId: string) =>
  `${connectionId}:${ruleId}`;
export const listSshForwards = () => invoke<ForwardStatus[]>("ssh_forward_list");
export const stopSshForward = (id: string) => invoke<void>("ssh_forward_stop", { id });
export function startSshForward(
  connectionId: string,
  rule: ForwardRule,
  httpProxyTicketId?: string,
) {
  return invoke<ForwardStatus>("ssh_forward_start", {
    id: forwardRuntimeId(connectionId, rule.id),
    connectionId,
    localPort: rule.localPort,
    kind: rule.kind ?? "local",
    targetHost: rule.targetHost,
    targetPort: rule.targetPort,
    ...(httpProxyTicketId ? { httpProxyTicketId } : {}),
  });
}
