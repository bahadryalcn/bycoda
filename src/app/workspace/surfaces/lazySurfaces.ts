import { lazySurface } from "../../../shared/ui/lazySurface";

export const SearchView = lazySurface(
  async () => {
    const module = await import("../../../features/search/ui/SearchView");
    return { default: module.SearchView };
  },
  { suspense: false },
);
export const SettingsView = lazySurface(
  async () => {
    const module = await import("../../../features/settings/ui/SettingsView");
    return { default: module.SettingsView };
  },
  { suspense: false },
);
export const InboxView = lazySurface(
  async () => {
    const module = await import("../../../features/inbox/ui/InboxView");
    return { default: module.InboxView };
  },
  { suspense: false },
);
export const LinkedWorkItemPanel = lazySurface(async () => {
  const module = await import("../../../features/inbox/ui/InboxView");
  return { default: module.LinkedWorkItemPanel };
});
export const NotesView = lazySurface(
  async () => {
    const module = await import("../../../features/notes/ui/NotesView");
    return { default: module.NotesView };
  },
  { suspense: false },
);
export const AutomationsView = lazySurface(
  async () => {
    const module = await import("../../../features/automations/ui/AutomationsView");
    return { default: module.AutomationsView };
  },
  { suspense: false },
);
export const SocialView = lazySurface(async () => {
  const module = await import("../../../features/social/ui/SocialView");
  return { default: module.SocialView };
});
export const TasksView = lazySurface(
  async () => {
    const module = await import("../../../features/tasks/ui/TasksView");
    return { default: module.TasksView };
  },
  { suspense: false },
);
