import { t, useLocale } from "../../../shared/i18n";
import { projectKey } from "../../../shared/lib/paths";
import { SplitButton } from "../../../shared/ui/SplitButton";
import { MessageSquarePlus } from "../../../shared/ui/icons";
import { projectDisplayName } from "../../projects/public/projectNames";
import { looksLikeProject, type RecentProject } from "../../projects/public/recents";

/** Adds context to a new draft; the destination never changes the note's project. */
export function NoteChatAction({
  projectCwd,
  recents,
  disabled,
  onAdd,
}: {
  projectCwd?: string;
  recents: RecentProject[];
  disabled?: boolean;
  onAdd: (targetCwd?: string) => void;
}) {
  useLocale();
  const projects = [...(projectCwd ? [projectCwd] : []), ...recents.map((item) => item.path)]
    .filter(looksLikeProject)
    .filter(
      (path, index, paths) =>
        paths.findIndex((other) => projectKey(other) === projectKey(path)) === index,
    );
  return (
    <SplitButton
      variant="ghost"
      size="sm"
      label={t("Add to chat")}
      menuLabel={t("Choose project")}
      startIcon={<MessageSquarePlus className="icon-sm" />}
      disabled={disabled}
      onClick={() => onAdd(projectCwd)}
      actions={projects.map((path) => ({
        id: path,
        label: projectDisplayName(path),
        description: path,
        onSelect: () => onAdd(path),
      }))}
    />
  );
}
