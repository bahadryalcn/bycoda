import { useEffect, useRef, useState } from "react";
import { useStableCallback } from "../../../../shared/hooks/useStableCallback";
import { useT } from "../../../../shared/i18n";
import { WandSparkles } from "../../../../shared/ui/icons";
import { InfoPopover } from "../../../../shared/ui/InfoPopover";
import { Button } from "../../../../shared/ui/Button";
import { Text } from "../../../../shared/ui/Text";
import { toast } from "../../../../shared/ui/ToastRegion";
import { useModelSource } from "../../../sessions/public/modelSource";
import type { OrderDraft } from "../../model/modelRoutingDraft";
import { refreshLocalLiveCatalogFacts } from "../../model/liveCatalogFacts";
import { applySmartSetup, rulePlan, setupCandidates } from "../../model/smartSetup";
import { planSmartSetup, type SmartSetupResult } from "../../model/smartSetupAi";

/**
 * One reversible draft edit that adds every available account and model, orders them, fills
 * the groups, binds every job and sets subagents and advisor. The primary action applies the
 * researched rules at once; "Plan with AI" asks a model first and falls back to the rules.
 * Persistence stays with the version-bound Save. Failures reach the owner through the draft
 * editor's error line.
 */
export function SmartSetupAction({
  variant = "secondary",
  onEdit,
}: {
  variant?: "primary" | "secondary";
  onEdit: (operation: (draft: OrderDraft) => OrderDraft) => void;
}) {
  const t = useT();
  const source = useModelSource();
  const [running, setRunning] = useState(false);
  const abort = useRef<AbortController | null>(null);
  // The edit lands after an async step, so it must use the editor of the latest render.
  const edit = useStableCallback(onEdit);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Aborts a running plan on unmount instead of editing a draft that is gone.
  useEffect(() => () => abort.current?.abort(), []);
  const names = {
    smartest: t("Smartest"),
    balanced: t("Balanced"),
    fast: t("Fast"),
    work: t("Work"),
    personal: t("Personal"),
  };
  function apply(result: SmartSetupResult | undefined, failure?: unknown): boolean {
    let applied = false;
    edit((draft) => {
      if (failure) throw failure;
      if (!result)
        throw new Error("No available provider models found. Check Providers and try again.");
      const next = applySmartSetup(draft, result.candidates, result.plan);
      applied = true;
      return next;
    });
    return applied;
  }
  async function runRules() {
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    // Live prices and scores, at most 3 s; the researched table covers a slow or offline Host.
    await refreshLocalLiveCatalogFacts(3000);
    if (controller.signal.aborted) return;
    setRunning(false);
    let result: SmartSetupResult | undefined;
    let failure: unknown;
    try {
      const candidates = setupCandidates(source);
      if (candidates.length) result = { candidates, plan: rulePlan(candidates, names) };
    } catch (cause) {
      failure = cause;
    }
    if (apply(result, failure))
      toast.show({
        tone: "info",
        message: t("Smart setup filled the draft. Review it, then save."),
      });
  }
  async function runAi() {
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    let result: SmartSetupResult | undefined;
    let failure: unknown;
    try {
      await refreshLocalLiveCatalogFacts(3000);
      const candidates = setupCandidates(source);
      if (candidates.length)
        result = await planSmartSetup(candidates, names, { signal: controller.signal });
    } catch (cause) {
      failure = cause;
    }
    if (controller.signal.aborted) return;
    setRunning(false);
    if (!apply(result, failure) || !result) return;
    toast.show(
      result.plannedBy
        ? {
            tone: "info",
            message: t("{p0} planned the setup. Review it, then save.", { p0: result.plannedBy }),
          }
        : {
            tone: "warning",
            message: result.failure
              ? t(
                  "{p0} could not plan the setup ({p1}), so the researched benefit-per-cost ranking was used. Review it, then save.",
                  {
                    p0: result.failure.planner,
                    p1:
                      result.failure.reason === "timeout"
                        ? t("it timed out")
                        : result.failure.reason === "unreadable"
                          ? t("its answer could not be read")
                          : (result.failure.detail ?? t("it failed")),
                  },
                )
              : t(
                  "No model could plan the setup, so the researched benefit-per-cost ranking was used. Review it, then save.",
                ),
          },
    );
  }
  return (
    <>
      <Button
        variant={variant}
        size="sm"
        startIcon={<WandSparkles className="icon-sm" />}
        loading={running}
        loadingLabel={t("Planning…")}
        onClick={() => void runRules()}
      >
        {t("Smart setup")}
      </Button>
      <Button size="sm" variant="secondary" disabled={running} onClick={() => void runAi()}>
        {t("Plan with AI")}
      </Button>
      <InfoPopover label={t("About smart setup")} className="shrink-0">
        <Text as="p" tone="muted" leading="inherit">
          {t(
            "Adds every signed-in account and enabled model. Strong models at a moderate price come first, cheaper capable models next, top-priced models last; reviews and planning use the strongest. Also sets subagents and the advisor. Effort never goes above High.",
          )}
        </Text>
        <Text as="p" tone="muted" leading="inherit">
          {t("Prices and scores: OpenRouter, Artificial Analysis.")}
        </Text>
      </InfoPopover>
    </>
  );
}
