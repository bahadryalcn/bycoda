/** Public connections contract; exports stay explicit to preserve load isolation. */
export { classifyCommandFailure } from "../model/remoteCommandRetry";
export {
  loadRemoteBlock,
  loadRemoteHistoryPage,
  loadRemoteSession,
  remoteMachineFor,
  remoteRequest,
  remoteSessionFor,
  sessionAccessForMachine,
  useRemoteMachines,
} from "../model/connections";
