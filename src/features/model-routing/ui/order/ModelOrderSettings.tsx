import { useSyncExternalStore } from "react";
import { useT } from "../../../../shared/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { useAnimatedReorder } from "../../../../shared/hooks/useAnimatedReorder";
import {
  HOST_MODEL_ROUTING,
  MODEL_ROUTING_MAX_ENTRIES,
  type ModelRoutingEntry,
} from "../../../../shared/model/host-contracts/model-routing";
import { Button } from "../../../../shared/ui/Button";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { FailureState } from "../../../../shared/ui/FailureState";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { Group, SettingsFeedback, SettingsSaveBar } from "../../../../shared/ui/settings";
import { defaultModelSettings } from "../../../sessions/public/models";
import { useModelSource } from "../../../sessions/public/modelSource";
import { isRemoteProvider } from "../../../connections/public/protocol";
import {
  providerAccounts,
  subscribeProviderAccounts,
} from "../../../providers/public/providerAccounts";
import { useModelRoutingStatus } from "../../model/modelRoutingClient";
import {
  entrySettings,
  groupEntriesByKind,
  removeOrderEntry,
  reorderKind,
  replaceOrderEntry,
  type EntryKind,
  type OrderDraft,
} from "../../model/modelRoutingDraft";
import { ModelRolesGroups } from "../roles/ModelRolesGroups";
import { ModelOrderLimits } from "./ModelOrderLimits";
import { ModelOrderPools } from "./ModelOrderPools";
import { OrderSortMenu } from "./OrderSortMenu";
import { SmartSetupAction } from "./SmartSetupAction";
import { ModelOrderRow } from "./ModelOrderRow";
import { orderChanges } from "./orderChanges";
import { entryAccountKind } from "./useEntryAccount";
import { useOrderDraft, useOrderSettings } from "./useOrderDraft";
import type { MachineLimits } from "../../../tasks/public/hostSettings";

export type ModelOrderSettingsProps = {
  /** The Host whose routing is edited. */
  machineId: string | undefined;
  /** Whether that Host advertises `models.routing.v1`. */
  supported: boolean;
};

/**
 * Settings > Models > Background work: models, groups, who uses what and limits, edited as
 * one draft with one Save, bound to one capable Host.
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
  if (settings.routing.loading || settings.limits.isPending)
    return <SettingsFeedback state="loading">{t("Loading…")}</SettingsFeedback>;
  if (!settings.routing.state || !settings.limits.data)
    return (
      <SettingsFeedback
        state="error"
        action={{
          label: t("Retry"),
          onClick: async () => {
            await Promise.all([
              settings.limits.refetch(),
              client.refetchQueries({ queryKey: [HOST_MODEL_ROUTING, machineId], exact: true }),
            ]);
          },
        }}
      >
        {t("Models and limits could not be read.")}
      </SettingsFeedback>
    );
  return (
    <OrderSettingsForm
      machineId={machineId}
      settings={settings}
      initial={{ routing: settings.routing.state, limits: settings.limits.data.state }}
    />
  );
}

const accountsSnapshot = () =>
  JSON.stringify([providerAccounts("claude"), providerAccounts("codex"), providerAccounts("grok")]);
const kindOf = (entry: ModelRoutingEntry): EntryKind => entryAccountKind(entry) ?? "shared";
const SECTION_TITLE: Record<EntryKind, string> = {
  work: "Work accounts",
  personal: "Personal accounts",
  shared: "Shared models",
};

function OrderSettingsForm({
  machineId,
  settings,
  initial,
}: {
  machineId: string;
  settings: ReturnType<typeof useOrderSettings>;
  initial: Parameters<typeof useOrderDraft>[1] & { limits: MachineLimits };
}) {
  const t = useT();
  const source = useModelSource();
  // Account kinds decide which list an entry sits in.
  useSyncExternalStore(subscribeProviderAccounts, accountsSnapshot, accountsSnapshot);
  const editor = useOrderDraft(settings, initial, machineId);
  const status = useModelRoutingStatus(machineId, true);
  const { draft } = editor;
  const { entries } = draft.routing;
  const change = (next: OrderDraft) => editor.change(groupEntriesByKind(next, kindOf));
  const edit = (operation: (current: OrderDraft) => OrderDraft) =>
    editor.edit((current) => groupEntriesByKind(operation(current), kindOf));
  const savedRouting = settings.routing.state ?? initial.routing;
  const byKind = {
    work: entries.filter((entry) => kindOf(entry) === "work"),
    personal: entries.filter((entry) => kindOf(entry) === "personal"),
    shared: entries.filter((entry) => kindOf(entry) === "shared"),
  };
  const sortables = {
    work: useAnimatedReorder(
      byKind.work.map((entry) => entry.id),
      (ids) => change(reorderKind(draft, kindOf, "work", ids)),
      "y",
    ),
    personal: useAnimatedReorder(
      byKind.personal.map((entry) => entry.id),
      (ids) => change(reorderKind(draft, kindOf, "personal", ids)),
      "y",
    ),
    shared: useAnimatedReorder(
      byKind.shared.map((entry) => entry.id),
      (ids) => change(reorderKind(draft, kindOf, "shared", ids)),
      "y",
    ),
  };
  const sectioned = byKind.work.length > 0 || byKind.personal.length > 0;
  const listed = editor.dirty ? orderChanges(editor.base, draft, change) : [];
  // Anything the list does not name still counts, so Save never hides behind a clean count.
  const changes =
    editor.dirty && !listed.length ? [{ id: "other", label: t("Other changes") }] : listed;
  // The first saved model of each list the Host would not skip is where new work starts.
  const nextIds = new Set(
    editor.dirty
      ? []
      : Object.values(byKind).flatMap((list) => {
          const first = list.find((entry) => {
            const entryStatus = status.entries.find((candidate) => candidate.entryId === entry.id);
            return entryStatus && !entryStatus.skip;
          });
          return first ? [first.id] : [];
        }),
  );
  function addEntry() {
    const model = source.resolve(entries[entries.length - 1]?.harness ?? "codex", "");
    if (!isRemoteProvider(model.harness)) return;
    const id = crypto.randomUUID();
    change({
      ...draft,
      percentages: { ...draft.percentages, [id]: "0" },
      routing: {
        ...draft.routing,
        entries: [
          ...entries,
          {
            id,
            harness: model.harness,
            model: model.id,
            modelSettings: entrySettings(defaultModelSettings(model)),
            unknownLimit: "use",
          },
        ],
      },
    });
  }
  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <OrderSortMenu disabled={entries.length < 2} onEdit={edit} />
      <SmartSetupAction onEdit={edit} />
      <Button
        size="sm"
        disabled={entries.length >= MODEL_ROUTING_MAX_ENTRIES}
        disabledReason={
          entries.length >= MODEL_ROUTING_MAX_ENTRIES ? t("The model list is full.") : undefined
        }
        onClick={addEntry}
      >
        {t("Add model")}
      </Button>
    </div>
  );
  return (
    <div className="flex flex-col gap-4">
      <FieldGroup variant="bare" disabled={editor.pending} inert={editor.pending}>
        {!entries.length ? (
          <EmptyState
            context="panel"
            title={t("Choose the models for unattended work")}
            description=""
            action={{ label: t("Add model"), onClick: addEntry }}
            extra={<SmartSetupAction variant="primary" onEdit={edit} />}
          />
        ) : (
          (["work", "personal", "shared"] as const)
            .filter((kind) => byKind[kind].length)
            .map((kind, sectionIndex) => (
              <Group
                key={kind}
                title={sectioned ? t(SECTION_TITLE[kind]) : t("All models")}
                layout="full"
                info={
                  sectionIndex === 0
                    ? t(
                        "Tried from the top: new work starts on the first model with quota left. A work project uses only work and shared models, a personal project only personal and shared ones. Running work keeps its model.",
                      )
                    : undefined
                }
                action={sectionIndex === 0 ? actions : undefined}
              >
                {sectionIndex === 0 && status.error ? (
                  <FailureState
                    size="inline"
                    title={t("Model limits could not be read.")}
                    description=""
                    error={status.error}
                    onRetry={() => status.refetch()}
                  />
                ) : null}
                {byKind[kind].map((entry, index) => (
                  <ModelOrderRow
                    key={entry.id}
                    entry={entry}
                    index={index}
                    count={byKind[kind].length}
                    next={nextIds.has(entry.id)}
                    percent={draft.percentages[entry.id] ?? "0"}
                    status={status.entries.find((candidate) => candidate.entryId === entry.id)}
                    statusLoading={status.loading}
                    statusError={Boolean(status.error && status.entries.length === 0)}
                    sortable={sortables[kind]}
                    onChange={(next) => change(replaceOrderEntry(draft, next))}
                    onPercent={(text) =>
                      change({ ...draft, percentages: { ...draft.percentages, [entry.id]: text } })
                    }
                    onRemove={() => edit((current) => removeOrderEntry(current, entry.id))}
                  />
                ))}
              </Group>
            ))
        )}
        {entries.length ? <ModelOrderPools draft={draft} onChange={change} onEdit={edit} /> : null}
        <Disclosure
          key={entries.length ? "configured" : "empty"}
          summary={t("Who uses what")}
          defaultOpen={entries.length > 0 || Object.keys(draft.routing.roles).length > 0}
          variant="row"
        >
          <ModelRolesGroups
            machineId={machineId}
            draft={draft}
            savedVersion={savedRouting.version}
            live={!editor.dirty}
            disabled={editor.pending}
            onChange={change}
          />
        </Disclosure>
        <ModelOrderLimits
          draft={draft}
          usage={settings.limits.data?.state ?? initial.limits}
          onChange={change}
        />
      </FieldGroup>
      <SettingsSaveBar
        id={`background-work:${machineId}`}
        title={t("Background work")}
        changes={changes}
        pending={editor.pending}
        saved={editor.saved}
        canSave={!editor.validation && !editor.conflict}
        discardLabel={editor.conflict ? t("Reload") : undefined}
        discardEnabled={editor.dirty || editor.conflict}
        onDiscard={() => {
          if (editor.conflict) void editor.reload();
          else editor.revert();
        }}
        onSave={editor.save}
      >
        {editor.validation ? <InlineError>{t(editor.validation)}</InlineError> : null}
        {editor.error ? <InlineError>{t(editor.error)}</InlineError> : null}
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
