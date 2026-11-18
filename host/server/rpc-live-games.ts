import {
  LIVE_GAMES_RPC, LiveGamesConfigParamsSchema, LiveGamesEulerKeyParamsSchema,
  LiveGamesObsCredentialsParamsSchema, LiveGamesObsSetupParamsSchema, LiveGamesObsStreamParamsSchema,
  LiveGamesRulesParamsSchema, LiveGamesStartParamsSchema,
} from "../../src/shared/model/host-contracts/live-games";
import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";

function assertLocalSecret(request: OwnerRpcRequest) {
  const { socket, headers } = request.request;
  if (headers.origin || headers.forwarded || headers["x-forwarded-for"] ||
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(socket.remoteAddress ?? ""))
    throw new Error("Live games credentials can only be changed locally.");
}

export async function handleLiveGamesRpc(
  { liveGames }: Pick<ServerBindings, "liveGames">, request: OwnerRpcRequest,
) {
  const { method } = request.input;
  const { params } = request;
  switch (method) {
    case "liveGames.status":
      LIVE_GAMES_RPC[method].params.parse(params);
      request.result = await liveGames.status();
      return;
    case "liveGames.start":
      request.result = await liveGames.start(LiveGamesStartParamsSchema.parse(params).channel);
      return;
    case "liveGames.stop":
      LIVE_GAMES_RPC[method].params.parse(params);
      request.result = await liveGames.stop();
      return;
    case "liveGames.demo":
      LIVE_GAMES_RPC[method].params.parse(params);
      request.result = await liveGames.demo();
      return;
    case "liveGames.setRules":
      request.result = await liveGames.setRules(LiveGamesRulesParamsSchema.parse(params).rules);
      return;
    case "liveGames.setConfig":
      request.result = await liveGames.setConfig(LiveGamesConfigParamsSchema.parse(params).patch);
      return;
    case "liveGames.report":
      LIVE_GAMES_RPC[method].params.parse(params);
      request.result = await liveGames.report();
      return;
    case "liveGames.obsSetup":
      request.result = await liveGames.obsSetup(LiveGamesObsSetupParamsSchema.parse(params));
      return;
    case "liveGames.obsStream":
      request.result = await liveGames.obsStream(LiveGamesObsStreamParamsSchema.parse(params).action);
      return;
    case "liveGames.obsScene":
      LIVE_GAMES_RPC[method].params.parse(params);
      request.result = await liveGames.obsScene();
      return;
    case "liveGames.obsCredentials": {
      assertLocalSecret(request);
      const { server, key } = LiveGamesObsCredentialsParamsSchema.parse(params);
      request.result = await liveGames.obsCredentials(server, key);
      return;
    }
    case "liveGames.eulerKey":
      assertLocalSecret(request);
      request.result = await liveGames.eulerKey(LiveGamesEulerKeyParamsSchema.parse(params).key);
      return;
  }
  throw new Error("Unknown Live games operation.");
}
