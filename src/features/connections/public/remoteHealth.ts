/** Public connections contract; exports stay explicit to preserve load isolation. */
export {
  readRemoteConnection,
  reportRemoteConnection,
  reportRemoteLoad,
  subscribeChanges as subscribeRemoteConnections,
  subscribeRemoteRecovered,
  useRemoteLoadFailure,
} from "../model/remoteHealth";
/** Background polls also stop while the project's machine is unavailable. */
export { remotePollDue } from "../model/machineAvailability";
