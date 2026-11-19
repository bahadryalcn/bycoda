import {
  LIVE_STREAM_RPC,
  LiveStreamEulerKeyParamsSchema,
  LiveStreamObsCredentialsParamsSchema,
  LiveStreamObsStreamParamsSchema,
  LiveStreamStartParamsSchema,
  parseLiveStreamLiveStart,
} from "../../src/shared/model/host-contracts/live-stream";
import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";

function assertLocalSecret(request: OwnerRpcRequest) {
  const { socket, headers } = request.request;
  if (
    headers.origin ||
    headers.forwarded ||
    headers["x-forwarded-for"] ||
    !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(socket.remoteAddress ?? "")
  )
    throw new Error("Live streaming credentials can only be changed locally.");
}

export async function handleLiveStreamRpc(
  { liveStream }: Pick<ServerBindings, "liveStream">,
  request: OwnerRpcRequest,
) {
  const { method } = request.input;
  const { params } = request;
  switch (method) {
    case "liveStream.live.accounts":
      LIVE_STREAM_RPC[method].params.parse(params);
      request.result = await liveStream.liveAccounts();
      return;
    case "liveStream.live.status":
      LIVE_STREAM_RPC[method].params.parse(params);
      request.result = await liveStream.liveStatus();
      return;
    case "liveStream.live.start": {
      assertLocalSecret(request);
      const start = parseLiveStreamLiveStart(params);
      request.result = await liveStream.liveStart(
        { ...start, scene: await liveStream.liveScene(start.scene) },
        undefined,
        async () =>
          !request.closing && !request.response.destroyed && request.domainContext.authorized(),
      );
      return;
    }
    case "liveStream.live.stop": {
      assertLocalSecret(request);
      const { platformEnded } = LIVE_STREAM_RPC[method].params.parse(params);
      request.result = await liveStream.liveStop(
        undefined,
        () => request.domainContext.authorized(),
        platformEnded,
      );
      return;
    }
    case "liveStream.status":
      LIVE_STREAM_RPC[method].params.parse(params);
      request.result = await liveStream.status();
      return;
    case "liveStream.start":
      request.result = await liveStream.start(LiveStreamStartParamsSchema.parse(params).channel);
      return;
    case "liveStream.stop":
      LIVE_STREAM_RPC[method].params.parse(params);
      request.result = await liveStream.stop();
      return;
    case "liveStream.demo":
      LIVE_STREAM_RPC[method].params.parse(params);
      request.result = await liveStream.demo();
      return;
    case "liveStream.report":
      LIVE_STREAM_RPC[method].params.parse(params);
      request.result = await liveStream.report();
      return;
    case "liveStream.obsSetup":
      LIVE_STREAM_RPC[method].params.parse(params);
      request.result = await liveStream.obsSetup();
      return;
    case "liveStream.obsStream":
      request.result = await liveStream.obsStream(
        LiveStreamObsStreamParamsSchema.parse(params).action,
      );
      return;
    case "liveStream.obsCredentials": {
      assertLocalSecret(request);
      const { server, key } = LiveStreamObsCredentialsParamsSchema.parse(params);
      request.result = await liveStream.obsCredentials(server, key);
      return;
    }
    case "liveStream.eulerKey":
      assertLocalSecret(request);
      request.result = await liveStream.eulerKey(LiveStreamEulerKeyParamsSchema.parse(params).key);
      return;
  }
  throw new Error("Unknown Live streaming operation.");
}
