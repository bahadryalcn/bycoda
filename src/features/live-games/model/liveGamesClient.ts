import type { z } from "zod";
import { LIVE_GAMES_RPC } from "../../../shared/model/host-contracts/live-games";
import { hostToolRequest } from "../../connections/public/hostFeatureClient";

type LiveGamesMethod = keyof typeof LIVE_GAMES_RPC;
export type LiveGamesParams<M extends LiveGamesMethod> = z.input<
  (typeof LIVE_GAMES_RPC)[M]["params"]
>;
type LiveGamesResult<M extends LiveGamesMethod> = z.output<(typeof LIVE_GAMES_RPC)[M]["result"]>;

/** The broadcast and OBS belong to this computer, independent of the open project. */
export function liveGamesRequest<M extends LiveGamesMethod>(method: M, params: LiveGamesParams<M>) {
  return hostToolRequest<LiveGamesResult<M>>("", "liveGames.v1", method, params, { kind: "local" });
}
