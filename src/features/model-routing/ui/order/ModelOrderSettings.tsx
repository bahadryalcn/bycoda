import { useT } from "../../../../shared/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { useAnimatedReorder } from "../../../../shared/hooks/useAnimatedReorder";
import { moveItem } from "../../../../shared/lib/reorder";
import {
  HOST_MODEL_ROUTING,
  MODEL_ROUTING_MAX_ENTRIES,
} from "../../../../shared/model/host-contracts/model-routing";
import { Button } from "../../../../shared/ui/Button";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { FailureState } from "../../../../shared/ui/FailureState";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { LoadingText } from "../../../../shared/ui/LoadingText";
import { Group } from "../../../settings/public/settingsControls";
import { defaultModelSettings } from "../../../sessions/public/models";
import { useModelSource } from "../../../sessions/public/modelSource";
import { isRemoteProvider } from "../../../connections/public/protocol";
import { useModelRoutingStatus } from "../../model/modelRoutingClient";
import { entrySettings, removeOrderEntry, replaceOrderEntry } from "../../model/modelRoutingDraft";
import { ModelOrderLimits } from "./ModelOrderLimits";
import { ModelOrderPools } from "./ModelOrderPools";
import { ModelOrderRow } from "./ModelOrderRow";
import { RoutingSaveBar } from "../RoutingSaveBar";
import { useOrderDraft, useOrderSettings } from "./useOrderDraft";
import type { MachineLimits } from "../../../tasks/public/hostSettings";

export type ModelOrderSettingsProps = {
  /** The Host whose routing is edited. */
  machineId: string | undefined;
  /** Whether that Host advertises `models.routing.v1`. */
  supported: boolean;
};

/** Settings > Work > Model order, bound to one capable Host. */
export function ModelOrderSettings({ machineId, supported }: ModelOrderSettingsProps) {
  const t = useT();
  if (!supported || !machineId)
    return (
      <FailureState
        size="inline"
        title={t("Model order is unavailable on this Host.")}
        description=""
      />
    );
  return <OrderSettingsLoader key={machineId} machineId={machineId} />;
}

function OrderSettingsLoader({ machineId }: { machineId: string }) {
  const t = useT();
  const client = useQueryClient();
  const settings = useOrderSettings(machineId);
  if (settings.routing.loading || settings.limits.isPending)
    return <LoadingText>{t("Loading models and limits…")}</LoadingText>;
  if (!settings.routing.state || !settings.limits.data)
    return (
      <FailureState
        size="inline"
        title={t("Models and limits could not be read.")}
        description=""
        error={settings.routing.error ?? settings.limits.error}
        onRetry={async () => {
          await Promise.all([
            settings.limits.refetch(),
            client.refetchQueries({ queryKey: [HOST_MODEL_ROUTING, machineId], exact: true }),
          ]);
        }}
      />
    );
  return (
    <OrderSettingsForm
      machineId={machineId}
      settings={settings}
      initial={{ routing: settings.routing.state, limits: settings.limits.data.state }}
    />
  );
}

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
  const editor = useOrderDraft(settings, initial, machineId);
  const status = useModelRoutingStatus(machineId, true);
  const { draft, change } = editor;
  const { entries } = draft.routing;
  const sortable = useAnimatedReorder(
    entries.map((entry) => entry.id),
    (ids) =>
      change({
        ...draft,
        routing: {
          ...draft.routing,
          entries: ids.map((id) => entries.find((entry) => entry.id === id)!),
        },
      }),
    "y",
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
  return (
    <div className="flex flex-col gap-4">
      <FieldGroup variant="bare" disabled={editor.pending} inert={editor.pending}>
        {!entries.length ? (
          <EmptyState
            context="panel"
            title={t("Choose the models for unattended work")}
            description={t(
              "Tasks, epics, crews, automations and the assistant start on the first model in this list that still has quota. Until you add one, each item keeps its own model.",
            )}
            action={
              <Button variant="primary" onClick={addEntry}>
                {t("Add model")}
              </Button>
            }
          />
        ) : (
          <Group
            title={t("Model order")}
            layout="full"
            description={t(
              "New work starts on the first model with quota left. Running work keeps its model.",
            )}
            action={
              <Button
                size="sm"
                disabled={entries.length >= MODEL_ROUTING_MAX_ENTRIES}
                disabledReason={
                  entries.length >= MODEL_ROUTING_MAX_ENTRIES
                    ? t("The model order is full.")
                    : undefined
                }
                onClick={addEntry}
              >
                {t("Add model")}
              </Button>
            }
          >
            {status.error ? (
              <FailureState
                size="inline"
                title={t("Model limits could not be read.")}
                description=""
                error={status.error}
                onRetry={() => status.refetch()}
              />
            ) : null}
            {entries.map((entry, index) => (
              <ModelOrderRow
                key={entry.id}
                entry={entry}
                index={index}
                count={entries.length}
                percent={draft.percentages[entry.id] ?? "0"}
                status={status.entries.find((candidate) => candidate.entryId === entry.id)}
                statusLoading={status.loading}
                statusError={Boolean(status.error && status.entries.length === 0)}
                sortable={sortable}
                onChange={(next) => change(replaceOrderEntry(draft, next))}
                onPercent={(text) =>
                  change({ ...draft, percentages: { ...draft.percentages, [entry.id]: text } })
                }
                onMove={(delta) =>
                  change({
                    ...draft,
                    routing: { ...draft.routing, entries: moveItem(entries, index, index + delta) },
                  })
                }
                onRemove={() => editor.edit((current) => removeOrderEntry(current, entry.id))}
              />
            ))}
          </Group>
        )}
        {entries.length ? (
          <ModelOrderPools draft={draft} onChange={change} onEdit={editor.edit} />
        ) : null}
        <ModelOrderLimits
          draft={draft}
          usage={settings.limits.data?.state ?? initial.limits}
          onChange={change}
        />
      </FieldGroup>
      <RoutingSaveBar
        dirty={editor.dirty}
        pending={editor.pending}
        saved={editor.saved}
        canSave={!editor.validation && !editor.conflict}
        discardLabel={editor.conflict ? t("Reload") : undefined}
        discardEnabled={editor.dirty || editor.conflict}
        onDiscard={() => {
          if (editor.conflict) void editor.reload();
          else editor.revert();
        }}
        onSave={() => void editor.save()}
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
      </RoutingSaveBar>
    </div>
  );
}
