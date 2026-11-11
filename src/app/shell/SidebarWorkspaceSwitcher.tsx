import type { ComponentProps } from "react";
import { SidebarWorktreeSwitcher } from "../../features/source-control/ui/SidebarWorktreeSwitcher";
import { useSessionProjectAppearance } from "./useSessionProjectAppearance";

/** The working-copy switcher titled with the project's rail identity (icon and name). */
export function SidebarWorkspaceSwitcher(
  props: Omit<ComponentProps<typeof SidebarWorktreeSwitcher>, "projectLabel" | "projectIcon">,
) {
  const project = useSessionProjectAppearance(props.cwd);
  return (
    <SidebarWorktreeSwitcher {...props} projectLabel={project.name} projectIcon={project.icon} />
  );
}
