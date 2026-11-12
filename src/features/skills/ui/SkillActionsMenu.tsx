import type { DiscoveredSkill } from "../../../platform/tauri/fs";
import type { SkillMachine } from "../model/skillLibrary";
import { t, useLocale } from "../../../shared/i18n";
import { ContextMenu } from "../../../shared/ui/ContextMenu";
import { Copy, Eye, EyeOff, FolderOpen, Trash2 } from "../../../shared/ui/icons";
import { canDeleteSkill } from "../model/deleteSkill";
import { useSkillGroups, addSkillsToGroup, removeSkillFromGroup } from "../index";
import type { GroupEdit } from "./SkillGroupDialogs";

export type SkillActionsTarget = {
  skill: DiscoveredSkill;
  machine: SkillMachine | null;
  anchor: HTMLElement;
  groupId?: string;
};
export function SkillActionsMenu({
  target,
  policyAvailable,
  off,
  policySaving,
  deleteBlocked,
  onClose,
  onToggle,
  onCopyPath,
  onReveal,
  onDelete,
  onEdit,
  onError,
}: {
  target: SkillActionsTarget;
  policyAvailable: boolean;
  off: boolean;
  policySaving: boolean;
  deleteBlocked: boolean;
  onClose: () => void;
  onToggle: (
    skill: DiscoveredSkill,
    enabled: boolean,
    machine: SkillMachine | null,
  ) => Promise<void>;
  onCopyPath: (path: string) => void;
  onReveal: (path: string) => void;
  onDelete: (skill: DiscoveredSkill, machine: SkillMachine | null) => Promise<void>;
  onEdit: (edit: GroupEdit) => void;
  onError: (message: string | null) => void;
}) {
  useLocale();
  const groups = useSkillGroups();
  const { skill, machine, groupId } = target;
  return (
    <ContextMenu
      anchor={target.anchor}
      ariaLabel={t("Actions for {p0}", { p0: skill.name })}
      align="end"
      onClose={onClose}
      onPick={(id) => {
        if (id === "new-group") onEdit({ kind: "create", skillNames: [skill.name] });
        else if (id === "remove-group" && groupId) {
          try {
            removeSkillFromGroup(groupId, skill.name);
            onError(null);
          } catch (cause) {
            onError(String(cause));
          }
        } else if (id.startsWith("group:")) {
          try {
            addSkillsToGroup(id.slice(6), [skill.name]);
            onError(null);
          } catch (cause) {
            onError(String(cause));
          }
        } else if (id === "enable" || id === "disable")
          void onToggle(skill, id === "enable", machine);
        else if (id === "copy") onCopyPath(skill.path);
        else if (id === "reveal") onReveal(skill.path);
        else if (id === "delete") void onDelete(skill, machine);
      }}
      items={[
        { kind: "item", id: "new-group", label: t("New group with this skill…") },
        {
          kind: "item",
          id: "add-group",
          label: t("Add to group"),
          disabled: !groups.length,
          submenu: groups.map((group) => ({
            kind: "item" as const,
            id: `group:${group.id}`,
            label: group.name,
            checked: group.skillNames.includes(skill.name),
          })),
        },
        ...(groupId
          ? [
              {
                kind: "item" as const,
                id: "remove-group",
                label: t("Remove from {p0}", {
                  p0: groups.find((group) => group.id === groupId)?.name ?? "",
                }),
              },
            ]
          : []),
        { kind: "sep" },
        ...(policyAvailable
          ? [
              {
                kind: "item" as const,
                id: off ? "enable" : "disable",
                label: off
                  ? t("Enable {p0}", { p0: skill.name })
                  : t("Disable {p0}", { p0: skill.name }),
                disabled: policySaving,
                icon: off ? <Eye className="icon-sm" /> : <EyeOff className="icon-sm" />,
              },
            ]
          : []),
        {
          kind: "item",
          id: "copy",
          label: t("Copy path of {p0}", { p0: skill.name }),
          icon: <Copy className="icon-sm" />,
        },
        ...(!machine
          ? [
              {
                kind: "item" as const,
                id: "reveal",
                label: t("Reveal {p0} in file explorer", { p0: skill.name }),
                icon: <FolderOpen className="icon-sm" />,
              },
            ]
          : []),
        ...(canDeleteSkill(skill)
          ? [
              {
                kind: "item" as const,
                id: "delete",
                label: t("Delete {p0}", { p0: skill.name }),
                title: t("Delete skill permanently"),
                danger: true,
                disabled: deleteBlocked,
                icon: <Trash2 className="icon-sm" />,
              },
            ]
          : []),
      ]}
    />
  );
}
