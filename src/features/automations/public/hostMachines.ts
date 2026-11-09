/** Public host-machine contract; exports stay explicit to preserve load isolation. */
export {
  backgroundMachineFor,
  backgroundMachines,
  hostProjectCwd,
} from "../model/hostAutomationClient";
export { invalidateMachineSnapshot, machineProjects } from "../model/machineSnapshot";
