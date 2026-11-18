import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  LiveGamesLiveStatus,
  LiveGamesStatus,
} from "../../../shared/model/host-contracts/live-games";
import { liveGamesRequest } from "../model/liveGamesClient";

const statusKey = ["liveGames.status"];
const reportKey = ["liveGames.report"];
const liveStatusKey = ["liveGames.live.status"];
const liveAccountsKey = ["liveGames.live.accounts"];

type LiveGamesAction =
  | "connect"
  | "disconnect"
  | "demo"
  | "config"
  | "rules"
  | "obs-setup"
  | "obs-scene"
  | "obs-start"
  | "obs-stop"
  | "obs-credentials"
  | "euler-key";
type GameCommand = {
  action: LiveGamesAction;
  request: () => Promise<LiveGamesStatus>;
  applied?: (result: LiveGamesStatus) => void;
};
type LiveCommand = {
  action: "live-start" | "live-stop";
  requestLive: () => Promise<LiveGamesLiveStatus>;
};
type Command = GameCommand | LiveCommand;

export function useLiveGames() {
  const cache = useQueryClient();
  const mutation = useMutation<void, Error, Command>({
    retry: false,
    mutationFn: async (command) => {
      if ("requestLive" in command) {
        cache.setQueryData(liveStatusKey, await command.requestLive());
      } else {
        const { request, applied } = command;
        const result = await request();
        cache.setQueryData(statusKey, result);
        applied?.(result);
      }
    },
    onMutate: async () => {
      await Promise.all([
        cache.cancelQueries({ queryKey: statusKey }),
        cache.cancelQueries({ queryKey: liveStatusKey }),
      ]);
    },
    onSettled: async () => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: statusKey }),
        cache.invalidateQueries({ queryKey: reportKey }),
        cache.invalidateQueries({ queryKey: liveStatusKey }),
      ]);
    },
  });
  const status = useQuery({
    queryKey: statusKey,
    queryFn: () => liveGamesRequest("liveGames.status", {}),
    refetchInterval: mutation.isPending ? false : 1_500,
    refetchOnWindowFocus: !mutation.isPending,
    retry: false,
  });
  const report = useQuery({
    queryKey: reportKey,
    queryFn: () => liveGamesRequest("liveGames.report", {}),
    enabled: !!status.data,
    refetchInterval: mutation.isPending ? false : 6_000,
    retry: false,
  });
  const live = useQuery({
    queryKey: liveStatusKey,
    queryFn: () => liveGamesRequest("liveGames.live.status", {}),
    refetchInterval: mutation.isPending ? false : 1_500,
    refetchOnWindowFocus: !mutation.isPending,
    retry: false,
  });
  const accounts = useQuery({
    queryKey: liveAccountsKey,
    queryFn: () => liveGamesRequest("liveGames.live.accounts", {}),
    refetchInterval: 30_000,
    retry: false,
  });
  const selected = (action: Command["action"]) => mutation.variables?.action === action;
  const feedback = {
    busy: mutation.isPending,
    pending: (action: Command["action"]) => selected(action) && mutation.isPending,
    succeeded: (action: Command["action"]) => selected(action) && mutation.isSuccess,
    error: (...actions: Command["action"][]) =>
      mutation.error && actions.some(selected) ? mutation.error.message : undefined,
    run: mutation.mutate,
    clear: () => {
      if (!mutation.isPending) mutation.reset();
    },
  };
  return { status, report, live, accounts, feedback };
}

export type LiveGamesFeedback = ReturnType<typeof useLiveGames>["feedback"];
export type LiveGamesLiveQuery = ReturnType<typeof useLiveGames>["live"];
export type LiveGamesAccountsQuery = ReturnType<typeof useLiveGames>["accounts"];
