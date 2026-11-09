import { accountController } from "./accountService";

/**
 * The account service as the notification client needs it. Bind it once with
 * `bindNotificationsServer`; a failed call also reports to the account (revoked device,
 * expired session) before the caller sees the error.
 */
export function accountNotificationsPort() {
  const controller = accountController();
  const guarded = async <T>(call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (error) {
      await controller.handleFailure(error);
      throw error;
    }
  };
  return {
    getSettings: () => guarded(() => controller.api().getNotificationSettings()),
    putSettings: (
      body: Parameters<ReturnType<typeof controller.api>["putNotificationSettings"]>[0]["body"],
    ) => guarded(() => controller.api().putNotificationSettings({ body })),
    listFeed: (
      query: Parameters<ReturnType<typeof controller.api>["listNotifications"]>[0]["query"],
    ) => guarded(() => controller.api().listNotifications({ query })),
    markRead: async (ids: string[]) => {
      await guarded(() => controller.api().markNotificationsRead({ body: { ids } }));
    },
    reportEvent: async (
      body: Parameters<ReturnType<typeof controller.api>["reportNotificationEvent"]>[0]["body"],
    ) => {
      await guarded(() => controller.api().reportNotificationEvent({ body }));
    },
  };
}
