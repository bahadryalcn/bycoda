import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useStableCallback } from "../../../../shared/hooks/useStableCallback";
import { useT } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { ButtonGroup } from "../../../../shared/ui/ButtonGroup";
import { InlineMessage } from "../../../../shared/ui/InlineError";
import { Text } from "../../../../shared/ui/Text";
import { SlidersHorizontal, Sparkles } from "../../../../shared/ui/icons";
import { HarnessIcon } from "../../../../shared/ui/identity/HarnessIcon";
import { useModelSource } from "../../../sessions/public/modelSource";
import { ModelPicker } from "../../../sessions/public/ModelPicker";
import { mergeModelSettings } from "../../../sessions/public/models";
import { canRunHarnessTextPrompt } from "../../../../integrations/harness/core/registry";
import type { ModelRoutingTarget } from "../../../../shared/model/host-contracts/model-routing";
import { isRemoteProvider, REMOTE_PROVIDERS } from "../../../connections/public/protocol";
import type { OrderDraft } from "../../model/modelRoutingDraft";
import { refreshLocalLiveCatalogFacts } from "../../model/liveCatalogFacts";
import {
  applySmartSetup,
  rulePlan,
  setupCandidates,
  type SetupCandidate,
} from "../../model/smartSetup";
import {
  planSmartSetup,
  resolveSetupPlanner,
  setupPlannerLabel,
  type SmartSetupResult,
} from "../../model/smartSetupAi";
import { localSetupCatalog, setupCatalogQuery } from "../../model/smartSetupCatalog";

type SetupMethod = "rules" | "ai";

/** Prepares one reversible edit and keeps its planning status beside the actions. */
export function SmartSetupAction({
  variant = "secondary",
  onEdit,
  catalogChoices,
  choice,
  onChoice,
}: {
  variant?: "primary" | "secondary";
  onEdit: (operation: (draft: OrderDraft) => OrderDraft) => boolean;
  catalogChoices: SetupCandidate[];
  choice?: ModelRoutingTarget;
  onChoice: (choice: ModelRoutingTarget | undefined) => void;
}) {
  const t = useT();
  const source = useModelSource();
  const client = useQueryClient();
  const [running, setRunning] = useState<SetupMethod>();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [planner, setPlanner] = useState<string>();
  const [result, setResult] = useState<
    Pick<SmartSetupResult, "plannedBy" | "failure"> & {
      method: SetupMethod;
    }
  >();
  const abort = useRef<AbortController | null>(null);
  const aiButton = useRef<HTMLButtonElement>(null);
  const pickerButton = useRef<HTMLButtonElement>(null);
  const rulesButton = useRef<HTMLButtonElement>(null);
  const allowedHarnesses = REMOTE_PROVIDERS.filter(canRunHarnessTextPrompt);
  const automatic = useQuery({
    queryKey: ["routing-setup-planner", source.id, allowedHarnesses, catalogChoices],
    queryFn: async () => (await resolveSetupPlanner(catalogChoices)) ?? null,
    enabled: !choice,
    retry: false,
  });
  const selected = choice ?? automatic.data;
  const pickerHarness =
    selected?.harness ?? allowedHarnesses.find((harness) => source.available(harness));
  // Finish against the latest account source and draft after catalog or planner work.
  const edit = useStableCallback((proposal: SmartSetupResult | undefined, failure?: unknown) =>
    onEdit((draft) => {
      if (failure) throw failure;
      if (!proposal)
        throw new Error("No available provider models found. Check Providers and try again.");
      return applySmartSetup(draft, proposal.candidates, proposal.plan, source);
    }),
  );
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Abort setup on unmount so it cannot edit a closed draft.
  useEffect(() => () => abort.current?.abort(), []);

  async function candidatesForSetup() {
    if (source.id) return setupCandidates(source);
    const [, catalog] = await Promise.all([
      refreshLocalLiveCatalogFacts(3000),
      localSetupCatalog((machineId) => client.fetchQuery(setupCatalogQuery(machineId))),
    ]);
    return setupCandidates(source, catalog);
  }

  async function run(method: SetupMethod) {
    if (abort.current) return;
    const plannerTarget = selected ?? null;
    const controller = new AbortController();
    abort.current = controller;
    setRunning(method);
    setPickerOpen(false);
    setPlanner(undefined);
    setResult(undefined);
    const names = {
      smartest: t("Smartest"),
      balanced: t("Balanced"),
      light: t("Low"),
      work: t("Work"),
      personal: t("Personal"),
    };
    let proposal: SmartSetupResult | undefined;
    let failure: unknown;
    try {
      const candidates = await candidatesForSetup();
      if (controller.signal.aborted) return;
      if (candidates.length)
        proposal =
          method === "ai"
            ? await planSmartSetup(candidates, names, {
                signal: controller.signal,
                planner: plannerTarget,
                onPlanner: (label) => {
                  if (!controller.signal.aborted) setPlanner(label);
                },
              })
            : { candidates, plan: rulePlan(candidates, names) };
    } catch (cause) {
      failure = cause;
    }
    if (controller.signal.aborted) return;
    abort.current = null;
    setRunning(undefined);
    if (edit(proposal, failure) && proposal) {
      const { plannedBy, failure: plannerFailure } = proposal;
      setResult({ method, plannedBy, failure: plannerFailure });
    }
  }

  function cancel() {
    abort.current?.abort();
    abort.current = null;
    setRunning(undefined);
    queueMicrotask(() => (running === "ai" ? aiButton : rulesButton).current?.focus());
  }

  const fallback = result?.method === "ai" && !result.plannedBy;

  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          ref={rulesButton}
          variant={variant}
          size="sm"
          disabled={running === "ai"}
          disabledReason={t("Wait for the current operation to finish")}
          loading={running === "rules"}
          loadingLabel={t("Preparing draft…")}
          onClick={() => void run("rules")}
        >
          {t("Set up with rules")}
        </Button>
        <ButtonGroup aria-label={t("Set up with AI")} className="min-w-0 max-w-full">
          <Button
            ref={aiButton}
            variant="ghost"
            size="sm"
            startIcon={<Sparkles className="icon-sm" />}
            disabled={running === "rules" || (!choice && automatic.isPending)}
            disabledReason={
              running === "rules"
                ? t("Wait for the current operation to finish")
                : t("Checking available planning models…")
            }
            loading={running === "ai"}
            loadingLabel={planner ? t("Planning with {p0}", { p0: planner }) : t("Planning…")}
            onClick={() => void run("ai")}
          >
            {t("Set up with AI")}
          </Button>
          {/* The planning model is named on the trigger, never hidden behind its provider icon. */}
          <Button
            ref={pickerButton}
            variant="ghost"
            size="sm"
            startIcon={
              selected ? (
                <HarnessIcon harness={selected.harness} size="sm" />
              ) : (
                <SlidersHorizontal className="icon-sm" />
              )
            }
            disabled={!!running || !pickerHarness}
            disabledReason={
              running
                ? t("Wait for the current operation to finish")
                : t("No planning model is available.")
            }
            aria-haspopup="dialog"
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen(!pickerOpen)}
          >
            {choice ? source.resolve(choice.harness, choice.model).name : t("Automatic")}
          </Button>
        </ButtonGroup>
        {pickerOpen && pickerHarness ? (
          <ModelPicker
            harness={pickerHarness}
            model={selected?.model ?? source.resolve(pickerHarness).id}
            values={selected?.modelSettings ?? {}}
            accountId={selected?.providerAccountId}
            accountChoices
            allowedHarnesses={allowedHarnesses}
            settingsScope="reasoning-and-speed"
            presentation="field"
            openRequest={1}
            externalTrigger={{ anchor: pickerButton, onDismiss: () => setPickerOpen(false) }}
            inheritChoice={{
              label:
                !choice && selected
                  ? t("Automatic ({p0})", { p0: setupPlannerLabel(selected, catalogChoices) })
                  : t("Automatic"),
              selected: !choice,
              onSelect: () => onChoice(undefined),
            }}
            onChange={(harness, model, providerAccountId) => {
              if (!isRemoteProvider(harness)) return;
              const resolved = source.resolve(harness, model);
              onChoice({
                harness,
                model,
                providerAccountId,
                modelSettings: mergeModelSettings(
                  resolved,
                  selected?.model === model && selected.harness === harness
                    ? selected.modelSettings
                    : undefined,
                ),
              });
            }}
            onSettingsChange={(modelSettings) => {
              if (selected) onChoice({ ...selected, modelSettings });
            }}
          />
        ) : null}
        {running ? (
          <Button size="sm" variant="ghost" onClick={cancel}>
            {t("Cancel")}
          </Button>
        ) : null}
      </div>
      <Text size="caption" tone="secondary">
        {t("Fills models, groups and jobs in one draft.")}
      </Text>
      {result ? (
        <InlineMessage tone={fallback ? "warning" : "success"}>
          {result.plannedBy
            ? t("Draft planned by {p0}", { p0: result.plannedBy })
            : result.failure
              ? result.failure.reason === "timeout"
                ? t("{p0} timed out. Rules prepared the draft.", { p0: result.failure.planner })
                : t("{p0} could not complete the plan. Rules prepared the draft.", {
                    p0: result.failure.planner,
                  })
              : fallback
                ? t("Rules prepared the draft. No planning model was available.")
                : t("Rules prepared the draft.")}
        </InlineMessage>
      ) : null}
    </div>
  );
}
