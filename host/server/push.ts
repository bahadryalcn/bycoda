import type { HostSessionSummary } from "../../src/features/connections/model/protocol";
import { PushNotifications } from "../push/push-service";
import { PushDeviceStore } from "../push/push-store";
import type { ServerBindings } from "./bindings";

export function createPushRuntime(
  dependencies: Pick<ServerBindings, "engine" | "projectSessionList">,
) {
  const store = new PushDeviceStore(dependencies.engine.store.db);
  // Lazy DDL on the first push read would count as a data mutation in the middle of a read-only call.
  store.prepare().catch((error) => console.error("Push device table is unavailable:", error));
  const pushNotifications = new PushNotifications({
    store,
    environmentId: dependencies.engine.store.environmentId,
    sessions: async () => {
      const projects = await dependencies.engine.store.projects();
      // Bounded fan-out, as in `inbox.list`: each list may read desktop state.
      const lists: HostSessionSummary[][] = [];
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, projects.length) }, async () => {
          for (;;) {
            const index = next++;
            if (index >= projects.length) return;
            lists[index] = (await dependencies.projectSessionList(projects[index].id)).list;
          }
        }),
      );
      return lists.flat();
    },
  });
  pushNotifications.start();
  return { pushDevices: store, pushNotifications };
}
