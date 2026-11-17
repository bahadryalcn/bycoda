import { t, useLocale } from "../../../../shared/i18n";
import { Group } from "../../../../shared/ui/settings";
import type { OrderDraft } from "../../model/modelRoutingDraft";
import {
  effectiveRoleChoice,
  MODEL_ROLE_GROUPS,
  MODEL_ROLE_METADATA,
} from "../../model/modelRoutingRoles";
import { ModelRoleRow } from "./ModelRoleRow";

export type ModelRolesGroupsProps = {
  /** The Host whose routing is edited. */
  machineId: string;
  /** The Background work draft; jobs, models and groups save together. */
  draft: OrderDraft;
  /** Version of the saved document; previews describe it only while the draft is clean. */
  savedVersion: number;
  /** The draft equals the saved document, so a live "uses …" preview is meaningful. */
  live: boolean;
  disabled: boolean;
  onChange: (draft: OrderDraft) => void;
};

/**
 * Settings > Models > Background work > Who uses what. Reads groups from the same draft as
 * the model list, so a group made a moment ago is already a choice here.
 */
export function ModelRolesGroups({
  machineId,
  draft,
  savedVersion,
  live,
  disabled,
  onChange,
}: ModelRolesGroupsProps) {
  useLocale();
  const { roles, pools, entries } = draft.routing;
  return (
    <>
      {MODEL_ROLE_GROUPS.map((group) => (
        <Group key={group} title={t(group)} layout="full">
          {MODEL_ROLE_METADATA.filter((item) => item.group === group).map((item) => (
            <ModelRoleRow
              key={item.role}
              role={item.role}
              label={item.labelKey}
              machineId={machineId}
              version={savedVersion}
              pools={pools}
              seed={entries[0]}
              orderReady={live && entries.length > 0}
              choice={effectiveRoleChoice(roles, item.role)}
              disabled={disabled}
              onChange={(choice) => {
                const next = { ...roles };
                if (!choice || (choice.kind === "order" && !item.role.startsWith("text.")))
                  delete next[item.role];
                else next[item.role] = choice;
                onChange({ ...draft, routing: { ...draft.routing, roles: next } });
              }}
            />
          ))}
        </Group>
      ))}
    </>
  );
}
