import {
  type ActivitySummary,
  type DataSummary,
  type Device,
  type NotificationSettings,
  type ProfileUpdate,
  type User,
} from "@bycoda/account-contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  const save = useMutation({
    mutationFn: (settings: NotificationSettings) =>
      guarded(() => accountController().api().putNotificationSettings({ body: settings })),
    // The switch moves at once; a failed save puts the saved value back.
    onMutate: async (settings) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<NotificationSettings>(key);
      queryClient.setQueryData(key, settings);
      return { previous };
    },
    onError: (_error, _settings, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSuccess: (saved) => queryClient.setQueryData(key, saved),
  });
  return { query, save };
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
