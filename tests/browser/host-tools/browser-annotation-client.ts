/** Source fixture transport. Playwright routes this endpoint to a real source
 * SharedBrowser, with a separate page and ephemeral test-only identity. */
import type { HostToolTarget } from "../../../src/features/connections/model/hostToolTarget";

export async function listHostToolMachines() {
  return [];
}

export async function openBrowserFrameStream() {
  if (!(window as Window & { fixtureBrowserFrames?: boolean }).fixtureBrowserFrames)
    throw new Error("Native media is unavailable in this fixture");
  return {
    read: async (after: number) =>
      (await fetch(`/browser-fixture/media?after=${after}`)).arrayBuffer(),
    close: async () => {},
  };
}

export async function subscribeDeviceVideo(): Promise<never> {
  throw new Error("The browser fixture has no device video");
}

export async function deviceTouchAvailable() {
  return false;
}

export async function hostToolRequest<T>(
  cwd: string,
  capability: string,
  method: string,
  params: Record<string, unknown> = {},
  target: HostToolTarget = { kind: "project" },
): Promise<T> {
  if (target.kind !== "project")
    throw new Error("This annotation fixture supports only its project host");
  return hostFeatureRequest<T>(cwd, capability, method, params);
}
export async function featureHost() {
  throw new Error("This fixture only resolves browser annotation requests");
}
export async function hostFeatureRequest<T>(
  cwd: string,
  _capability: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch("/browser-fixture/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      method,
      params: { ...params, projectId: cwd.endsWith("project-b") ? "project-b" : "project-a" },
    }),
  });
  const result = await response.json();
  if (result.error) throw new Error(result.error);
  return result.result;
}
