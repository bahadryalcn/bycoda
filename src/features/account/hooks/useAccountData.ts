import {
  type ActivitySummary,
  type DataExport,
  type DataSummary,
  type Device,
  type NotificationSettings,
  type ProfileUpdate,
  type User,
} from "@bycoda/account-contracts";
import {
  useInfiniteQuery,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { localDateFor } from "@bycoda/account-contracts";
import { dateTimeFormat } from "../../../shared/lib/intl";
import { accountController } from "../model/accountService";
import { isSignedIn } from "../model/accountState";
import { useAccountState } from "./useAccount";

/** Runs an API call and routes revoked-device, expired-session and offline failures to the controller. */
async function guarded<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    await accountController().handleFailure(error);
    throw error;
  }
}

/** The IANA zone of this computer. */
export function localTimeZone(): string {
  return dateTimeFormat().resolvedOptions().timeZone;
}

function useAccountScope() {
  const state = useAccountState();
  return {
    userId: isSignedIn(state) ? state.context.user.id : null,
    deviceId: isSignedIn(state) ? state.deviceId : null,
  };
}

export function useDevices() {
  const { userId } = useAccountScope();
  const queryClient = useQueryClient();
  const key = ["account", userId, "devices"] as const;
  const query = useQuery({
    queryKey: key,
    enabled: userId !== null,
    queryFn: () =>
      guarded(() => accountController().api().listDevices()).then((list) => list.items),
  });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      guarded(() => accountController().api().renameDevice({ params: { id }, body: { name } })),
    onSuccess: (device: Device) =>
      queryClient.setQueryData<Device[]>(key, (items) =>
        items?.map((item) => (item.id === device.id ? { ...item, ...device } : item)),
      ),
  });
  const revoke = useMutation({
    mutationFn: (id: string) =>
      guarded(() => accountController().api().revokeDevice({ params: { id } })),
    onSuccess: (_, id) =>
      queryClient.setQueryData<Device[]>(key, (items) => items?.filter((item) => item.id !== id)),
  });
  const revokeOthers = useMutation({
    mutationFn: () => guarded(() => accountController().api().revokeOtherDevices()),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  return { query, rename, revoke, revokeOthers };
}

export function useActivitySummary() {
  const { userId } = useAccountScope();
  return useQuery<ActivitySummary>({
    queryKey: ["account", userId, "activity"],
    enabled: userId !== null,
    queryFn: () =>
      guarded(() =>
        accountController()
          .api()
          .getActivitySummary({
            query: { timeZone: localTimeZone(), date: localDateFor(new Date(), localTimeZone()) },
          }),
      ),
  });
}

export function useNotificationSettings() {
  const { userId } = useAccountScope();
  const queryClient = useQueryClient();
  const key = ["account", userId, "notifications"] as const;
  const query = useQuery({
    queryKey: key,
    enabled: userId !== null,
    queryFn: () => guarded(() => accountController().api().getNotificationSettings()),
  });
  const mutationKey = ["account", userId, "notifications", "save"] as const;
  const pending = useIsMutating({ mutationKey }) > 0;
  // Saves run one after another; only the newest one may write its outcome to the cache.
  const newerPending = () => queryClient.isMutating({ mutationKey }) > 1;
  const mutation = useMutation({
    mutationKey,
    scope: { id: `account-notifications-${userId}` },
    mutationFn: ({ next }: { next: NotificationSettings; previous?: NotificationSettings }) =>
      guarded(() => accountController().api().putNotificationSettings({ body: next })),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: key });
    },
    onError: (_error, { previous }) => {
      if (newerPending()) return;
      if (previous) queryClient.setQueryData(key, previous);
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onSuccess: (saved) => {
      if (!newerPending()) queryClient.setQueryData(key, saved);
    },
  });
  // The switch moves at once from the latest cached value; a failed save puts the saved value back.
  const mutate = (update: (current: NotificationSettings) => NotificationSettings) => {
    const previous = queryClient.getQueryData<NotificationSettings>(key);
    if (!previous) return;
    const next = update(previous);
    queryClient.setQueryData(key, next);
    mutation.mutate({ next, previous });
  };
  return { query, save: { isError: mutation.isError, isPending: pending, mutate } };
}

export function useProfileUpdate() {
  return useMutation({
    mutationFn: (body: ProfileUpdate): Promise<User> =>
      guarded(() => accountController().api().updateProfile({ body })),
    onSuccess: () => accountController().refresh(),
  });
}

export function useDataSummary() {
  const { userId } = useAccountScope();
  return useQuery<DataSummary>({
    queryKey: ["account", userId, "data-summary"],
    enabled: userId !== null,
    queryFn: () => guarded(() => accountController().api().getDataSummary()),
  });
}

/** The user's own sign-ins and account events of the last 90 days, newest first, paged. */
export function useSecurityActivity() {
  const { userId } = useAccountScope();
  return useInfiniteQuery({
    queryKey: ["account", userId, "security-activity"],
    enabled: userId !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      guarded(() =>
        accountController()
          .api()
          .getSecurityActivity({ query: pageParam ? { cursor: pageParam } : {} }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

/** Saves a finished export through the webview's download, named after its date. */
async function saveExport(item: DataExport): Promise<void> {
  const blob = await guarded(() => accountController().api().downloadExport(item.id));
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `bycoda-account-${(item.readyAt ?? item.requestedAt).slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The data export of this session: request, follow until ready, save. The id lives in the query
 * cache only. // shortcut: a reload forgets a pending export, the server keeps it; add a
 * "list exports" route when users ask for older ones.
 */
export function useDataExport() {
  const { userId } = useAccountScope();
  const queryClient = useQueryClient();
  const key = ["account", userId, "export"] as const;
  const current = useQuery<DataExport | null>({
    queryKey: key,
    // Only written by the request and the follow-up below; never fetched on its own.
    queryFn: () => queryClient.getQueryData<DataExport | null>(key) ?? null,
    staleTime: Infinity,
    initialData: null,
  });
  const id = current.data?.id ?? null;
  const follow = useQuery({
    queryKey: [...key, id],
    enabled: id !== null && current.data?.status === "pending",
    refetchInterval: 3000,
    queryFn: async () => {
      const next = await guarded(() =>
        accountController()
          .api()
          .getExport({ params: { id: id! } }),
      );
      queryClient.setQueryData(key, next);
      return next;
    },
  });
  const request = useMutation({
    mutationFn: () =>
      guarded(() =>
        accountController()
          .api()
          .requestExport({ body: { format: "json" } }),
      ),
    onSuccess: (next) => queryClient.setQueryData(key, next),
  });
  const save = useMutation({ mutationFn: saveExport });
  return { current: current.data, follow, request, save };
}

/** Schedules or cancels the deletion of the account; the account view refreshes afterwards. */
export function useDeletion() {
  const schedule = useMutation({
    mutationFn: (reason?: string) =>
      guarded(() =>
        accountController()
          .api()
          .requestDeletion({ body: reason ? { reason } : {} }),
      ),
    onSuccess: () => accountController().refresh(),
  });
  const cancel = useMutation({
    mutationFn: () => guarded(() => accountController().api().cancelDeletion()),
    onSuccess: () => accountController().refresh(),
  });
  return { schedule, cancel };
}
