import { pageConversationListResult } from "../../conversation/conversation-list-page";
import type { ConversationProjectTools } from "../../conversation/conversation-project-tools";
import type { DeviceHost } from "../../devices/device-host";
import type { RuntimeLogMonitors } from "../../execution/runtime-log-monitors";
import { readHarnessSkill, searchHarnessSkills } from "../../skills/harness-skills";
import type { AssistantThreadPrincipal } from "../../sessions/session-authority";

/** Read-only application reads a Room project thread may make with its own project identity.
 * Results are owner data; skill text and model catalogs are untrusted, never instructions. */
const ACTIONS = new Set([
  "models.list",
  "usage.sessions.read",
  "skills.search",
  "skills.read",
  "devices.list",
  "logs.monitors.list",
]);
export const isRoomAppRead = (action: string) => ACTIONS.has(action);

export type RoomAppReadPorts = {
  projects: Pick<ConversationProjectTools, "call">;
  devices: Pick<DeviceHost, "list">;
  monitors: Pick<RuntimeLogMonitors, "list">;
};

export async function callRoomAppRead(
  ports: RoomAppReadPorts,
  action: string,
  input: Record<string, unknown>,
  principal: AssistantThreadPrincipal,
  projectCwd: string,
  authorized: () => Promise<boolean>,
) {
  if (!ACTIONS.has(action) || principal.kind !== "assistant-thread" || !principal.projectId)
    throw new Error("Unsupported Room application read.");
  const check = async () => {
    if (!(await authorized())) throw new Error("Room read authority revoked.");
  };
  await check();
  const result = await (async () => {
    if (action === "models.list" || action === "usage.sessions.read")
      return ports.projects.call(action, input, principal, authorized);
    if (action === "skills.search")
      return searchHarnessSkills(projectCwd, input as { query?: string });
    if (action === "skills.read")
      return readHarnessSkill(projectCwd, {
        name: String(input.name),
        source: typeof input.source === "string" ? input.source : undefined,
        scope: typeof input.scope === "string" ? input.scope : undefined,
        offset: input.offset as number | undefined,
        maxChars: input.maxChars as number | undefined,
      });
    if (action === "devices.list") return listHostDevices(ports.devices, input, authorized);
    return pageConversationListResult(action, input, ports.monitors.list(principal.projectId));
  })();
  await check();
  return result;
}

/** Simulators and emulators on this Host; a connected machine needs a focused session. */
export async function listHostDevices(
  devices: Pick<DeviceHost, "list">,
  input: Record<string, unknown>,
  authorized: () => Promise<boolean>,
) {
  if (input.machineId !== undefined)
    throw new Error("A connected machine's devices need a real focused session.");
  return pageConversationListResult("devices.list", input, await devices.list({ authorized }));
}
