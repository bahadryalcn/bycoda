import { useState, useSyncExternalStore } from "react";
import { useT } from "../../../../shared/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { HOST_MODEL_ROUTING } from "../../../../shared/model/host-contracts/model-routing";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { SettingsFeedback, SettingsSaveBar } from "../../../../shared/ui/settings";
import { Tab, TabList, TabPanel, Tabs } from "../../../../shared/ui/Tabs";
import { TabDirtyDot } from "../../../../shared/ui/TabLabel";
import { Text } from "../../../../shared/ui/Text";
import {
  providerAccounts,
  subscribeProviderAccounts,
} from "../../../providers/public/providerAccounts";
import { loadUsageLimitFailover } from "../../../settings/public/settings";
import { useModelRoutingStatus } from "../../model/modelRoutingClient";
import { hostProvidersFrom } from "../../model/hostProviders";
import {
  groupEntriesByKind,
  unavailableOrderEntryId,
  type OrderDraft,
} from "../../model/modelRoutingDraft";
import { DelegationSettings } from "../delegation/DelegationSettings";
import { ModelRolesGroups } from "../roles/ModelRolesGroups";
import { ModelOrderLimitsTab } from "./ModelOrderLimitsTab";
import { ModelOrderList, type FocusRequest, type OrderView } from "./ModelOrderList";
import { ModelOrderPools } from "./ModelOrderPools";
import { orderChanges } from "./orderChanges";
import { kindOf } from "./orderGrouping";
import { changedTabs, type OrderTab } from "./orderTabs";
import { useOrderDraft, useOrderSettings } from "./useOrderDraft";
import { useRetainedTransaction } from "../../model/retainedTransaction";
import { useModelSource } from "../../../sessions/public/modelSource";
import type {
  ModelRoutingEntry,
  ModelRoutingTarget,
} from "../../../../shared/model/host-contracts/model-routing";

export type ModelOrderSettingsProps = {
  /** The Host whose routing is edited. */
  machineId: string | undefined;
  /** Whether that Host advertises `models.routing.v1`. */
  supported: boolean;
};

/**
 * Settings > Models > Background work: jobs, the model order, groups, agents and limits in
 * tabs over one draft with one Save, bound to one capable Host.
 */
export function ModelOrderSettings({ machineId, supported }: ModelOrderSettingsProps) {
  const t = useT();
  if (!supported || !machineId)
    return (
      <SettingsFeedback state="error">
        {t("Model routing is not available on this Host.")}
      </SettingsFeedback>
    );
  return <OrderSettingsLoader key={machineId} machineId={machineId} />;
}

function OrderSettingsLoader({ machineId }: { machineId: string }) {
  const t = useT();
  const client = useQueryClient();
  const settings = useOrderSettings(machineId);
  if (settings.routing.loading)
    return <SettingsFeedback state="loading">{t("Loading…")}</SettingsFeedback>;
  if (!settings.routing.state)
    return (
      <SettingsFeedback
        state="error"
        action={{
          label: t("Retry"),
          onClick: async () => {
            await client.refetchQueries({ queryKey: [HOST_MODEL_ROUTING, machineId], exact: true });
          },
        }}
      >
        {t("Models could not be read.")}
      </SettingsFeedback>
    );
  return (
    <OrderSettingsForm
      machineId={machineId}
      settings={settings}
      initial={{ routing: settings.routing.state, limits: settings.limits.data?.state }}
    />
  );
}

const accountsSnapshot = () =>
  JSON.stringify([providerAccounts("claude"), providerAccounts("codex"), providerAccounts("grok")]);

function OrderSettingsForm({
  machineId,
  settings,
  initial,
}: {
  machineId: string;
  settings: ReturnType<typeof useOrderSettings>;
  initial: Parameters<typeof useOrderDraft>[1];
}) {
  const t = useT();
  // Account kinds decide which list an entry sits in.
  useSyncExternalStore(subscribeProviderAccounts, accountsSnapshot, accountsSnapshot);
  const editor = useOrderDraft(settings, initial, machineId);
  const source = useModelSource();
  const status = useModelRoutingStatus(machineId, true);
  // The tab and list view survive leaving Settings; a first visit with no models starts at the list.
  const [tab, setTab] = useRetainedTransaction<OrderTab>(
    `order:${machineId}:tab`,
    initial.routing.entries.length ? "jobs" : "models",
  );
  const [view, setView] = useRetainedTransaction<OrderView>(`order:${machineId}:view`, "priority");
  const [focusRequest, setFocusRequest] = useState<FocusRequest>();
  const [setupRevision, setSetupRevision] = useState(0);
  const [setupPlanner, setSetupPlanner] = useState<ModelRoutingTarget>();
  const { draft } = editor;
  const kindFor = (entry: ModelRoutingEntry) => kindOf(entry, source);
  const change = (next: OrderDraft) => editor.change(groupEntriesByKind(next, kindFor));
  const edit = (operation: (current: OrderDraft) => OrderDraft) =>
    editor.edit((current) => groupEntriesByKind(operation(current), kindFor));
  const savedRouting = settings.routing.state ?? initial.routing;
  const listed = editor.dirty ? orderChanges(editor.base, draft, change) : [];
  // Anything the list does not name still counts, so Save never hides behind a clean count.
  const changes =
    editor.dirty && !listed.length ? [{ id: "other", label: t("Other changes") }] : listed;
  const dirtyTabs = changedTabs(changes);
  const message = editor.validation || editor.error;
  const invalidId = editor.invalidEntryId ?? unavailableOrderEntryId(editor.validation);
  const invalid =
    invalidId && draft.routing.entries.some((entry) => entry.id === invalidId)
      ? { id: invalidId, message: t(message) }
      : undefined;
  const show = invalid
    ? {
        label: t("Show"),
        onClick: () => {
          setTab("models");
          setFocusRequest((current) => ({ id: invalid.id, n: (current?.n ?? 0) + 1 }));
        },
      }
    : undefined;
  const tabs: { id: OrderTab; label: string }[] = [
    { id: "jobs", label: t("Jobs") },
    { id: "models", label: t("Models & order") },
    { id: "groups", label: t("Groups") },
    { id: "agents", label: t("Agents") },
    { id: "limits", label: t("Limits") },
  ];
  return (
    <div className="flex flex-col gap-4">
      <Tabs value={tab} onValueChange={setTab} panels="shared">
        <TabList label={t("Background work")} scrollbar="hidden">
          {tabs.map((item) => (
            <Tab key={item.id} value={item.id}>
              {item.label}
              {dirtyTabs.has(item.id) ? <TabDirtyDot /> : null}
            </Tab>
          ))}
        </TabList>
        <TabPanel>
          <FieldGroup variant="bare" disabled={editor.pending} inert={editor.pending}>
            {tab === "jobs" ? (
              <ModelRolesGroups
                machineId={machineId}
                draft={draft}
                savedVersion={savedRouting.version}
                live={!editor.dirty}
                disabled={editor.pending}
                onChange={change}
              />
            ) : null}
            {tab === "models" ? (
              <ModelOrderList
                draft={draft}
                dirty={editor.dirty}
                change={change}
                edit={edit}
                status={status}
                catalog={settings.catalog.data}
                chatFallback={loadUsageLimitFailover() === "order"}
                view={view}
                onView={setView}
                invalid={invalid}
                focusRequest={focusRequest}
                setupRevision={setupRevision}
                setupPlanner={setupPlanner}
                onSetupPlannerChange={setSetupPlanner}
              />
            ) : null}
            {tab === "groups" ? (
              <ModelOrderPools draft={draft} onChange={change} onEdit={edit} />
            ) : null}
            {tab === "agents" ? (
              <DelegationSettings draft={draft} disabled={editor.pending} onChange={change} />
            ) : null}
            {tab === "limits" && settings.limits.data ? (
              <ModelOrderLimitsTab
                machineId={machineId}
                machine={settings.limits.data.machine}
                draft={draft}
                usage={{ ...settings.limits.data.state, stale: settings.limits.isError }}
                hostProviders={hostProvidersFrom(settings.catalog)}
                onChange={change}
                onFieldInvalid={editor.fieldInvalid}
              />
            ) : null}
            {tab === "limits" && !settings.limits.data ? (
              <SettingsFeedback
                state={settings.limits.isPending ? "loading" : "error"}
                action={
                  settings.limits.isPending
                    ? undefined
                    : {
                        label: t("Retry"),
                        onClick: async () => {
                          await settings.limits.refetch();
                        },
                      }
                }
              >
                {settings.limits.isPending ? t("Loading…") : t("Work limits could not be read.")}
              </SettingsFeedback>
            ) : null}
          </FieldGroup>
        </TabPanel>
      </Tabs>
      <SettingsSaveBar
        id={`background-work:${machineId}`}
        title={t("Background work")}
        changes={changes}
        pending={editor.pending}
        saved={editor.saved}
        canSave={!editor.validation && !editor.conflict}
        saveLabel={t("Save changes")}
        leading={
          !editor.dirty && !editor.pending && !editor.saved && !editor.conflict ? (
            <Text size="caption" tone="secondary">
              {t("No unsaved changes")}
            </Text>
          ) : null
        }
        discardLabel={editor.conflict ? t("Reload") : undefined}
        discardEnabled={editor.dirty || editor.conflict}
        onDiscard={() => {
          setSetupRevision((current) => current + 1);
          if (editor.conflict) void editor.reload();
          else editor.revert();
        }}
        onSave={() => {
          setSetupRevision((current) => current + 1);
          return editor.save();
        }}
      >
        {editor.validation ? <InlineError action={show}>{t(editor.validation)}</InlineError> : null}
        {editor.error ? <InlineError action={show}>{t(editor.error)}</InlineError> : null}
        {editor.conflict ? (
          <InlineMessage tone="warning">
            {t(
              "These settings changed elsewhere. Your draft is kept. Use Reload to discard it and load the latest settings.",
            )}
          </InlineMessage>
        ) : null}
      </SettingsSaveBar>
    </div>
  );
}
