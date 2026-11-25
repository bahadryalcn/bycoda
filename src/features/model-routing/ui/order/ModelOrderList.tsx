import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useT } from "../../../../shared/i18n";
import { useAnimatedReorder } from "../../../../shared/hooks/useAnimatedReorder";
import {
  MODEL_ROUTING_MAX_ENTRIES,
  type ModelRoutingEntry,
  type ModelRoutingTarget,
} from "../../../../shared/model/host-contracts/model-routing";
import { Button } from "../../../../shared/ui/Button";
import { Checkbox } from "../../../../shared/ui/Checkbox";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { Heading } from "../../../../shared/ui/Heading";
import { FailureState } from "../../../../shared/ui/FailureState";
import { SegmentedControl } from "../../../../shared/ui/SegmentedControl";
import { Text } from "../../../../shared/ui/Text";
import { Group } from "../../../../shared/ui/settings";
import { useModelSource } from "../../../sessions/public/modelSource";
import {
  entrySettings,
  reorderKind,
  replaceOrderEntry,
  type EntryKind,
  type OrderDraft,
} from "../../model/modelRoutingDraft";
import { setupCandidates } from "../../model/smartSetup";
import type { SetupCatalog } from "../../model/smartSetupCatalog";
import type { useModelRoutingStatus } from "../../model/modelRoutingClient";
import { AccountGroupHeader } from "./AccountGroupHeader";
import { ModelOrderRow } from "./ModelOrderRow";
import { OrderSelectionBar } from "./OrderSelectionBar";
import { OrderSortMenu } from "./OrderSortMenu";
import { SmartSetupAction } from "./SmartSetupAction";
import {
  addAccountModels,
  addChoiceFor,
  addEntriesToPool,
  removeEntries,
  setEntriesEffort,
} from "./orderBulk";
import { groupByAccount, jobsUsingOrder, kindOf, type AccountGroup } from "./orderGrouping";
import { useQuotaLabel } from "./useQuotaLabel";

export type OrderView = "account" | "priority";
/** The row the Host refused and why; the list highlights it. */
export type InvalidEntry = { id: string; message: string };
/** Asks the list to scroll to and focus a row; a new `n` repeats the request for the same row. */
export type FocusRequest = { id: string; n: number };

const KINDS = ["work", "personal", "shared"] as const;

/**
 * The model order: sections by account kind, each listed by account or by priority, with bulk
 * selection. Reordering stays inside a kind and only in the Priority view.
 */
export function ModelOrderList({
  draft,
  dirty,
  change,
  edit,
  status,
  catalog,
  chatFallback,
  view,
  onView,
  invalid,
  focusRequest,
  setupRevision,
  setupPlanner,
  onSetupPlannerChange,
}: {
  draft: OrderDraft;
  /** Unsaved edits hide the Next marks, which describe the saved order. */
  dirty: boolean;
  change: (draft: OrderDraft) => void;
  edit: (operation: (draft: OrderDraft) => OrderDraft) => boolean;
  status: ReturnType<typeof useModelRoutingStatus>;
  catalog?: SetupCatalog;
  /** Chat conversations continue on this order at a usage limit. */
  chatFallback: boolean;
  view: OrderView;
  onView: (view: OrderView) => void;
  invalid?: InvalidEntry;
  focusRequest?: FocusRequest;
  setupRevision: number;
  setupPlanner?: ModelRoutingTarget;
  onSetupPlannerChange: (choice: ModelRoutingTarget | undefined) => void;
}) {
  const t = useT();
  const sectionTitles: Record<EntryKind, string> = {
    work: t("Work accounts"),
    personal: t("Personal accounts"),
    shared: t("Shared models"),
  };
  const source = useModelSource();
  const quotaLabel = useQuotaLabel();
  const root = useRef<HTMLDivElement>(null);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const { entries, pools } = draft.routing;
  const kindFor = (entry: ModelRoutingEntry) => kindOf(entry, source);
  const byKind = {
    work: entries.filter((entry) => kindFor(entry) === "work"),
    personal: entries.filter((entry) => kindFor(entry) === "personal"),
    shared: entries.filter((entry) => kindFor(entry) === "shared"),
  };
  const sortables = {
    work: useAnimatedReorder(
      byKind.work.map((entry) => entry.id),
      (ids) => change(reorderKind(draft, kindFor, "work", ids)),
      "y",
    ),
    personal: useAnimatedReorder(
      byKind.personal.map((entry) => entry.id),
      (ids) => change(reorderKind(draft, kindFor, "personal", ids)),
      "y",
    ),
    shared: useAnimatedReorder(
      byKind.shared.map((entry) => entry.id),
      (ids) => change(reorderKind(draft, kindFor, "shared", ids)),
      "y",
    ),
  };
  const sectioned = byKind.work.length > 0 || byKind.personal.length > 0;
  const selected = entries.filter((entry) => chosen.has(entry.id));
  // The edited Host's available remote choices; the list's last provider wins when it still has one.
  const addChoices = setupCandidates(source, catalog);
  const addChoice = addChoiceFor(addChoices, entries[entries.length - 1]?.harness);
  const listFull = entries.length >= MODEL_ROUTING_MAX_ENTRIES;
  const noProviderReason = t("No remote provider is available on this Host for unattended work.");
  // Nothing is blocked before the Host reports its providers; then an empty choice list is explained.
  const addBlockedReason = listFull
    ? t("The model list is full.")
    : addChoice || !source.probed()
      ? undefined
      : noProviderReason;
  const statusOf = (id: string) => status.entries.find((candidate) => candidate.entryId === id);
  const statusFailed = Boolean(status.error && status.entries.length === 0);
  // The first saved model of each list the Host would not skip is where new work starts.
  const nextIds = new Set(
    dirty
      ? []
      : Object.values(byKind).flatMap((list) => {
          const first = list.find((entry) => {
            const entryStatus = statusOf(entry.id);
            return entryStatus && !entryStatus.skip;
          });
          return first ? [first.id] : [];
        }),
  );

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Moves DOM focus to the row the Host refused once this tab has mounted it.
  useEffect(() => {
    if (!focusRequest) return;
    const row = [...(root.current?.querySelectorAll<HTMLElement>("[data-entry-id]") ?? [])].find(
      (node) => node.dataset.entryId === focusRequest.id,
    );
    row?.scrollIntoView({ block: "center" });
    row?.querySelector<HTMLElement>("button, input")?.focus({ preventScroll: true });
  }, [focusRequest]);

  const choose = (ids: readonly string[], on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const clear = () => setChosen(new Set());
  function addEntry() {
    if (!addChoice) return;
    const id = crypto.randomUUID();
    change({
      ...draft,
      percentages: { ...draft.percentages, [id]: "" },
      routing: {
        ...draft.routing,
        entries: [
          ...entries,
          {
            ...addChoice.target,
            id,
            modelSettings: entrySettings(addChoice.target.modelSettings),
            unknownLimit: "use" as const,
          },
        ],
      },
    });
  }
  const remove = (ids: readonly string[]) => {
    // A refused removal keeps the selection so the owner can adjust it.
    if (edit((current) => removeEntries(current, ids))) clear();
  };
  const addAll = (group: AccountGroup) =>
    edit((current) =>
      addAccountModels(current, addChoices, group.harness, group.accountId, source),
    );
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || event.defaultPrevented || !chosen.size) return;
    event.preventDefault();
    clear();
  }

  const row = (
    entry: ModelRoutingEntry,
    index: number,
    kind: EntryKind,
    grip: boolean,
    accountQuota?: string,
  ) => (
    <ModelOrderRow
      key={entry.id}
      entry={entry}
      index={index}
      count={byKind[kind].length}
      next={nextIds.has(entry.id)}
      percent={draft.percentages[entry.id] ?? ""}
      providerPercent={draft.workCaps.reserve[entry.harness] ?? ""}
      status={statusOf(entry.id)}
      statusLoading={status.loading}
      statusError={statusFailed}
      accountQuota={accountQuota}
      sortable={grip ? sortables[kind] : undefined}
      selected={chosen.has(entry.id)}
      onSelect={(on) => choose([entry.id], on)}
      invalidMessage={invalid?.id === entry.id ? invalid.message : undefined}
      onChange={(next) => change(replaceOrderEntry(draft, next))}
      onPercent={(text) =>
        change({ ...draft, percentages: { ...draft.percentages, [entry.id]: text } })
      }
      onRemove={() => edit((current) => removeEntries(current, [entry.id]))}
    />
  );
  const accountSection = (group: AccountGroup, kind: EntryKind) => {
    const known = group.rows.map(({ entry }) => statusOf(entry.id));
    const quota = known.find((entryStatus) => entryStatus?.leftPercent != null) ?? known[0];
    const accountQuota = quotaLabel(quota, status.loading, statusFailed);
    const ids = group.rows.map(({ entry }) => entry.id);
    return (
      <div key={group.key} role="group" aria-label={group.account?.label ?? group.harness}>
        <AccountGroupHeader
          group={group}
          quota={accountQuota}
          selection={ids.filter((id) => chosen.has(id)).length}
          onSelectAll={(on) => choose(ids, on)}
          onRemoveAll={() => remove(ids)}
          onAddAll={() => addAll(group)}
        />
        {group.rows.map(({ entry, index }) => row(entry, index, kind, false, accountQuota))}
      </div>
    );
  };

  const jobs = jobsUsingOrder(draft.routing.roles);
  const listControls = (
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedControl
        label={t("List models")}
        value={view}
        onValueChange={(next) => onView(next === "priority" ? "priority" : "account")}
        options={[
          { value: "account", label: t("By account") },
          { value: "priority", label: t("Priority") },
        ]}
      />
      <OrderSortMenu
        disabled={entries.length < 2}
        onEdit={(operation) => {
          edit(operation);
          onView("priority");
        }}
      />
    </div>
  );
  const empty = entries.length === 0;
  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape from any control inside the list clears the bulk selection; the controls themselves stay the interactive elements.
    <div ref={root} className="@container/model-order flex flex-col gap-4" onKeyDown={onKeyDown}>
      <div className="grid gap-3">
        <div className="grid min-w-0 gap-1">
          <Heading as="h2" size="page">
            {t("Model priority")}
          </Heading>
          <Text size="caption" tone="secondary">
            {empty
              ? t("Set the order Bycoda tries models for background jobs.")
              : chatFallback
                ? t("Jobs using this order: {p0}, plus chat fallback", { p0: jobs })
                : t("Jobs using this order: {p0}", { p0: jobs })}
          </Text>
        </div>
        <SmartSetupAction
          key={setupRevision}
          variant={empty ? "primary" : "secondary"}
          onEdit={edit}
          catalogChoices={addChoices}
          choice={setupPlanner}
          onChoice={onSetupPlannerChange}
        >
          <Button
            size="sm"
            variant={empty ? "ghost" : "primary"}
            disabled={listFull || !addChoice}
            disabledReason={addBlockedReason}
            onClick={addEntry}
          >
            {t("Add model")}
          </Button>
        </SmartSetupAction>
      </div>
      {empty ? (
        <EmptyState
          context="list"
          icon={null}
          title={t("No models configured")}
          description={addChoice || !source.probed() ? "" : noProviderReason}
          showDescription={!addChoice}
          className="p-0"
        />
      ) : (
        listControls
      )}
      {!empty && status.error ? (
        <FailureState
          size="inline"
          title={t("Model limits could not be read.")}
          description=""
          error={status.error}
          onRetry={() => status.refetch()}
        />
      ) : null}
      {selected.length ? (
        <OrderSelectionBar
          selected={selected}
          pools={pools}
          onRemove={() => remove(selected.map((entry) => entry.id))}
          onEffort={(value) => edit((current) => setEntriesEffort(current, new Set(chosen), value))}
          onAddToGroup={(poolId) =>
            edit((current) =>
              addEntriesToPool(
                current,
                poolId,
                selected.map((entry) => entry.id),
              ),
            )
          }
          onClear={clear}
        />
      ) : null}
      {KINDS.filter((kind) => byKind[kind].length).map((kind, sectionIndex) => {
        const ids = byKind[kind].map((entry) => entry.id);
        const selectedCount = ids.filter((id) => chosen.has(id)).length;
        const title = sectioned ? sectionTitles[kind] : t("All models");
        return (
          <Group
            key={kind}
            title={title}
            layout="full"
            info={
              sectionIndex === 0
                ? t(
                    "Tried from the top: new work starts on the first model with quota left. A work project uses only work and shared models, a personal project only personal and shared ones. Running work keeps its model.",
                  )
                : undefined
            }
          >
            {view === "account" ? (
              groupByAccount(byKind[kind], source).map((group) => accountSection(group, kind))
            ) : (
              <>
                <div className="flex items-center gap-2 px-4 pt-2">
                  <Checkbox
                    label={t("Select all")}
                    size="caption"
                    tone="secondary"
                    checked={selectedCount === ids.length}
                    indeterminate={selectedCount > 0 && selectedCount < ids.length}
                    aria-label={t("Select all models of {p0}", { p0: title })}
                    onChange={(event) => choose(ids, event.currentTarget.checked)}
                  />
                </div>
                {byKind[kind].map((entry, index) => row(entry, index, kind, true))}
              </>
            )}
          </Group>
        );
      })}
    </div>
  );
}
