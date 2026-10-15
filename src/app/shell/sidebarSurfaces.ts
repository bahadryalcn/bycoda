import { lazySurface } from "../../shared/ui/lazySurface";

export const SourceControl = lazySurface(async () => ({
  default: (await import("../../features/source-control/ui/SourceControl")).SourceControl,
}));
export const ProjectSearch = lazySurface(async () => ({
  default: (await import("../../features/projects/ui/ProjectSearch")).ProjectSearch,
}));
export const SearchableProjectPicker = lazySurface(async () => ({
  default: (await import("../../features/projects/ui/SearchableProjectPicker"))
    .SearchableProjectPicker,
}));
export const InboxNotificationMenu = lazySurface(async () => ({
  default: (await import("../../features/inbox/ui/InboxNotificationMenu")).InboxNotificationMenu,
}));

export function preloadSidebarSurfaces() {
  return Promise.all([
    SourceControl.preload(),
    ProjectSearch.preload(),
    SearchableProjectPicker.preload(),
    InboxNotificationMenu.preload(),
  ]);
}
