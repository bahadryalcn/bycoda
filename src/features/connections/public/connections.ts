/** Public connections contract; exports stay explicit to preserve load isolation. */
export { classifyCommandFailure } from "../model/remoteCommandRetry";
export {
  bindStoredAdoptedImageReaders,
  loadRemoteBlock,
  loadRemoteCapabilities,
  loadRemoteHistoryPage,
  loadRemoteSession,
  remoteMachineFor,
  remoteRequest,
  remoteSessionFor,
  sessionAccessForMachine,
  useRemoteMachines,
} from "../model/connections";
export { machineLabel } from "../model/machineIdentity";
export { machineSupportsLazyHistory } from "../model/remoteSessionSnapshotCache";
