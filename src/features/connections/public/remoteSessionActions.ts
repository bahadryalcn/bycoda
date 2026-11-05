/** Public connections contract; exports stay explicit to preserve load isolation. */
export {
  captureRemoteSessionActions,
  remoteSessionActionsObservation,
  subscribeRemoteSessionActions,
} from "../model/remoteSessionActions";
export type { CapturedRemoteSessionActions } from "../model/remoteSessionActions";
