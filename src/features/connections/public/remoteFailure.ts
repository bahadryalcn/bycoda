/** Public connections contract; exports stay explicit to preserve load isolation. */
export {
  classifyRemoteError,
  describeLocalError,
  describeRemoteError,
  type RemoteErrorView,
  isConnectionFailure,
  isHostAuthorizationRefusal,
  isTransientTransportError,
  isUnsupportedRemoteRoute,
  isWorkspaceNotRegisteredRefusal,
  presentRemoteError,
} from "../model/remoteFailure";
