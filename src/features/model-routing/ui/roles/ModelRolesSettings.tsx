import { retainedTransactionValue, useRetainedTransaction } from "../../model/retainedTransaction";
import { t, useLocale } from "../../../../shared/i18n";
import type { ModelRoutingState } from "../../../../shared/model/host-contracts/model-routing";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { Group, SettingsFeedback } from "../../../../shared/ui/settings";
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
  /** Brings the model list into view. */
  onOpenOrder?: () => void;
};

/** Settings > Models > Background work > Who uses what. */
export function ModelRolesSettings({ machineId, supported, onOpenOrder }: ModelRolesSettingsProps) {
  useLocale();
  const routing = useModelRouting(machineId, supported);
  if (!routing.supported || !machineId)
    return (
      <SettingsFeedback state="error">
        {t("Model routing is not available on this Host.")}
      </SettingsFeedback>
    );
  if (!routing.state)
    return routing.error ? (
      <SettingsFeedback state="error" action={{ label: t("Retry"), onClick: routing.refetch }}>
        {t("Model routing could not be loaded.")}
      </SettingsFeedback>
    ) : (
      <SettingsFeedback state="loading">{t("Loading…")}</SettingsFeedback>
    );
  return (
    <RolesEditor
      key={machineId}
      machineId={machineId}
      state={routing.state}
      save={routing.save}
      refetch={routing.refetch}
      onOpenOrder={onOpenOrder}
    />
  );
}

function RolesEditor({
  machineId,
  state,
  save,
  refetch,
  onOpenOrder,
}: {
  machineId: string;
  state: ModelRoutingState;
  save: ReturnType<typeof useModelRouting>["save"];
  refetch: ReturnType<typeof useModelRouting>["refetch"];
  onOpenOrder?: () => void;
}) {
  const [base, setBase] = useRetainedTransaction(`roles:${machineId}:base`, state);
  const [roles, setRoles] = useRetainedTransaction(`roles:${machineId}:draft`, state.roles);
  const [error, setError] = useRetainedTransaction(`roles:${machineId}:error`, "");
  const [saved, setSaved] = useRetainedTransaction(`roles:${machineId}:saved`, false);
  const [pending, setPending] = useRetainedTransaction(`roles:${machineId}:pending`, false);
  const dirty = MODEL_ROLE_METADATA.some(
    ({ role }) => !modelChoicesEqual(roles[role], base.roles[role], role),
  );
  // A background refresh may update a pristine form, but never overwrites an edited draft.
  if (state.version > base.version && !dirty && !pending) {
    setBase(state);
    setRoles(state.roles);
  }
  // The model list below saves the same document; a save that left every job alone moves
  // this draft onto the new version instead of reporting a conflict.
  if (
    state.version > base.version &&
    dirty &&
    !pending &&
    MODEL_ROLE_METADATA.every(({ role }) =>
      modelChoicesEqual(state.roles[role], base.roles[role], role),
    )
  ) {
    setBase(state);
  }
  async function persist() {
    if (
      retainedTransactionValue<boolean>(`roles:${machineId}:pending`) ||
      !dirty ||
      state.version > base.version
    )
      return;
    setPending(true);
    setError("");
    setSaved(false);
    const submittedRoles = roles;
    try {
      const result = await save.mutateAsync({
        expectedVersion: base.version,
        draft: {
          entries: base.entries,
          pools: base.pools,
          delegation: base.delegation,
          workCaps: base.workCaps,
          defaultMaxRunMinutes: base.defaultMaxRunMinutes,
          roles: roleBindingsForSave(pruneMissingPoolBindings(submittedRoles, base.pools)),
        },
      });
      setBase(result);
      setRoles((current) => (current === submittedRoles ? result.roles : current));
      setSaved(true);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(
        /conflict|changed|version/i.test(message)
          ? t("Settings changed elsewhere. Use latest settings, then apply your changes again.")
          : t("Model roles could not be saved. Try again."),
      );
    } finally {
      setPending(false);
    }
  }
  const conflict = state.version > base.version && dirty;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {!base.entries.length ? (
        <InlineMessage
          tone="info"
          live="off"
          action={onOpenOrder ? { label: t("Add models"), onClick: onOpenOrder } : undefined}
        >
          {t("Add models to the list below first.")}
        </InlineMessage>
      ) : null}
      {MODEL_ROLE_GROUPS.map((group) => (
        <Group key={group} title={t(group)} layout="full">
          {MODEL_ROLE_METADATA.filter((item) => item.group === group).map((item) => (
            <ModelRoleRow
              key={item.role}
              role={item.role}
              label={item.labelKey}
              machineId={machineId}
              version={base.version}
              pools={base.pools}
              seed={base.entries[0]}
              orderReady={base.entries.length > 0}
              choice={effectiveRoleChoice(roles, item.role)}
              disabled={pending}
              onChange={(choice) => {
                setRoles((current) => {
                  const next = { ...current };
                  if (!choice || (choice.kind === "order" && !item.role.startsWith("text.")))
                    delete next[item.role];
                  else next[item.role] = choice;
                  return next;
                });
                setError("");
                setSaved(false);
              }}
            />
          ))}
        </Group>
      ))}
      <RoutingSaveBar
        dirty={dirty}
        pending={pending}
        saved={saved}
        canSave={!conflict}
        discardLabel={conflict || error ? t("Use latest settings") : undefined}
        discardEnabled={dirty || Boolean(error)}
        onDiscard={() => {
          if (!conflict && !error) {
            setBase(state);
            setRoles(state.roles);
            setSaved(false);
            return;
          }
          void refetch()
            .then((result) => {
              if (result.isError || !result.data) {
                setError(t("Model routing could not be loaded."));
                return;
              }
              setBase(result.data);
              setRoles(result.data.roles);
              setError("");
              setSaved(false);
            })
            .catch(() => setError(t("Model routing could not be loaded.")));
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
