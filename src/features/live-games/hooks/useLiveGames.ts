import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LiveGamesStatus } from "../../../shared/model/host-contracts/live-games";
import { liveGamesRequest } from "../model/liveGamesClient";

const statusKey = ["liveGames.status"];
const reportKey = ["liveGames.report"];

type LiveGamesAction =
  | "connect" | "disconnect" | "demo" | "config" | "rules" | "obs-setup"
  | "obs-scene" | "obs-start" | "obs-stop" | "obs-credentials" | "euler-key";
type Command = {
  action: LiveGamesAction;
  request: () => Promise<LiveGamesStatus>;
  applied?: (result: LiveGamesStatus) => void;
};

export function useLiveGames() {
  const cache = useQueryClient();
  const mutation = useMutation<LiveGamesStatus, Error, Command>({
    mutationFn: ({ request }) => request(),
    onMutate: () => cache.cancelQueries({ queryKey: statusKey }),
    onSuccess: (result, { applied }) => {
      cache.setQueryData(statusKey, result);
      applied?.(result);
    },
    onSettled: async () => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: statusKey }),
        cache.invalidateQueries({ queryKey: reportKey }),
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
  const selected = (action: LiveGamesAction) => mutation.variables?.action === action;
  const feedback = {
    busy: mutation.isPending,
    pending: (action: LiveGamesAction) => selected(action) && mutation.isPending,
    succeeded: (action: LiveGamesAction) => selected(action) && mutation.isSuccess,
    error: (...actions: LiveGamesAction[]) =>
      mutation.error && actions.some(selected) ? mutation.error.message : undefined,
    run: mutation.mutate,
    clear: () => {
      if (!mutation.isPending) mutation.reset();
    },
  };
  return { status, report, feedback };
}

export type LiveGamesFeedback = ReturnType<typeof useLiveGames>["feedback"];
