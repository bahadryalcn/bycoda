import { lazySurface } from "../../../shared/ui/lazySurface";
import type { WorkspaceToolId } from "../../model/toolWindows";
import type { ServersViewProps } from "../../../features/connections/ui/ServersView";

export const ServersView = lazySurface<ServersViewProps>(
  async () => {
    const module = await import("../../../features/connections/ui/ServersWorkspaceView");
    return { default: module.ServersWorkspaceView };
  },
  { suspense: false },
);
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

/** Warm a destination on pointer or keyboard intent; failures retry on open. */
export function preloadToolSurface(tool: WorkspaceToolId): void {
  const surface = {
    servers: ServersView,
    social: SocialView,
    tasks: TasksView,
    automations: AutomationsView,
    inbox: InboxView,
    notes: NotesView,
    terminal: null,
    "conversation-tools": null,
  }[tool];
  void surface?.preload().catch(() => undefined);
}
