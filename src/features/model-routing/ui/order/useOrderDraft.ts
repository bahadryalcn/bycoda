import { useState } from "react";
import { presentRemoteError } from "../../../connections/public/remoteFailure";
import { retainedTransactionValue, useRetainedTransaction } from "../../model/retainedTransaction";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useT } from "../../../../shared/i18n";
import {
  HOST_MODEL_ROUTING,
  type ModelRoutingState,
} from "../../../../shared/model/host-contracts/model-routing";
import type { HostSettings } from "../../../tasks/public/hostSettings";
import {
  listMachineLimits,
  saveMachineLimits,
  settingsMachine,
} from "../../../tasks/public/hostSettings";
import { useModelRouting } from "../../model/modelRoutingClient";
import {
  findUnavailableOrderEntry,
  orderDraft,
  prepareOrderSave,
  sameOrderDraft,
  unavailableOrderEntryId,
  type OrderDraft,
} from "../../model/modelRoutingDraft";
import { setupCatalogQuery } from "../../model/smartSetupCatalog";

export function useOrderSettings(machineId: string) {
  const routing = useModelRouting(machineId, true);
  const catalog = useQuery(setupCatalogQuery(machineId));
  const limits = useQuery({
    queryKey: ["model-routing-limits", machineId],
    queryFn: async () => {
      const machine = await settingsMachine(machineId);
      if (!machine) throw new Error("Work limits are unavailable on this Host.");
      const [state] = await listMachineLimits([machine]);
      if (!state) throw new Error("The Host did not return work limits.");
      return { machine, state };
    },
    retry: false,
  });
  return { routing, limits, catalog };
}

function routingWithoutRoles(state: ModelRoutingState): string {
  const { version: _version, updatedAt: _updatedAt, roles: _roles, ...rest } = state;
  return JSON.stringify(rest);
}

type Settings = ReturnType<typeof useOrderSettings>;
type Baseline = { routing: ModelRoutingState; limits: HostSettings };

/** One editing transaction; each separate Host acknowledgement becomes its own baseline. */
export function useOrderDraft(settings: Settings, initial: Baseline, machineId: string) {
  const t = useT();
  const client = useQueryClient();
  const [baseline, setBaseline] = useRetainedTransaction(`order:${machineId}:baseline`, initial);
  const [draft, setDraft] = useRetainedTransaction(
    `order:${machineId}:draft`,
    orderDraft(initial.routing, initial.limits),
  );
  const [pending, setPending] = useRetainedTransaction(`order:${machineId}:pending`, false);
  const [error, setError] = useRetainedTransaction(`order:${machineId}:error`, "");
  const [saveConflict, setSaveConflict] = useRetainedTransaction(
    `order:${machineId}:conflict`,
    false,
  );
  const [saved, setSaved] = useRetainedTransaction(`order:${machineId}:saved`, false);
  const [invalidFields, setInvalidFields] = useState<ReadonlySet<string>>(new Set());
  const submitting = {
    get current() {
      return retainedTransactionValue<boolean>(`order:${machineId}:pending`) ?? false;
    },
    set current(value: boolean) {
      setPending(value);
    },
  };
  const base = orderDraft(baseline.routing, baseline.limits);
  const dirty = !sameOrderDraft(draft, base);
  // Query notifications can lag a mutation's acknowledgement by one render.
  const observedRouting = settings.routing.state;
  const latestRouting =
    observedRouting && observedRouting.version >= baseline.routing.version
      ? observedRouting
      : baseline.routing;
  const latestLimits =
    client.getQueryData<{ state: HostSettings }>(["model-routing-limits", machineId])?.state ??
    settings.limits.data?.state ??
    baseline.limits;
  const changedElsewhere =
    latestRouting.version !== baseline.routing.version ||
    latestLimits.maxRunningTasks !== baseline.limits.maxRunningTasks ||
    latestLimits.dailyAgentMinutes !== baseline.limits.dailyAgentMinutes;
  // Refresh clean forms during render; background reads must never replace unsaved edits.
  if (!pending && !dirty && changedElsewhere) {
    setBaseline({ routing: latestRouting, limits: latestLimits });
    setDraft(orderDraft(latestRouting, latestLimits));
    setSaved(false);
  }
  // Who uses what saves the same document from the same screen. When only its job choices
  // moved and this draft left them alone, carry the draft onto the new version.
  if (
    !pending &&
    dirty &&
    !saveConflict &&
    latestRouting.version !== baseline.routing.version &&
    latestLimits.maxRunningTasks === baseline.limits.maxRunningTasks &&
    latestLimits.dailyAgentMinutes === baseline.limits.dailyAgentMinutes &&
    routingWithoutRoles(latestRouting) === routingWithoutRoles(baseline.routing) &&
    JSON.stringify(draft.routing.roles) === JSON.stringify(baseline.routing.roles)
  ) {
    setBaseline({ routing: latestRouting, limits: baseline.limits });
    setDraft({
      ...draft,
      routing: { ...draft.routing, roles: structuredClone(latestRouting.roles) },
    });
  }
  const conflict = saveConflict || (dirty && changedElsewhere && !pending);
  const unavailable = sameOrderDraft({ ...draft, limits: base.limits }, base)
    ? undefined
    : findUnavailableOrderEntry(draft.routing.entries, settings.catalog.data);
  let validation = "";
  try {
    prepareOrderSave(draft);
    if (unavailable)
      validation = t("Model {p0} is unavailable on this Host (entry {p1}).", {
        p0: unavailable.model,
        p1: unavailable.id,
      });
  } catch (cause) {
    validation = cause instanceof Error ? cause.message : String(cause);
  }
  // A typed limit the draft could not take is not in the draft, so Save would drop it silently.
  if (invalidFields.size) validation = t("Fix the highlighted limit before saving.");

  /** Fields call this by key when they start or stop showing an unparsable value. */
  function fieldInvalid(key: string, invalid: boolean) {
    setInvalidFields((current) => {
      if (current.has(key) === invalid) return current;
      const next = new Set(current);
      if (invalid) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function change(next: OrderDraft) {
    if (submitting.current) return;
    setDraft(next);
    setError("");
    setSaved(false);
  }

  /** Applies an edit; returns false (and shows the message) when it throws. */
  function edit(operation: (current: OrderDraft) => OrderDraft): boolean {
    try {
      change(operation(draft));
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  }

  function revert() {
    if (submitting.current) return;
    setBaseline({ routing: latestRouting, limits: latestLimits });
    setDraft(orderDraft(latestRouting, latestLimits));
    setError("");
    setSaveConflict(false);
    setSaved(false);
  }

  async function reload() {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    try {
      const [, result] = await Promise.all([
        client.refetchQueries(
          { queryKey: [HOST_MODEL_ROUTING, machineId], exact: true },
          { throwOnError: true },
        ),
        settings.limits.refetch(),
      ]);
      if (result.error) throw result.error;
      const routing = client.getQueryData<ModelRoutingState>([HOST_MODEL_ROUTING, machineId]);
      if (!routing || !result.data) throw new Error("Models and limits could not be read.");
      setBaseline({ routing, limits: result.data.state });
      setDraft(orderDraft(routing, result.data.state));
      setError("");
      setSaveConflict(false);
      setSaved(false);
    } catch (cause) {
      setError(presentRemoteError(cause, { explicit: true }));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  async function save() {
    if (submitting.current || !dirty || conflict || validation) return;
    const input = prepareOrderSave(draft);
    const before = prepareOrderSave(orderDraft(baseline.routing, baseline.limits));
    submitting.current = true;
    setPending(true);
    setError("");
    let acknowledged = baseline;
    let routingSaved = false;
    try {
      if (JSON.stringify(input.routing) !== JSON.stringify(before.routing)) {
        const state = await settings.routing.save.mutateAsync({
          expectedVersion: baseline.routing.version,
          draft: input.routing,
        });
        acknowledged = { ...acknowledged, routing: state };
        routingSaved = true;
        setBaseline(acknowledged);
      }
      if (JSON.stringify(input.limits) !== JSON.stringify(before.limits)) {
        const machine = settings.limits.data?.machine;
        if (!machine) throw new Error("Work limits are unavailable on this Host.");
        const state = await saveMachineLimits(machine, input.limits);
        acknowledged = { ...acknowledged, limits: state };
        client.setQueryData(["model-routing-limits", machineId], {
          machine,
          state,
        });
      }
      setBaseline(acknowledged);
      setDraft(orderDraft(acknowledged.routing, acknowledged.limits));
      setSaved(true);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setSaveConflict(
        !unavailableOrderEntryId(message) && /conflict|version|changed/i.test(message),
      );
      setError(routingSaved ? `Models saved; work limits were not saved. ${message}` : message);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  return {
    draft,
    /** The acknowledged document as a draft; changes are listed against it. */
    base,
    change,
    edit,
    pending,
    dirty,
    conflict,
    validation,
    fieldInvalid,
    error,
    invalidEntryId: unavailable?.id ?? unavailableOrderEntryId(error),
    saved,
    save,
    revert,
    reload,
  };
}
