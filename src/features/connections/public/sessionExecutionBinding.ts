/** Public connections contract; exports stay explicit to preserve load isolation. */
export {
  flushHostSessionBindings,
  forgetHostSessionShell,
  hasHostSessionOwnerFence,
  hydrateHostSessionBindings,
  hostSessionBinding,
  hostSessionShellSummaries,
  patchHostSessionShellMetadata,
  restoreHostSessionShell,
  saveHostSessionBinding,
} from "../model/sessionExecutionBinding";
