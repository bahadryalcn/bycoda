import { parseHostGoal as parseLegacy } from "../../src/features/tasks/model/hostGoals";
import { routingInput } from "../tasks/model-routing";
export function parseHostGoal(raw: unknown) {
  return routingInput(parseLegacy, raw);
}
