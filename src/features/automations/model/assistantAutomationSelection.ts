import type {AssistantAutomationReveal} from "../../assistant/model/assistantAutomationReveal";
import type {Automation} from "./automations";
/** A navigation request can reveal only a fresh canonical row from its exact Host. */
export function assistantAutomationSelection(target:AssistantAutomationReveal,rows:readonly Automation[],visible:(cwd:string)=>boolean):Automation|undefined {
  return rows.find(row=>row.id===target.id&&row.host?.machineId===target.machineId&&row.host.environmentId===target.environmentId&&row.host.projectId===target.projectId&&!row.host.stale&&visible(row.cwd));
}
