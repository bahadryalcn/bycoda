import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  LiveStreamLiveStatus,
  LiveStreamStatus,
} from "../../../shared/model/host-contracts/live-stream";
import { liveStreamRequest } from "../model/liveStreamClient";

const statusKey = ["liveStream.status"];
const reportKey = ["liveStream.report"];
const liveStatusKey = ["liveStream.live.status"];
const liveAccountsKey = ["liveStream.live.accounts"];

type LiveStreamAction =
  | "connect"
  | "disconnect"
  | "demo"
  | "obs-setup"
  | "obs-start"
  | "obs-stop"
  | "obs-credentials"
  | "euler-key";
type LiveStreamCommand = {
  action: LiveStreamAction;
  request: () => Promise<LiveStreamStatus>;
  applied?: (result: LiveStreamStatus) => void;
};
type LiveCommand = {
  action: "live-start" | "live-stop";
  requestLive: () => Promise<LiveStreamLiveStatus>;
};
type Command = LiveStreamCommand | LiveCommand;

export function useLiveStream() {
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
    queryFn: () => liveStreamRequest("liveStream.status", {}),
    refetchInterval: mutation.isPending ? false : 1_500,
    refetchOnWindowFocus: !mutation.isPending,
    retry: false,
  });
  const report = useQuery({
    queryKey: reportKey,
    queryFn: () => liveStreamRequest("liveStream.report", {}),
    enabled: !!status.data,
    refetchInterval: mutation.isPending ? false : 6_000,
    retry: false,
  });
  const live = useQuery({
    queryKey: liveStatusKey,
    queryFn: () => liveStreamRequest("liveStream.live.status", {}),
    refetchInterval: mutation.isPending ? false : 1_500,
    refetchOnWindowFocus: !mutation.isPending,
    retry: false,
  });
  const accounts = useQuery({
    queryKey: liveAccountsKey,
    queryFn: () => liveStreamRequest("liveStream.live.accounts", {}),
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

export type LiveStreamFeedback = ReturnType<typeof useLiveStream>["feedback"];
export type LiveStreamLiveQuery = ReturnType<typeof useLiveStream>["live"];
export type LiveStreamAccountsQuery = ReturnType<typeof useLiveStream>["accounts"];
