import { useEffect, useRef, useState } from "react";
import { useStableCallback } from "../../../../shared/hooks/useStableCallback";
import { useT } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { WandSparkles } from "../../../../shared/ui/icons";
import { InfoPopover } from "../../../../shared/ui/InfoPopover";
import { Text } from "../../../../shared/ui/Text";
import { toast } from "../../../../shared/ui/ToastRegion";
import { useModelSource } from "../../../sessions/public/modelSource";
import type { OrderDraft } from "../../model/modelRoutingDraft";
import { applySmartSetup, setupCandidates } from "../../model/smartSetup";
import { planSmartSetup, type SmartSetupResult } from "../../model/smartSetupAi";

/**
 * One reversible draft edit: an AI plan (researched rules when no model can plan) adds every
 * available account and model, orders them by benefit per cost, fills the pools and binds every
 * role. Persistence stays with the version-bound Save. Failures reach the owner through the
 * draft editor's error line.
 */
export function SmartSetupAction({
  variant = "primary",
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
  async function run() {
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    const names = {
      smartest: t("Smartest"),
      balanced: t("Balanced"),
      fast: t("Fast"),
      work: t("Work"),
      personal: t("Personal"),
    };
    let result: SmartSetupResult | undefined;
    let failure: unknown;
    try {
      const candidates = setupCandidates(source);
      if (candidates.length)
        result = await planSmartSetup(candidates, names, { signal: controller.signal });
    } catch (cause) {
      failure = cause;
    }
    if (controller.signal.aborted) return;
    setRunning(false);
    let applied = false;
    edit((draft) => {
      if (failure) throw failure;
      if (!result)
        throw new Error("No available provider models found. Check Providers and try again.");
      const next = applySmartSetup(draft, result.candidates, result.plan);
      applied = true;
      return next;
    });
    if (!applied || !result) return;
    toast.show(
      result.plannedBy
        ? {
            tone: "success",
            message: t("{p0} planned the order, pools and assignments. Review them, then save.", {
              p0: result.plannedBy,
            }),
          }
        : {
            tone: "warning",
            message: t(
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
        loadingLabel={t("Setting up…")}
        onClick={() => void run()}
      >
        {t("Smart setup")}
      </Button>
      <InfoPopover label={t("About smart setup")} className="shrink-0">
        <Text as="p" tone="muted" leading="inherit">
          {t(
            "Effort follows the job: Low for simple jobs, Medium for most work, High for reviews and planning. Smart setup never goes above High; choose higher levels yourself.",
          )}
        </Text>
      </InfoPopover>
    </>
  );
}
