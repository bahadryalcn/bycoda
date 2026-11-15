/** Public connections contract; exports stay explicit to preserve load isolation. */
export {
  classifyRemoteError,
  isConnectionFailure,
  isTransientTransportError,
  presentRemoteError,
} from "../model/remoteFailure";
