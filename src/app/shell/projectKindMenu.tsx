import { t } from "../../shared/i18n";
import { Briefcase } from "../../shared/ui/icons";
import type { ModelRoutingScope } from "../../shared/model/host-contracts/model-routing";
import { inheritedProjectKind, projectKind, setProjectKind } from "../../features/projects/model/projectKinds";
import { updateProjectGroup, type ProjectGroup } from "../../features/projects/model/projectGroups";
import type { TabGroupMenuExtraItem } from "../../features/workspace/ui/TabGroupMenu";

const GROUP_PREFIX = "group-kind:";
const PROJECT_PREFIX = "project-kind:";

const kindLabel = (kind: ModelRoutingScope) => (kind === "work" ? t("Work") : t("Personal"));

function tagSubmenu(
  prefix: string,
  current: ModelRoutingScope | undefined,
  noTagDescription?: string,
): TabGroupMenuExtraItem {
  const item = (kind: ModelRoutingScope | "none") => ({
    kind: "item" as const,
    id: `${prefix}${kind}`,
    label: kind === "none" ? t("No tag") : kindLabel(kind),
    description: kind === "none" ? noTagDescription : undefined,
    checked: (current ?? "none") === kind,
  });
  return {
    id: `${prefix}tag`,
    label: t("Tag"),
    icon: Briefcase,
    submenu: [item("personal"), item("work"), item("none")],
  };
}

/** The group menu's Personal / Work tag, which its projects inherit. */
export function groupKindItem(group: ProjectGroup): TabGroupMenuExtraItem {
  return tagSubmenu(GROUP_PREFIX, group.kind);
}

/** The project menu's tag; "No tag" says which group tag the project falls back to. */
export function projectKindItem(path: string): TabGroupMenuExtraItem {
  const inherited = inheritedProjectKind(path);
  return tagSubmenu(
    PROJECT_PREFIX,
    projectKind(path),
    inherited ? t("From group: {p0}", { p0: kindLabel(inherited) }) : undefined,
  );
}

function parseKind(rest: string): ModelRoutingScope | undefined | null {
  return rest === "personal" || rest === "work" ? rest : rest === "none" ? undefined : null;
}

/** Handles a tag pick; returns false when the action is not a tag action. */
export function pickKindAction(action: string, target: { group?: string; path?: string }): boolean {
  const scope = action.startsWith(GROUP_PREFIX) ? GROUP_PREFIX : PROJECT_PREFIX;
  if (!action.startsWith(scope)) return false;
  const kind = parseKind(action.slice(scope.length));
  if (kind === null) return false;
  if (scope === GROUP_PREFIX && target.group)
    updateProjectGroup(target.group, (group) => ({ ...group, kind }));
  else if (target.path) setProjectKind(target.path, kind);
  return true;
}
