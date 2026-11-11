import { useSyncExternalStore } from "react";
import {
  knownNotificationProjectSelectionFrom,
  notificationProjectsViewSnapshot,
  subscribeNotificationProjects,
} from "../model/notificationProjects";

/** Project paths are already the notification identity; no discovery is needed. */
export function useNotificationProjects(paths: readonly string[]) {
  const { catalog, labels } = useSyncExternalStore(
    subscribeNotificationProjects,
    notificationProjectsViewSnapshot,
    notificationProjectsViewSnapshot,
  );
  const selection = knownNotificationProjectSelectionFrom(paths, catalog, labels);
  return {
    projects: selection.projects,
  };
}
