/** Public connections contract; exports stay explicit to preserve load isolation. */
export {
  takeOverSharedLocalQueue,
  useLocalSharedQueueClient,
  useSharedQueueLeaseHeld,
} from "../model/useSharedLocalQueues";
