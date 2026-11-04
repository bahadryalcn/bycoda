// Shared fixture device runtime only; draft state still travels through actual transfer events.
import {
  hostFeatureRequest as baseFeatureRequest,
  hostToolRequest as baseToolRequest,
} from "./host-tools-mocks";
import type { HostToolTarget } from "../../src/features/connections/model/hostToolTarget";
export * from "./host-tools-mocks";
const key = "session-tools.fixture-device-runtime";
function shared(method: string, result: unknown) {
  if (new URLSearchParams(location.search).get("shared-device") !== "1") return result;
  const state = JSON.parse(localStorage.getItem(key) ?? '{"running":false,"booted":false}');
  if (method === "devices.start") state.running = true;
  if (method === "devices.boot") state.booted = true;
  if (method === "devices.stop") state.running = false;
  localStorage.setItem(key, JSON.stringify(state));
  if (method === "devices.status") return { ...(result as object), running: state.running };
  if (method === "devices.list")
    return {
      ...(result as object),
      devices: (result as { devices: object[] }).devices.map((device) => ({
        ...device,
        booted: state.booted,
      })),
    };
  return result;
}
export async function hostFeatureRequest<T>(
  cwd: string,
  capability: string,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  return shared(method, await baseFeatureRequest(cwd, capability, method, params)) as T;
}
export async function hostToolRequest<T>(
  cwd: string,
  capability: string,
  method: string,
  params: Record<string, unknown>,
  target: HostToolTarget,
): Promise<T> {
  return shared(method, await baseToolRequest(cwd, capability, method, params, target)) as T;
}
