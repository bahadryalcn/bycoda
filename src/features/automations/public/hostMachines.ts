/** Public host-machine contract; exports stay explicit to preserve load isolation. */
export {
  backgroundMachineFor,
  backgroundMachines,
  hostProjectCwd,
} from "../model/hostAutomationClient";
export {
  invalidateMachineSnapshot,
  machineCapabilities,
  machineProjects,
} from "../model/machineSnapshot";
