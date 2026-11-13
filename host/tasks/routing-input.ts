import { parseHostTask as parseLegacy } from "../../src/features/tasks/model/hostTasks";
import { routingInput } from "../tasks/model-routing";
export function parseHostTask(raw: unknown) {
  return routingInput(parseLegacy, raw);
}
