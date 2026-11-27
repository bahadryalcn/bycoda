/** Public connections contract; exports stay explicit to preserve load isolation. */
export {
  machineHidesView,
  readMachineAvailability,
  subscribeAvailability,
  useMachineAvailability,
  type MachineAvailability,
  type MachineUnavailableReason,
} from "../model/machineAvailability";
