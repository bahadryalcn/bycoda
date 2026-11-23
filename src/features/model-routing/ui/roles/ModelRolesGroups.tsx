import { useQueries } from "@tanstack/react-query";
import {
  useForegroundQueryFamilyPolling,
  useQueryVisible,
} from "../../../../shared/hooks/useQueryVisible";
import { t, useLocale } from "../../../../shared/i18n";
import type { ModelRoutingRole } from "../../../../shared/model/host-contracts/model-routing";
import { InlineMessage } from "../../../../shared/ui/InlineError";
import { Group } from "../../../../shared/ui/settings";
import type { OrderDraft } from "../../model/modelRoutingDraft";
import {
  effectiveRoleChoice,
  MODEL_ROLE_GROUPS,
  MODEL_ROLE_METADATA,
} from "../../model/modelRoutingRoles";
import {
  MODEL_ROUTING_PREVIEW_POLL_MS,
  modelRoutingPreviewOptions,
} from "../../model/useModelRoutingPreview";
import { ModelRoleRow } from "./ModelRoleRow";
import { waitsForModel, type RolePreview } from "./ModelRolePreview";

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
  const orderReady = live && entries.length > 0;
  const visible = useQueryVisible();
  // One read for the whole list, so a single notice can speak for every job that would wait.
  const previews = useQueries({
    queries: MODEL_ROLE_METADATA.map((item) => {
      const choice = effectiveRoleChoice(roles, item.role);
      return {
        ...modelRoutingPreviewOptions(
          machineId,
          ["model-routing-role-preview", machineId, item.role, choice, savedVersion],
          { role: item.role, choice },
        ),
        enabled: visible && orderReady && !!choice && choice.kind !== "fixed",
      };
    }),
  });
  useForegroundQueryFamilyPolling(
    ["model-routing-role-preview", machineId],
    MODEL_ROUTING_PREVIEW_POLL_MS,
    { enabled: orderReady },
  );
  const previewOf = (role: ModelRoutingRole): RolePreview | undefined => {
    const query = previews[MODEL_ROLE_METADATA.findIndex((item) => item.role === role)];
    const choice = effectiveRoleChoice(roles, role);
    if (!orderReady || !choice || choice.kind === "fixed" || !query) return undefined;
    return { data: query.data, isError: query.isError };
  };
  const anyWaits = MODEL_ROLE_METADATA.some((item) =>
    waitsForModel(previewOf(item.role), item.role.startsWith("text.")),
  );
  const anyFailed = MODEL_ROLE_METADATA.some((item) => previewOf(item.role)?.isError);
  return (
    <>
      {anyWaits ? (
        <InlineMessage tone="warning">
          {t("No eligible model right now. Runs wait until one is available.")}
        </InlineMessage>
      ) : null}
      {anyFailed ? (
        <InlineMessage tone="warning">
          {t("Current model could not be checked. You can still edit this choice.")}
        </InlineMessage>
      ) : null}
      {MODEL_ROLE_GROUPS.map((group) => (
        <Group key={group} title={t(group)} layout="full">
          {MODEL_ROLE_METADATA.filter((item) => item.group === group).map((item) => (
            <ModelRoleRow
              key={item.role}
              role={item.role}
              label={item.labelKey}
              pools={pools}
              seed={entries[0]}
              preview={previewOf(item.role)}
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
