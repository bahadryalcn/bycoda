import type { Automation } from "./automations";

/** Stable identity of an automation across local and machine-host sources. */
export function automationKey(automation: Pick<Automation, "id" | "host">): string {
  return JSON.stringify([automation.host?.machineId ?? null, automation.id]);
}
