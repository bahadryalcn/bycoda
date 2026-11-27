import { t } from "../../../shared/i18n";
import type { DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { Bot, Copy, Globe, Pencil, Trash2 } from "../../../shared/ui/icons";
import type { CrewDefinition } from "../model/crew";
import type { CrewRunView } from "../model/crewClient";
import { crewRunTitle } from "../model/crewRoster";

/** The crew dialog a menu pick or a button opens; the rail and the Crews page share it. */
export type CrewDialog =
  | {
      kind: "edit";
      crewId?: string;
      createScope?: "project" | "global";
      copyOf?: { crewId: string; scope: "project" | "global" };
    }
  | { kind: "start"; definitionId?: string }
  | { kind: "delete"; crewId: string };

/** Items of one crew's "…" menu. `single` is the crew's only ongoing work, if it has one. */
export function crewMenuItems(
  crew: CrewDefinition,
  options: { single?: CrewRunView; canOpenCoordinator: boolean; deleteSupported?: boolean },
): DropdownMenuItem[] {
  const { single, canOpenCoordinator, deleteSupported } = options;
  return [
    ...(single?.coordinatorSessionId && canOpenCoordinator
      ? [
          {
            kind: "item" as const,
            id: "open",
            label: t("Open coordinator"),
            description: crewRunTitle(single),
            icon: <Bot className="icon-sm" />,
          },
        ]
      : []),
    { kind: "item", id: "edit", label: t("Edit crew"), icon: <Pencil className="icon-sm" /> },
    { kind: "item", id: "duplicate", label: t("Duplicate"), icon: <Copy className="icon-sm" /> },
    {
      kind: "item",
      id: "scope",
      label: crew.projectId ? t("Copy to all projects") : t("Copy to this project"),
      icon: <Globe className="icon-sm" />,
    },
    ...(deleteSupported
      ? [
          { kind: "sep" as const },
          {
            kind: "item" as const,
            id: "delete",
            label: t("Delete crew"),
            danger: true,
            icon: <Trash2 className="icon-sm" />,
          },
        ]
      : []),
  ];
}

/** The dialog a picked menu item opens; `open` (coordinator) and unknown ids have none. */
export function crewMenuDialog(id: string, crew: CrewDefinition): CrewDialog | null {
  const crewId = crew.id;
  if (id === "edit") return { kind: "edit", crewId };
  if (id === "duplicate")
    return {
      kind: "edit",
      copyOf: { crewId, scope: crew.projectId ? "project" : "global" },
    };
  if (id === "scope")
    return { kind: "edit", copyOf: { crewId, scope: crew.projectId ? "global" : "project" } };
  if (id === "delete") return { kind: "delete", crewId };
  return null;
}
