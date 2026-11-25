import { useMemo } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { t, useLocale } from "../../../shared/i18n";
import { projectKey } from "../../../shared/lib/paths";
import { Button } from "../../../shared/ui/Button";
import { SplitButton } from "../../../shared/ui/SplitButton";
import { MessageSquarePlus } from "../../../shared/ui/icons";
import { projectDisplayNameFrom, useProjectLabels } from "../../projects/public/projectNames";
import { looksLikeProject, type RecentProject } from "../../projects/public/recents";

/** Adds context to a new draft; the destination never changes the note's project. */
export function NoteChatAction({
  projectCwd,
  recents,
  disabled,
  disabledReason,
  onAdd,
}: {
  projectCwd?: string;
  recents: RecentProject[];
  disabled?: boolean;
  disabledReason?: string;
  onAdd: (targetCwd?: string) => void;
}) {
  useLocale();
  const labels = useProjectLabels();
  const add = useStableCallback(onAdd);
  const actions = useMemo(() => {
    const seen = new Set<string>();
    return [...(projectCwd ? [projectCwd] : []), ...recents.map((item) => item.path)]
      .filter((path) => {
        if (!looksLikeProject(path)) return false;
        const key = projectKey(path);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((path) => ({
        id: path,
        label: projectDisplayNameFrom(path, labels),
        description: path,
        onSelect: () => add(path),
      }));
  }, [projectCwd, recents, labels, add]);
  // One possible destination needs no picker.
  if (actions.length < 2)
    return (
      <Button
        variant="ghost"
        size="sm"
        startIcon={<MessageSquarePlus className="icon-sm" />}
        disabled={disabled}
        disabledReason={disabledReason}
        onClick={() => onAdd(projectCwd)}
      >
        {t("Add to chat")}
      </Button>
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
      actions={actions}
    />
  );
}
