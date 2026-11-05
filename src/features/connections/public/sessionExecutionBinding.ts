/** Public connections contract; exports stay explicit to preserve load isolation. */
export {
  flushHostSessionBindings,
  forgetHostSessionShell,
  hasHostSessionOwnerFence,
  hostSessionBinding,
  hostSessionShellSummaries,
  patchHostSessionShellMetadata,
  restoreHostSessionShell,
  saveHostSessionBinding,
} from "../model/sessionExecutionBinding";
