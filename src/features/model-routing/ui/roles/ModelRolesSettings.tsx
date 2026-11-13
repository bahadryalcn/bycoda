import { useState } from "react";
import { t, useLocale } from "../../../../shared/i18n";
import type { ModelRoutingState } from "../../../../shared/model/host-contracts/model-routing";
import { Button } from "../../../../shared/ui/Button";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { Text } from "../../../../shared/ui/Text";
import { Group } from "../../../settings/public/settingsControls";
import { useModelRouting } from "../../model/modelRoutingClient";
import {
  effectiveRoleChoice,
  MODEL_ROLE_GROUPS,
  MODEL_ROLE_METADATA,
  modelChoicesEqual,
  pruneMissingPoolBindings,
  roleBindingsForSave,
} from "../../model/modelRoutingRoles";
import { ModelRoleRow } from "./ModelRoleRow";
import { RoutingSaveBar } from "../RoutingSaveBar";

export type ModelRolesSettingsProps = {
  /** The Host whose routing is edited. */
  machineId: string | undefined;
  /** Whether that Host advertises `models.routing.v1`. */
  supported: boolean;
  /** Opens the Model order tab. */
  onOpenOrder?: () => void;
};

/** Settings > Models > Assignments. */
export function ModelRolesSettings({ machineId, supported, onOpenOrder }: ModelRolesSettingsProps) {
  useLocale();
  const routing = useModelRouting(machineId, supported);
  if (!routing.supported || !machineId)
    return <Text as="p">{t("Model routing is not available on this Host.")}</Text>;
  if (!routing.state)
    return routing.error ? (
      <InlineError>{t("Model routing could not be loaded.")}</InlineError>
    ) : (
      <Text as="p">{t("Loading model routing…")}</Text>
    );
  return (
    <RolesEditor
      key={machineId}
      machineId={machineId}
      state={routing.state}
      save={routing.save}
      onOpenOrder={onOpenOrder}
    />
  );
}

function RolesEditor({
  machineId,
  state,
  save,
  onOpenOrder,
}: {
  machineId: string;
  state: ModelRoutingState;
  save: ReturnType<typeof useModelRouting>["save"];
  onOpenOrder?: () => void;
}) {
  const [base, setBase] = useState(state);
  const [roles, setRoles] = useState(state.roles);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const dirty = MODEL_ROLE_METADATA.some(
    ({ role }) => !modelChoicesEqual(roles[role], base.roles[role], role),
  );
  // A background refresh may update a pristine form, but never overwrites an edited draft.
  if (state.version > base.version && !dirty && !save.isPending) {
    setBase(state);
    setRoles(state.roles);
  }
  async function persist() {
    if (save.isPending || !dirty) return;
    setError("");
    setSaved(false);
    try {
      const result = await save.mutateAsync({
        expectedVersion: base.version,
        draft: {
          entries: base.entries,
          pools: base.pools,
          delegation: base.delegation,
          defaultMaxRunMinutes: base.defaultMaxRunMinutes,
          roles: roleBindingsForSave(pruneMissingPoolBindings(roles, base.pools)),
        },
      });
      setBase(result);
      setRoles(result.roles);
      setSaved(true);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(
        /conflict|changed|version/i.test(message)
          ? t("Settings changed elsewhere. Use latest settings, then apply your changes again.")
          : t("Model roles could not be saved. Try again."),
      );
    }
  }
  const conflict = state.version !== base.version && dirty;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {!base.entries.length ? (
        <InlineMessage
          tone="info"
          live="off"
          action={
            onOpenOrder ? (
              <Button type="button" size="sm" variant="link" onClick={onOpenOrder}>
                {t("Add models")}
              </Button>
            ) : undefined
          }
        >
          {t(
            "The model order is empty, so everything below uses its own model for now. Add models to the order to turn this on.",
          )}
        </InlineMessage>
      ) : null}
      {MODEL_ROLE_GROUPS.map((group) => (
        <Group key={group} title={t(group)} layout="full">
          {MODEL_ROLE_METADATA.filter((item) => item.group === group).map((item) => (
            <ModelRoleRow
              key={item.role}
              role={item.role}
              label={item.labelKey}
              description={item.descriptionKey}
              machineId={machineId}
              version={base.version}
              pools={base.pools}
              seed={base.entries[0]}
              orderReady={base.entries.length > 0}
              choice={effectiveRoleChoice(roles, item.role)}
              disabled={save.isPending}
              onChange={(choice) => {
                const next = { ...roles };
                if (!choice || (choice.kind === "order" && !item.role.startsWith("text.")))
                  delete next[item.role];
                else next[item.role] = choice;
                setRoles(next);
                setError("");
                setSaved(false);
              }}
            />
          ))}
        </Group>
      ))}
      <RoutingSaveBar
        dirty={dirty}
        pending={save.isPending}
        saved={saved}
        discardLabel={conflict || error ? t("Use latest settings") : undefined}
        discardEnabled={dirty || Boolean(error)}
        onDiscard={() => {
          setBase(state);
          setRoles(state.roles);
          setError("");
          setSaved(false);
        }}
        onSave={() => void persist()}
      >
        {error ? <InlineError>{error}</InlineError> : null}
        {conflict ? (
          <InlineError>
            {t("Settings changed elsewhere. Use latest settings, then apply your changes again.")}
          </InlineError>
        ) : null}
      </RoutingSaveBar>
    </div>
  );
}
