/** Public connections contract; exports stay explicit to preserve load isolation. */
export { REMOTE_PROVIDERS, isRemoteProvider } from "../model/protocol";
export type {
  HostCommand,
  HostModelCatalog,
  HostDirectory,
  HostProject,
  RemoteMachine,
  RemoteProvider,
} from "../model/protocol";
