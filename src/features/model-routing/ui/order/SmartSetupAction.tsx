import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStableCallback } from "../../../../shared/hooks/useStableCallback";
import { useT } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Popover } from "../../../../shared/ui/Popover";
import { Text } from "../../../../shared/ui/Text";
import { toast } from "../../../../shared/ui/ToastRegion";
import { LOCAL_MODEL_SOURCE, useModelSource } from "../../../sessions/public/modelSource";
import type { OrderDraft } from "../../model/modelRoutingDraft";
import { refreshLocalLiveCatalogFacts } from "../../model/liveCatalogFacts";
import { applySmartSetup, rulePlan, setupCandidates } from "../../model/smartSetup";
import { planSmartSetup, type SmartSetupResult } from "../../model/smartSetupAi";
import { localSetupCatalog, setupCatalogQuery } from "../../model/smartSetupCatalog";

/**
 * One reversible draft edit that adds pool models and account fallbacks, orders them, fills
 * the groups, binds every job and sets subagents and advisor. The primary action applies the
 * researched rules at once; "Plan setup with AI" asks a model first and falls back to the rules.
 * Persistence stays with the version-bound Save. Failures reach the owner through the draft
 * editor's error line.
 */
export function SmartSetupAction({
  variant = "secondary",
  onEdit,
  children,
}: {
  variant?: "primary" | "secondary";
  onEdit: (operation: (draft: OrderDraft) => OrderDraft) => void;
  children?: ReactNode;
}) {
  const t = useT();
  const source = useModelSource();
  const client = useQueryClient();
  const [running, setRunning] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsButton = useRef<HTMLButtonElement>(null);
  const optionsId = useId();
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
  async function candidatesForSetup() {
    const [, catalog] = await Promise.all([
      refreshLocalLiveCatalogFacts(3000),
      localSetupCatalog((machineId) => client.fetchQuery(setupCatalogQuery(machineId))),
    ]);
    return setupCandidates(source.id ? LOCAL_MODEL_SOURCE : source, catalog);
  }
  async function runRules() {
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    let result: SmartSetupResult | undefined;
    let failure: unknown;
    try {
      const candidates = await candidatesForSetup();
      if (candidates.length) result = { candidates, plan: rulePlan(candidates, names) };
    } catch (cause) {
      failure = cause;
    }
    if (controller.signal.aborted) return;
    setRunning(false);
    if (apply(result, failure))
      toast.show({
        tone: "info",
        message: t("Setup draft ready. Review it, then save."),
      });
  }
  async function runAi() {
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    let result: SmartSetupResult | undefined;
    let failure: unknown;
    try {
      const candidates = await candidatesForSetup();
      if (controller.signal.aborted) return;
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
        loading={running}
        loadingLabel={t("Planning…")}
        onClick={() => void runRules()}
      >
        {t("Prepare setup draft")}
      </Button>
      {children}
      <Button
        ref={optionsButton}
        size="sm"
        variant="ghost"
        aria-haspopup="dialog"
        aria-expanded={optionsOpen}
        aria-controls={optionsOpen ? optionsId : undefined}
        disabled={running}
        onClick={() => setOptionsOpen((open) => !open)}
      >
        {t("Setup options")}
      </Button>
      {optionsOpen ? (
        <Popover
          id={optionsId}
          anchor={optionsButton}
          kind="dialog"
          aria-label={t("Setup options")}
          width={320}
          onDismiss={() => setOptionsOpen(false)}
          variant="panel"
          className="flex flex-col items-start gap-2"
        >
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              optionsButton.current?.focus();
              setOptionsOpen(false);
              void runAi();
            }}
          >
            {t("Plan setup with AI")}
          </Button>
          <Text as="p" size="secondary" tone="secondary">
            {t(
              "Adds models used by groups and the best fallback in each tier for every account. Strong models at a moderate price come first, then cheaper capable models and top-priced models. Groups set reasoning effort for their jobs, up to High. Also sets subagents and the advisor.",
            )}
          </Text>
          <Text as="p" size="caption" tone="secondary">
            {t("Prices and scores: OpenRouter, Artificial Analysis.")}
          </Text>
        </Popover>
      ) : null}
    </>
  );
}
