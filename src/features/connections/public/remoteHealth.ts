/** Public connections contract; exports stay explicit to preserve load isolation. */
export {
  remotePollDue,
  reportRemoteConnection,
  reportRemoteLoad,
  useRemoteLoadFailure,
} from "../model/remoteHealth";
