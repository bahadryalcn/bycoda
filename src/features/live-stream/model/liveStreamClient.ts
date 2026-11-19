import type { z } from "zod";
import { LIVE_STREAM_RPC } from "../../../shared/model/host-contracts/live-stream";
import { hostToolRequest } from "../../connections/public/hostFeatureClient";

type LiveStreamMethod = keyof typeof LIVE_STREAM_RPC;
export type LiveStreamParams<M extends LiveStreamMethod> = z.input<
  (typeof LIVE_STREAM_RPC)[M]["params"]
>;
type LiveStreamResult<M extends LiveStreamMethod> = z.output<(typeof LIVE_STREAM_RPC)[M]["result"]>;

/** The broadcast and OBS belong to this computer, independent of the open project. */
export function liveStreamRequest<M extends LiveStreamMethod>(
  method: M,
  params: LiveStreamParams<M>,
) {
  return hostToolRequest<LiveStreamResult<M>>("", "liveStream.v1", method, params, {
    kind: "local",
  });
}
